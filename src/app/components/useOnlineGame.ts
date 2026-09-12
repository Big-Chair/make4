import { useState, useEffect, useRef, useCallback } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { createRoom, joinRoom, fetchRoom, type Room } from "./api";
import type { TokenConfig } from "./TokenCustomizer";

export type OnlineRole = "host" | "guest";

export interface OnlineMove {
  type: "drop";
  col: number;
}

export interface OnlineBlast {
  type: "blast";
  row: number;
  col: number;
}

export interface OnlineRematch {
  type: "rematch";
}

export interface OnlineTokenSync {
  type: "token_sync";
  tokenConfig: TokenConfig;
}

export type OnlineMessage = OnlineMove | OnlineBlast | OnlineRematch | OnlineTokenSync;

export type ConnectionState = "idle" | "creating" | "waiting" | "joining" | "connected" | "disconnected" | "error";

export interface UseOnlineGameReturn {
  // State
  connectionState: ConnectionState;
  room: Room | null;
  role: OnlineRole | null;
  error: string | null;
  opponentPresent: boolean;
  opponentToken: TokenConfig | null;

  // Actions
  createNewRoom: (hostName: string, timerDuration?: number) => Promise<string | null>;
  joinExistingRoom: (code: string, guestName: string) => Promise<boolean>;
  sendMove: (col: number) => void;
  sendBlast: (row: number, col: number) => void;
  sendRematch: () => void;
  sendTokenSync: (config: TokenConfig) => void;
  disconnect: () => void;

  /**
   * Register a handler that fires immediately when the opponent sends a game
   * message (drop / blast / rematch).  Uses a ref internally so the handler
   * always has fresh closure state.  Call with `null` to unregister.
   */
  setMoveHandler: (handler: ((msg: OnlineMessage) => void) | null) => void;
}

