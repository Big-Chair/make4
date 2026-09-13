/**
 * useRoom — the owning Room Module.
 *
 * One module owns create/join orchestration, subscription state, Presence-derived
 * liveness, participant projection, Player Token synchronization, cleanup, and
 * readiness. Render Modules consume the discriminated `RoomState`; the Match
 * consumes only `matchTransport`, a narrow Adapter whose identity is stable for
 * one Room generation.
 *
 * The rule this module exists to enforce — a **Ready Room** exists only when:
 *  1. the persisted Room is `playing`;
 *  2. the local Realtime channel is SUBSCRIBED;
 *  3. the local Role is known;
 *  4. persisted host and guest names and timer are known; and
 *  5. Presence confirms both host and guest liveness.
 *
 * Readiness is emitted once per Room generation: duplicate Presence syncs cannot
 * emit it twice, and a later Presence flicker cannot un-ready a live Room.
 *
 * Player Tokens are cosmetic: they never gate readiness, fall back to the Role's
 * colour default when absent, and reconcile from Presence and Broadcast whenever
 * they arrive or change.
 *
 * When the Match reports a possible Board divergence, the Room becomes
 * **interrupted**: the transport stops being `ready` (pausing Match input and its
 * timer) until the Match resumes it after snapshot acknowledgement, or the
 * resynchronization deadline fails the Room. The Room owns that timing; it never
 * interprets Board contents.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PROTOCOL_VERSION,
  colorFor,
  decodeMatchWireMessage,
  decodeRoomPresence,
  projectReadyRoom,
  type MatchWireMessage,
  type OnlineMatchTransport,
  type ReadyRoom,
  type Role,
  type RoomAdapter,
  type RoomChannel,
  type InterruptReason,
  type RoomFailure,
  type RoomPresence,
  type RoomRecord,
  type RoomState,
} from "./room";
import { supabaseRoomAdapter } from "./roomSupabaseAdapter";
import { defaultTokenFor, type TokenConfig } from "./tokens";

const POLL_INTERVAL_MS = 2000;
/** How long an interrupted Room may take to resynchronize before it fails. */
export const RESYNC_DEADLINE_MS = 20_000;

type TransportStatus = OnlineMatchTransport["status"];

export interface UseRoomReturn {
  state: RoomState;
  matchTransport: OnlineMatchTransport | null;
  create(input: { hostName: string; timerDuration: number; token: TokenConfig }): Promise<void>;
  join(input: { code: string; guestName: string; token: TokenConfig }): Promise<void>;
  updateLocalToken(token: TokenConfig): void;
  leave(): Promise<void>;
}

interface RoomInternal {
  lifecycle: "idle" | "creating" | "joining" | "active";
  record: RoomRecord | null;
  role: Role | null;
  subscribed: boolean;
  /** Liveness only — never a source of participant identity. */
  presentRoles: { host: boolean; guest: boolean };
  localToken: TokenConfig;
  peerToken: TokenConfig | null;
  failure: RoomFailure | null;
  /** Latched on the first Ready Room of a generation; readiness is emitted once. */
  ready: boolean;
  interruption: { reason: InterruptReason; deadline: number } | null;
}

const IDLE: RoomInternal = {
  lifecycle: "idle",
  record: null,
  role: null,
  subscribed: false,
  presentRoles: { host: false, guest: false },
  localToken: defaultTokenFor("red"),
  peerToken: null,
  failure: null,
  ready: false,
  interruption: null,
};

