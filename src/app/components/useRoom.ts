/**
 * useRoom — the owning Room Module.
 *
 * One module owns create/join orchestration, subscription state, Presence-derived
 * liveness, participant projection, Player Token synchronization, interruption,
 * cleanup, and readiness. Render Modules consume the discriminated `RoomState`;
 * the Match consumes only `matchTransport`, a narrow Adapter whose identity is
 * stable for one Room generation.
 *
 * The rule this module exists to enforce — a **Ready Room** exists only when:
 *  1. the persisted Room is `playing`;
 *  2. the local Realtime channel is SUBSCRIBED;
 *  3. the local Role is known;
 *  4. persisted host and guest names and timer are known; and
 *  5. Presence confirms both host and guest liveness.
 *
 * Readiness is emitted once per Room generation: duplicate Presence syncs cannot
 * emit it twice. At that moment both participant sessions (Presence client
 * identities) are latched for the generation.
 *
 * Player Tokens are cosmetic: they never gate readiness, fall back to the Role's
 * colour default when absent, and reconcile from Presence and Broadcast whenever
 * they arrive or change.
 *
 * A Ready Room becomes **interrupted** — the transport stops being `ready`,
 * pausing Match input and its timer — when the local channel is lost, when a
 * participant's Presence disappears, or when the Match reports a possible Board
 * divergence. Each interruption starts one 20-second deadline. Once both latched
 * sessions are live again the transport is `resynchronizing` until the Match
 * resumes it after snapshot acknowledgement. A different session identity for
 * either Role, or the deadline, fails the Room: the Match ends as no contest.
 * The Room owns that timing; it never interprets Board contents.
 *
 * Full-page reload recovery is refused: the active Room code is remembered for
 * the page session, and a Room Module that finds one on mount starts `failed`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PROTOCOL_VERSION,
  colorFor,
  decodeMatchWireMessage,
  decodeRoomPresence,
  projectReadyRoom,
  type InterruptReason,
  type MatchWireMessage,
  type OnlineMatchTransport,
  type ReadyRoom,
  type Role,
  type RoomAdapter,
  type RoomChannel,
  type RoomFailure,
  type RoomPresence,
  type RoomRecord,
  type RoomState,
} from "./room";
import { supabaseRoomAdapter } from "./roomSupabaseAdapter";
import { defaultTokenFor, type TokenConfig } from "./tokens";

const POLL_INTERVAL_MS = 2000;
/** How long an interrupted Room may take to reconnect and resynchronize before it fails. */
export const RECONNECT_DEADLINE_MS = 20_000;

type TransportStatus = OnlineMatchTransport["status"];

export interface UseRoomReturn {
  state: RoomState;
  matchTransport: OnlineMatchTransport | null;
  create(input: { hostName: string; timerDuration: number; token: TokenConfig }): Promise<void>;
  join(input: { code: string; guestName: string; token: TokenConfig }): Promise<void>;
  updateLocalToken(token: TokenConfig): void;
  leave(): Promise<void>;
}