export function useOnlineGame(): UseOnlineGameReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [room, setRoom] = useState<Room | null>(null);
  const [role, setRole] = useState<OnlineRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opponentPresent, setOpponentPresent] = useState(false);
  const [opponentToken, setOpponentToken] = useState<TokenConfig | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Callback-ref for game messages ──
  // GameScreen sets this; broadcast listeners call it directly.
  const moveHandlerRef = useRef<((msg: OnlineMessage) => void) | null>(null);

  const setMoveHandler = useCallback((handler: ((msg: OnlineMessage) => void) | null) => {
    moveHandlerRef.current = handler;
  }, []);

  // Helper: dispatch a game message to the handler
  const dispatchMove = useCallback((msg: OnlineMessage) => {
    console.log("[Online] Dispatching to handler:", msg.type, msg);
    if (moveHandlerRef.current) {
      moveHandlerRef.current(msg);
    } else {
      console.warn("[Online] No move handler registered, message dropped:", msg);
    }
  }, []);

  // Subscribe to a room's Realtime channel
  const subscribeToChannel = useCallback((roomCode: string, myRole: OnlineRole) => {
    // Clean up existing channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase.channel(`make4-room-${roomCode}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: "game_action" }, ({ payload }) => {
        console.log("[Online] Received game_action:", payload);
        dispatchMove(payload as OnlineMessage);
      })
      .on("broadcast", { event: "token_sync" }, ({ payload }) => {
        console.log("[Online] Received token sync:", payload);
        setOpponentToken(payload.tokenConfig);
      })
      .on("broadcast", { event: "player_joined" }, ({ payload }) => {
        console.log("[Online] Opponent joined:", payload);
        setOpponentPresent(true);
        if (payload.tokenConfig) {
          setOpponentToken(payload.tokenConfig);
        }
      })
      .on("broadcast", { event: "player_left" }, () => {
        console.log("[Online] Opponent left");
        setOpponentPresent(false);
      })
      .subscribe((status) => {
        console.log("[Online] Channel status:", status);
        if (status === "SUBSCRIBED") {
          console.log("[Online] Successfully subscribed to channel:", `make4-room-${roomCode}`);
          // If guest, announce arrival
          if (myRole === "guest") {
            channel.send({
              type: "broadcast",
              event: "player_joined",
              payload: { role: "guest" },
            });
          }
        }
      });

    channelRef.current = channel;
  }, [dispatchMove]);

  // ── Send helpers (all use a single "game_action" event) ──

  const sendMove = useCallback((col: number) => {
    if (!channelRef.current) {
      console.warn("[Online] sendMove: no channel");
      return;
    }
    const payload: OnlineMove = { type: "drop", col };
    console.log("[Online] Sending move:", payload);
    channelRef.current.send({ type: "broadcast", event: "game_action", payload });
  }, []);

  const sendBlast = useCallback((row: number, col: number) => {
    if (!channelRef.current) {
      console.warn("[Online] sendBlast: no channel");
      return;
    }
    const payload: OnlineBlast = { type: "blast", row, col };
    console.log("[Online] Sending blast:", payload);
    channelRef.current.send({ type: "broadcast", event: "game_action", payload });
  }, []);

  const sendRematch = useCallback(() => {
    if (!channelRef.current) return;
    console.log("[Online] Sending rematch");
    channelRef.current.send({ type: "broadcast", event: "game_action", payload: { type: "rematch" } });
  }, []);

  const sendTokenSync = useCallback((config: TokenConfig) => {
    if (!channelRef.current) return;
    channelRef.current.send({
      type: "broadcast",
      event: "token_sync",
      payload: { type: "token_sync", tokenConfig: config },
    });
  }, []);

  // ── Room management ──

  const createNewRoom = useCallback(async (hostName: string, timerDuration = 40): Promise<string | null> => {
    setConnectionState("creating");
    setError(null);

    const createRes = await createRoom(hostName, timerDuration);
    if (!createRes.ok) {
      setConnectionState("error");
      setError(createRes.error.message || "Failed to create room. Please try again.");
      return null;
    }
    const newRoom = createRes.data;

    setRoom(newRoom);
    setRole("host");
    setConnectionState("waiting");

    // Subscribe to Realtime channel
    subscribeToChannel(newRoom.code, "host");

    // Poll for guest joining (backup to Realtime)
    pollingRef.current = setInterval(async () => {
      const res = await fetchRoom(newRoom.code);
      if (res.ok) {
        const updated = res.data;
        if (updated.status === "playing" && updated.guestName) {
          setRoom(updated);
          setOpponentPresent(true);
          setConnectionState("connected");
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }
      } else if (res.error.status !== 404) {
        // 404 = room not visible yet; keep polling. Other errors are fatal.
        setConnectionState("error");
        setError(res.error.message || "Room is no longer available.");
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }
    }, 2000);

    return newRoom.code;
  }, [subscribeToChannel]);

  const joinExistingRoom = useCallback(async (code: string, guestName: string): Promise<boolean> => {
    setConnectionState("joining");
    setError(null);

    const upper = code.toUpperCase().trim();
    const res = await joinRoom(upper, guestName);
    if (!res.ok) {
      setConnectionState("error");
      setError(res.error.message || "Room not found or already full.");
      return false;
    }

    setRoom(res.data);
    setRole("guest");
    setOpponentPresent(true);
    setConnectionState("connected");

    // Subscribe to Realtime channel
    subscribeToChannel(upper, "guest");

    return true;
  }, [subscribeToChannel]);

  // Disconnect and clean up
  const disconnect = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.send({
        type: "broadcast",
        event: "player_left",
        payload: {},
      });
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    moveHandlerRef.current = null;
    setConnectionState("idle");
    setRoom(null);
    setRole(null);
    setError(null);
    setOpponentPresent(false);
    setOpponentToken(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  return {
    connectionState,
    room,
    role,
    error,
    opponentPresent,
    opponentToken,
    createNewRoom,
    joinExistingRoom,
    sendMove,
    sendBlast,
    sendRematch,
    sendTokenSync,
    disconnect,
    setMoveHandler,
  };
}