export function useRoom(adapter: RoomAdapter = supabaseRoomAdapter): UseRoomReturn {
  const [internal, setInternal] = useState<RoomInternal>(IDLE);

  const channelRef = useRef<RoomChannel | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const handlersRef = useRef(new Set<(message: MatchWireMessage) => void>());
  const transportRef = useRef<OnlineMatchTransport | null>(null);
  /** Bumped per Room generation; async work from an older generation is dropped. */
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  /** Latest local token, readable from callbacks without re-creating them. */
  const localTokenRef = useRef<TokenConfig>(IDLE.localToken);
  const roleRef = useRef<Role | null>(null);
  const lastReadyRoomRef = useRef<ReadyRoom | null>(null);
  /** Read live by the transport's `status` getter. */
  const statusRef = useRef<TransportStatus>("ready");
  const deadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDeadline = useCallback(() => {
    if (deadlineRef.current) {
      clearTimeout(deadlineRef.current);
      deadlineRef.current = null;
    }
  }, []);

  // ── Teardown: channel, polling, deadline, handlers — exactly once per generation ──
  const releaseGeneration = useCallback((): Promise<void> => {
    generationRef.current += 1;
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    clearDeadline();
    statusRef.current = "ready";
    const channel = channelRef.current;
    channelRef.current = null;
    transportRef.current = null;
    handlersRef.current.clear();
    roleRef.current = null;
    return channel ? channel.close() : Promise.resolve();
  }, [clearDeadline]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void releaseGeneration();
    };
  }, [releaseGeneration]);

  const update = useCallback((generation: number, patch: Partial<RoomInternal>) => {
    if (!mountedRef.current || generationRef.current !== generation) return;
    setInternal((prev) => ({ ...prev, ...patch }));
  }, []);

  const fail = useCallback(
    (generation: number, error: RoomFailure) => {
      if (!mountedRef.current || generationRef.current !== generation) return;
      const previousRoom = lastReadyRoomRef.current ?? undefined;
      void releaseGeneration();
      if (!mountedRef.current) return;
      setInternal({ ...IDLE, failure: error, localToken: localTokenRef.current });
      lastReadyRoomRef.current = previousRoom ?? null;
    },
    [releaseGeneration],
  );

  // ── Presence payload for this client ──
  const presencePayload = useCallback(
    (role: Role): RoomPresence => ({
      protocolVersion: PROTOCOL_VERSION,
      clientId: adapter.clientId(),
      role,
      token: localTokenRef.current,
      onlineAt: new Date().toISOString(),
    }),
    [adapter],
  );

  // ── Open the Realtime channel for a generation ──
  const openChannel = useCallback(
    (generation: number, code: string, role: Role) => {
      roleRef.current = role;

      const channel = adapter.openChannel({
        code,
        onStatus: (status, detail) => {
          if (generationRef.current !== generation) return;
          if (status === "subscribed") {
            // track() only after SUBSCRIBED — Presence before subscription is a lie.
            void channel.track(presencePayload(role));
            update(generation, { subscribed: true });
          } else if (status === "error") {
            fail(generation, {
              kind: "subscription-failed",
              message: detail || "Lost the room connection. Please try again.",
            });
          } else if (status === "closed") {
            update(generation, { subscribed: false });
          }
        },
        onPresence: (states) => {
          if (generationRef.current !== generation) return;
          const presentRoles = { host: false, guest: false };
          let peerToken: TokenConfig | null = null;
          for (const raw of states) {
            const decoded = decodeRoomPresence(raw);
            if (!decoded) {
              console.warn("[Room] Ignoring malformed presence payload:", raw);
              continue;
            }
            presentRoles[decoded.role] = true;
            // Presence carries the peer's latest token for reconciliation after
            // subscription or reconnect. It never overrides persisted identity.
            if (decoded.role !== role && decoded.token) peerToken = decoded.token;
          }
          setInternal((prev) => {
            if (generationRef.current !== generation) return prev;
            return {
              ...prev,
              presentRoles,
              peerToken: peerToken ?? prev.peerToken,
            };
          });
        },
        onMessage: (payload) => {
          if (generationRef.current !== generation) return;
          const message = decodeMatchWireMessage(payload);
          if (!message) {
            console.warn("[Room] Ignoring malformed room message:", payload);
            return;
          }
          if (message.type === "token-sync") {
            // Room state, not Match state — never forwarded to the Match.
            update(generation, { peerToken: message.token });
            return;
          }
          for (const handler of handlersRef.current) handler(message);
        },
      });

      channelRef.current = channel;

      // One transport per generation, with stable identity for the Match.
      const current = () => generationRef.current === generation;
      transportRef.current = {
        role,
        get status() {
          return current() ? statusRef.current : "interrupted";
        },
        send: async (message) => {
          if (!current()) return;
          await channelRef.current?.send(message);
        },
        subscribe: (handler) => {
          handlersRef.current.add(handler);
          return () => {
            handlersRef.current.delete(handler);
          };
        },
        interrupt: (reason) => {
          if (!current() || statusRef.current !== "ready") return;
          // Both peers are still live, so resynchronization starts at once.
          statusRef.current = "resynchronizing";
          const deadline = Date.now() + RESYNC_DEADLINE_MS;
          clearDeadline();
          deadlineRef.current = setTimeout(() => {
            deadlineRef.current = null;
            fail(generation, {
              kind: "resync-failed",
              message: "The Match could not be resynchronized in time.",
            });
          }, RESYNC_DEADLINE_MS);
          update(generation, { interruption: { reason, deadline } });
        },
        resume: () => {
          if (!current() || statusRef.current === "ready") return;
          clearDeadline();
          statusRef.current = "ready";
          update(generation, { interruption: null });
        },
        fail: (message) => {
          fail(generation, { kind: "resync-failed", message });
        },
      };
    },
    [adapter, clearDeadline, fail, presencePayload, update],
  );

  // ── Host polling: the persisted-state fallback for a guest join ──
  const startJoinPolling = useCallback(
    (generation: number, code: string) => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = setInterval(async () => {
        if (generationRef.current !== generation) return;
        const res = await adapter.fetchRoom(code);
        if (generationRef.current !== generation) return;
        if (res.ok && res.data) {
          if (res.data.status === "playing" && res.data.guestName) {
            update(generation, { record: res.data });
          }
        } else if (res.error?.status !== 404) {
          // 404 = not visible yet; keep polling. Anything else is fatal.
          fail(generation, {
            kind: "room-unavailable",
            message: res.error?.message || "Room is no longer available.",
          });
        }
      }, POLL_INTERVAL_MS);
    },
    [adapter, fail, update],
  );

  // ── Commands ──

  const create = useCallback(
    async ({
      hostName,
      timerDuration,
      token,
    }: {
      hostName: string;
      timerDuration: number;
      token: TokenConfig;
    }) => {
      void releaseGeneration();
      const generation = generationRef.current;
      lastReadyRoomRef.current = null;
      localTokenRef.current = token;
      if (mountedRef.current) {
        setInternal({ ...IDLE, lifecycle: "creating", localToken: token });
      }

      const res = await adapter.createRoom({ hostName, timerDuration });
      if (generationRef.current !== generation) return;
      if (!res.ok || !res.data) {
        fail(generation, {
          kind: "create-failed",
          message: res.error?.message || "Failed to create room. Please try again.",
        });
        return;
      }

      update(generation, { lifecycle: "active", record: res.data, role: "host" });
      openChannel(generation, res.data.code, "host");
      startJoinPolling(generation, res.data.code);
    },
    [adapter, fail, openChannel, releaseGeneration, startJoinPolling, update],
  );

  const join = useCallback(
    async ({
      code,
      guestName,
      token,
    }: {
      code: string;
      guestName: string;
      token: TokenConfig;
    }) => {
      void releaseGeneration();
      const generation = generationRef.current;
      lastReadyRoomRef.current = null;
      localTokenRef.current = token;
      if (mountedRef.current) {
        setInternal({ ...IDLE, lifecycle: "joining", localToken: token });
      }

      // Normalize the Room code exactly once, here.
      const normalized = code.toUpperCase().trim();
      const res = await adapter.joinRoom({ code: normalized, guestName });
      if (generationRef.current !== generation) return;
      if (!res.ok || !res.data) {
        fail(generation, {
          kind: "join-failed",
          message: res.error?.message || "Room not found or already full.",
        });
        return;
      }

      update(generation, { lifecycle: "active", record: res.data, role: "guest" });
      openChannel(generation, res.data.code, "guest");
    },
    [adapter, fail, openChannel, releaseGeneration, update],
  );

  const updateLocalToken = useCallback((token: TokenConfig) => {
    localTokenRef.current = token;
    setInternal((prev) => ({ ...prev, localToken: token }));
    const role = roleRef.current;
    const channel = channelRef.current;
    if (!channel || !role) return;
    // Presence for reconciliation, Broadcast for immediate peer rendering.
    void channel.track({
      protocolVersion: PROTOCOL_VERSION,
      clientId: adapter.clientId(),
      role,
      token,
      onlineAt: new Date().toISOString(),
    });
    void channel.send({ protocolVersion: PROTOCOL_VERSION, type: "token-sync", token });
  }, [adapter]);

  const leave = useCallback(async () => {
    const closed = releaseGeneration();
    lastReadyRoomRef.current = null;
    if (mountedRef.current) setInternal({ ...IDLE, localToken: localTokenRef.current });
    await closed;
  }, [releaseGeneration]);

  // ── Derived Room state ──

  const persistedReady =
    internal.record !== null &&
    internal.record.status === "playing" &&
    !!internal.record.guestName &&
    internal.role !== null;

  const bothLive = internal.presentRoles.host && internal.presentRoles.guest;
  const readyNow = persistedReady && internal.subscribed && bothLive;
  const isReady = internal.ready || readyNow;

  // Latch readiness once per generation and stop the join poll.
  useEffect(() => {
    if (!readyNow || internal.ready) return;
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setInternal((prev) => (prev.ready ? prev : { ...prev, ready: true }));
  }, [readyNow, internal.ready]);

  const state = useMemo<RoomState>(() => {
    if (internal.failure) {
      return {
        phase: "failed",
        error: internal.failure,
        ...(lastReadyRoomRef.current ? { previousRoom: lastReadyRoomRef.current } : {}),
      };
    }
    if (internal.lifecycle === "creating") return { phase: "creating" };
    if (internal.lifecycle === "joining") return { phase: "joining" };
    const record = internal.record;
    if (!record || !internal.role) return { phase: "idle" };

    if (isReady) {
      const tokens = {
        host: internal.role === "host" ? internal.localToken : internal.peerToken,
        guest: internal.role === "guest" ? internal.localToken : internal.peerToken,
      };
      const room = projectReadyRoom(record, internal.role, tokens);
      lastReadyRoomRef.current = room;
      if (internal.interruption) {
        return {
          phase: "interrupted",
          room,
          reason: internal.interruption.reason,
          reconnectDeadline: internal.interruption.deadline,
        };
      }
      return { phase: "ready", room };
    }
    if (persistedReady) return { phase: "synchronizing", room: record, role: internal.role };
    return { phase: "waiting", room: record };
    // `internal` is the single source; `isReady`/`persistedReady` derive from it.
  }, [internal, isReady, persistedReady]);

  const matchTransport =
    state.phase === "ready" || state.phase === "interrupted" ? transportRef.current : null;

  return { state, matchTransport, create, join, updateLocalToken, leave };
}

/** The colour a Role plays — re-exported so render Modules need one import. */
export { colorFor };