interface Interruption {
  reason: InterruptReason;
  reconnectDeadline: number;
  resynchronizing: boolean;
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
  interruption: Interruption | null;
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

/** Liveness as last reported by the channel, readable synchronously from callbacks. */
interface Liveness {
  subscribed: boolean;
  /** Presence client identities currently live, per Role. */
  sessions: { host: string[]; guest: string[] };
}

const NO_LIVENESS: Liveness = { subscribed: false, sessions: { host: [], guest: [] } };

function reloadRefusal(code: string): RoomFailure {
  return {
    kind: "resync-failed",
    message: `Online Matches can't be resumed after a page reload, so your Match in room ${code} can't continue.`,
  };
}

function timeoutFailure(interruption: Interruption): RoomFailure {
  if (interruption.resynchronizing) {
    return { kind: "resync-failed", message: "The Match could not be resynchronized in time. It ended as no contest." };
  }
  return {
    kind: "peer-timeout",
    message:
      interruption.reason === "channel-lost"
        ? "Couldn't reconnect to the room in time. The Match ended as no contest."
        : "Your opponent didn't reconnect in time. The Match ended as no contest.",
  };
}

export function useRoom(adapter: RoomAdapter = supabaseRoomAdapter): UseRoomReturn {
  const [internal, setInternal] = useState<RoomInternal>(() => {
    const rememberedRoomCode = adapter.recallActiveRoom();
    return rememberedRoomCode ? { ...IDLE, failure: reloadRefusal(rememberedRoomCode) } : IDLE;
  });

  const channelRef = useRef<RoomChannel | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const handlersRef = useRef(new Set<(message: MatchWireMessage) => void>());
  const transportRef = useRef<OnlineMatchTransport | null>(null);
  /** Bumped per Room generation; async work from an older generation is dropped. */
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  /** Generated once for this Room Module's lifetime. */
  const clientIdRef = useRef<string | null>(null);
  if (clientIdRef.current === null) clientIdRef.current = adapter.createClientId();
  const clientId = clientIdRef.current;
  /** Latest local token, readable from callbacks without re-creating them. */
  const localTokenRef = useRef<TokenConfig>(IDLE.localToken);
  const roleRef = useRef<Role | null>(null);
  const lastReadyRoomRef = useRef<ReadyRoom | null>(null);
  const livenessRef = useRef<Liveness>(NO_LIVENESS);
  /** The participant sessions latched at readiness; null until the Room is ready. */
  const latchedSessionsRef = useRef<{ host: string; guest: string } | null>(null);
  const interruptionRef = useRef<Interruption | null>(null);
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
    interruptionRef.current = null;
    livenessRef.current = NO_LIVENESS;
    latchedSessionsRef.current = null;
    const channel = channelRef.current;
    channelRef.current = null;
    transportRef.current = null;
    handlersRef.current.clear();
    roleRef.current = null;
    adapter.rememberActiveRoom(null);
    return channel ? channel.close() : Promise.resolve();
  }, [adapter, clearDeadline]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void releaseGeneration();
    };
  }, [releaseGeneration]);

  // A Room remembered from before a reload has been refused (see the initial
  // state); forget it so the refusal is shown once.
  useEffect(() => {
    if (adapter.recallActiveRoom() && !channelRef.current) adapter.rememberActiveRoom(null);
  }, [adapter]);

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

  // ── Interruption: one deadline per interruption, whatever happens inside it ──

  const setInterruption = useCallback(
    (generation: number, interruption: Interruption | null) => {
      interruptionRef.current = interruption;
      statusRef.current = !interruption ? "ready" : interruption.resynchronizing ? "resynchronizing" : "interrupted";
      update(generation, { interruption });
    },
    [update],
  );

  const interruptRoom = useCallback(
    (generation: number, reason: InterruptReason, resynchronizing: boolean) => {
      const reconnectDeadline = Date.now() + RECONNECT_DEADLINE_MS;
      clearDeadline();
      deadlineRef.current = setTimeout(() => {
        deadlineRef.current = null;
        const interruption = interruptionRef.current;
        if (interruption) fail(generation, timeoutFailure(interruption));
      }, RECONNECT_DEADLINE_MS);
      setInterruption(generation, { reason, reconnectDeadline, resynchronizing });
    },
    [clearDeadline, fail, setInterruption],
  );

  const bothSessionsLive = () => {
    const { subscribed, sessions } = livenessRef.current;
    return subscribed && sessions.host.length > 0 && sessions.guest.length > 0;
  };

  /** Move a Ready Room between ready, interrupted, and resynchronizing as liveness changes. */
  const reconcileLiveness = useCallback(
    (generation: number) => {
      if (generationRef.current !== generation || !latchedSessionsRef.current) return;

      // Only the latched sessions may come back. A reload or any other client
      // claiming a Role would start from divergent local state: refuse it.
      const latched = latchedSessionsRef.current;
      const { sessions } = livenessRef.current;
      if (
        sessions.host.some((id) => id !== latched.host) ||
        sessions.guest.some((id) => id !== latched.guest)
      ) {
        fail(generation, {
          kind: "resync-failed",
          message: "A player rejoined from a different browser session, so the Match can't be recovered. It ended as no contest.",
        });
        return;
      }

      const live = bothSessionsLive();
      const lostReason: InterruptReason = livenessRef.current.subscribed ? "peer-left" : "channel-lost";
      const interruption = interruptionRef.current;
      if (!interruption) {
        if (!live) interruptRoom(generation, lostReason, false);
      } else if (live && !interruption.resynchronizing) {
        setInterruption(generation, { ...interruption, resynchronizing: true });
      } else if (!live && interruption.resynchronizing) {
        setInterruption(generation, { ...interruption, reason: lostReason, resynchronizing: false });
      }
    },
    [fail, interruptRoom, setInterruption],
  );

  // ── Presence payload for this client ──
  const presencePayload = useCallback(
    (role: Role): RoomPresence => ({
      protocolVersion: PROTOCOL_VERSION,
      clientId,
      role,
      token: localTokenRef.current,
      onlineAt: new Date().toISOString(),
    }),
    [clientId],
  );

  // ── Open the Realtime channel for a generation ──
  const openChannel = useCallback(
    (generation: number, code: string, role: Role) => {
      roleRef.current = role;

      const channel = adapter.openChannel({
        code,
        clientId,
        onStatus: (status, detail) => {
          if (generationRef.current !== generation) return;
          if (status === "subscribed") {
            // track() only after SUBSCRIBED — Presence before subscription is a lie.
            // Re-subscription after a lost channel re-tracks the same identity.
            void channel.track(presencePayload(role));
            livenessRef.current = { ...livenessRef.current, subscribed: true };
            update(generation, { subscribed: true });
            reconcileLiveness(generation);
            return;
          }
          if (status === "error" && !latchedSessionsRef.current) {
            fail(generation, {
              kind: "subscription-failed",
              message: detail || "Lost the room connection. Please try again.",
            });
            return;
          }
          // A Ready Room survives a lost channel as an interruption. Presence from
          // before the loss proves nothing: liveness waits for a fresh sync.
          livenessRef.current = NO_LIVENESS;
          update(generation, { subscribed: false, presentRoles: { host: false, guest: false } });
          reconcileLiveness(generation);
        },
        onPresence: (states) => {
          if (generationRef.current !== generation) return;
          const sessions: Liveness["sessions"] = { host: [], guest: [] };
          let peerToken: TokenConfig | null = null;
          for (const raw of states) {
            const decoded = decodeRoomPresence(raw);
            if (!decoded) {
              console.warn("[Room] Ignoring malformed presence payload:", raw);
              continue;
            }
            if (!sessions[decoded.role].includes(decoded.clientId)) {
              sessions[decoded.role].push(decoded.clientId);
            }
            // Presence carries the peer's latest token for reconciliation after
            // subscription or reconnect. It never overrides persisted identity.
            if (decoded.role !== role && decoded.token) peerToken = decoded.token;
          }
          livenessRef.current = { ...livenessRef.current, sessions };
          setInternal((prev) => {
            if (generationRef.current !== generation) return prev;
            return {
              ...prev,
              presentRoles: { host: sessions.host.length > 0, guest: sessions.guest.length > 0 },
              peerToken: peerToken ?? prev.peerToken,
            };
          });
          reconcileLiveness(generation);
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
          // With both sessions live, resynchronization starts at once.
          interruptRoom(generation, reason, bothSessionsLive());
        },
        resume: () => {
          if (!current() || statusRef.current !== "resynchronizing") return;
          // Completing recovery clears the deadline.
          clearDeadline();
          setInterruption(generation, null);
        },
        fail: (message) => {
          fail(generation, { kind: "resync-failed", message });
        },
      };
    },
    [adapter, clearDeadline, clientId, fail, interruptRoom, presencePayload, reconcileLiveness, setInterruption, update],
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

  const updateLocalToken = useCallback(
    (token: TokenConfig) => {
      localTokenRef.current = token;
      setInternal((prev) => ({ ...prev, localToken: token }));
      const role = roleRef.current;
      const channel = channelRef.current;
      if (!channel || !role) return;
      // Presence for reconciliation, Broadcast for immediate peer rendering.
      void channel.track(presencePayload(role));
      void channel.send({ protocolVersion: PROTOCOL_VERSION, type: "token-sync", token });
    },
    [presencePayload],
  );

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

  // Latch readiness once per generation: stop the join poll, latch both
  // participant sessions, and remember the Room so a reload can be refused.
  useEffect(() => {
    if (!readyNow || internal.ready || !internal.record) return;
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    const { sessions } = livenessRef.current;
    latchedSessionsRef.current = { host: sessions.host[0], guest: sessions.guest[0] };
    adapter.rememberActiveRoom(internal.record.code);
    setInternal((prev) => (prev.ready ? prev : { ...prev, ready: true }));
  }, [adapter, readyNow, internal.ready, internal.record]);

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
          reconnectDeadline: internal.interruption.reconnectDeadline,
          resynchronizing: internal.interruption.resynchronizing,
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
