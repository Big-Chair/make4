/**
 * room.ts — the Room seam.
 *
 * Owns the vocabulary of an online Room: its persisted record, its discriminated
 * lifecycle state, the Ready Room projection and the two projections callers
 * consume (lobby and Match input), typed failures, the wire protocol (Presence payloads
 * and Broadcast messages), the decoders that guard that protocol, and the
 * Adapter port the owning Module (`useRoom`) talks to.
 *
 * Nothing here touches Supabase or React. The production Adapter lives in
 * `roomSupabaseAdapter.ts`; tests substitute an in-memory one.
 *
 * Two rules this module exists to enforce:
 *  - Persisted Room data is authoritative for status, Role projection, player
 *    names, timer, and Blast-token configuration. Presence proves liveness only.
 *  - Every payload crossing the wire carries `protocolVersion: 2` and is decoded
 *    here. Application state never receives a cast of an arbitrary payload.
 *    Match messages are the exception that proves it: the Room checks their
 *    envelope and hands the payload to the Match, whose sync module
 *    (`matchSync.ts`) owns and decodes that vocabulary.
 */
import type { Result } from "./api";
import type { MatchMessage } from "./matchSync";
import { defaultTokenFor, type TokenConfig } from "./tokens";

/**
 * A persisted Room in Room vocabulary. The Adapter translates the HTTP DTO
 * (`api.ts`) into this at the edge; nothing past the Adapter sees the DTO.
 */
export interface RoomRecord {
  code: string;
  hostName: string;
  guestName: string | null;
  timerDuration: number;
  blastTokens: boolean;
  status: "waiting" | "playing" | "finished";
}

/** Online players are `host` (red) or `yellow`'s `guest`. */
export type Role = "host" | "guest";

export const PROTOCOL_VERSION = 2 as const;

/** The board color a Role plays. */
export function colorFor(role: Role): "red" | "yellow" {
  return role === "host" ? "red" : "yellow";
}

// ─── Ready Room ───

export interface Participant {
  name: string;
  token: TokenConfig;
}

/**
 * A Ready Room — the only shape from which an online Match may start. It exists
 * only when the persisted Room is `playing`, the local channel is SUBSCRIBED,
 * the local Role is known, persisted participants and timer are known, and
 * Presence confirms both host and guest liveness.
 */
export interface ReadyRoom {
  code: string;
  role: Role;
  timerDuration: number;
  blastTokens: boolean;
  participants: {
    red: Participant;
    yellow: Participant;
  };
}

// ─── Failures ───

export type RoomFailure =
  | { kind: "create-failed"; message: string }
  | { kind: "join-failed"; message: string }
  | { kind: "subscription-failed"; message: string }
  | { kind: "room-unavailable"; message: string }
  | { kind: "peer-timeout"; message: string }
  | { kind: "resync-failed"; message: string };

// ─── Lifecycle ───

export type RoomState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "joining" }
  | { phase: "waiting"; room: RoomRecord }
  | { phase: "synchronizing"; room: RoomRecord; role: Role }
  | { phase: "ready"; room: ReadyRoom }
  | {
      phase: "interrupted";
      room: ReadyRoom;
      /** Epoch ms by which reconnection and resynchronization must complete, or
       *  the Room fails and the Match ends as no contest. One per interruption. */
      reconnectDeadline: number;
      reason: InterruptReason;
      /** Both participant sessions are live again and the Match Snapshot
       *  handshake is under way; false while still waiting for a session. */
      resynchronizing: boolean;
    }
  | { phase: "failed"; error: RoomFailure; previousRoom?: ReadyRoom };

/**
 * The Ready Room an online Match renders: the live one (also while interrupted),
 * or the last one if the Room failed — so a failure never blanks out the players
 * or changes which Role this player holds.
 */
function matchRoomOf(state: RoomState): ReadyRoom | null {
  if (state.phase === "ready" || state.phase === "interrupted") return state.room;
  if (state.phase === "failed") return state.previousRoom ?? null;
  return null;
}

/** Why a Ready Room stopped accepting Match input. */
export type InterruptReason = "peer-left" | "channel-lost" | "revision-gap";

// ─── Projections ───
//
// What callers consume instead of matching `RoomState` phases themselves.

/** What the lobby renders. */
export interface RoomLobby {
  /** A create or join request is in flight. */
  pending: "create" | "join" | null;
  /** The open Room whose code the lobby shows: waiting for a guest, or both
   *  joined and synchronizing into a Ready Room. */
  openRoom: { code: string; synchronizing: boolean } | null;
  /** The local player's colour; red until a Role is known. */
  color: "red" | "yellow";
  /** Why the Room failed, or null. */
  error: string | null;
}

/** Why an online Match is paused or has ended as no contest. */
export type RoomNotice =
  | { kind: "interrupted"; reason: InterruptReason; reconnectDeadline: number; resynchronizing: boolean }
  | { kind: "no-contest"; message: string };

/**
 * Everything an online Match starts from and renders: the Ready Room (also
 * while interrupted), or the last one once the Room failed — neither may blank
 * out the players mid-Match. Null before the Room was ever ready.
 */
export interface RoomMatchInput {
  role: Role;
  timerDuration: number;
  blastTokens: boolean;
  participants: ReadyRoom["participants"];
  /** True while the Room is ready or interrupted; false once it failed (no contest). */
  live: boolean;
  /** The Match's Room seam; null once the Room failed. */
  transport: OnlineMatchTransport | null;
  notice: RoomNotice | null;
}

export function roomNoticeFor(state: RoomState): RoomNotice | null {
  if (state.phase === "interrupted") {
    return {
      kind: "interrupted",
      reason: state.reason,
      reconnectDeadline: state.reconnectDeadline,
      resynchronizing: state.resynchronizing,
    };
  }
  if (state.phase === "failed") return { kind: "no-contest", message: state.error.message };
  return null;
}

export function projectLobby(state: RoomState): RoomLobby {
  const role =
    state.phase === "synchronizing" ? state.role : state.phase === "ready" ? state.room.role : null;
  return {
    pending: state.phase === "creating" ? "create" : state.phase === "joining" ? "join" : null,
    openRoom:
      state.phase === "waiting" || state.phase === "synchronizing"
        ? { code: state.room.code, synchronizing: state.phase === "synchronizing" }
        : null,
    color: role ? colorFor(role) : "red",
    error: state.phase === "failed" ? state.error.message : null,
  };
}

export function projectMatchInput(
  state: RoomState,
  transport: OnlineMatchTransport | null,
): RoomMatchInput | null {
  const room = matchRoomOf(state);
  if (!room) return null;
  const live = state.phase === "ready" || state.phase === "interrupted";
  return {
    role: room.role,
    timerDuration: room.timerDuration,
    blastTokens: room.blastTokens,
    participants: room.participants,
    live,
    transport: live ? transport : null,
    notice: roomNoticeFor(state),
  };
}

// ─── Wire protocol ───

/** Slow-changing participant state. Presence proves liveness; its `token` is the
 *  reconciliation source after subscription or reconnect. */
export interface RoomPresence {
  protocolVersion: typeof PROTOCOL_VERSION;
  clientId: string;
  role: Role;
  token: TokenConfig;
  onlineAt: string;
}

/**
 * Presence as decoded off the wire. Liveness is the part that must survive:
 * a peer whose cosmetic token is missing or malformed is still live, so token
 * data can never delay readiness.
 */
export interface DecodedRoomPresence extends Omit<RoomPresence, "token"> {
  token: TokenConfig | null;
}

/** The Room's own Broadcast: a peer's Player Token changed. Never forwarded to the Match. */
export interface TokenSyncMessage {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "token-sync";
  token: TokenConfig;
}

/** Everything on the Room's Broadcast channel: `token-sync`, or a Match message
 *  the Room carries without interpreting it. */
export type RoomMessage = TokenSyncMessage | MatchMessage;

/** A Broadcast as the Room decodes it: its own message, or an opaque Match payload. */
export type DecodedRoomMessage = TokenSyncMessage | { type: "match"; payload: unknown };

/** The single Room seam visible to the Match. Its identity is stable for one
 *  Room generation, so the Match never re-subscribes mid-Match; `status` is read
 *  live from the Room. */
export interface OnlineMatchTransport {
  role: Role;
  /** Match input and its timer run only while this is `ready`. */
  readonly status: "ready" | "interrupted" | "resynchronizing";
  send(message: MatchMessage): Promise<void>;
  /** Receives each Match payload undecoded; the Match decodes its own messages. */
  subscribe(handler: (payload: unknown) => void): () => void;
  /** The Match saw its Board may have diverged: pause and start resynchronizing.
   *  The Room owns the deadline by which `resume` must follow. No-op unless ready. */
  interrupt(reason: InterruptReason): void;
  /** This peer's snapshot acknowledgement completed: the Room is ready again.
   *  Ignored unless `resynchronizing` — a missing session cannot be resumed past. */
  resume(): void;
  /** Resynchronization cannot complete (e.g. an undecodable snapshot). */
  fail(message: string): void;
}

// ─── Decoders ───
//
// Malformed or unknown payloads are ignored and logged. They never become
// application state.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRole(value: unknown): value is Role {
  return value === "host" || value === "guest";
}

const TOKEN_TYPES: TokenConfig["type"][] = ["default", "gradient", "emoji", "image"];

const TOKEN_STRING_FIELDS = [
  "gradient",
  "highlightColor",
  "borderColor",
  "darkColor",
  "glowColor",
  "emoji",
  "imageUrl",
] as const;

function isTokenType(value: unknown): value is TokenConfig["type"] {
  return TOKEN_TYPES.includes(value as TokenConfig["type"]);
}

/** A cosmetic payload — decoded defensively, never trusted into Room identity. */
export function decodeTokenConfig(value: unknown): TokenConfig | null {
  if (!isRecord(value)) return null;
  if (!isTokenType(value.type)) return null;
  const decoded: TokenConfig = { type: value.type };
  for (const key of TOKEN_STRING_FIELDS) {
    const raw = value[key];
    if (typeof raw === "string") decoded[key] = raw;
    else if (raw !== undefined && raw !== null) return null;
  }
  return decoded;
}

export function decodeRoomPresence(value: unknown): DecodedRoomPresence | null {
  if (!isRecord(value)) return null;
  if (value.protocolVersion !== PROTOCOL_VERSION) return null;
  if (typeof value.clientId !== "string" || !value.clientId) return null;
  if (!isRole(value.role)) return null;
  if (typeof value.onlineAt !== "string") return null;
  return {
    protocolVersion: PROTOCOL_VERSION,
    clientId: value.clientId,
    role: value.role,
    // Cosmetic and optional: an absent or malformed token is simply no token.
    token: decodeTokenConfig(value.token),
    onlineAt: value.onlineAt,
  };
}

export function decodeRoomMessage(value: unknown): DecodedRoomMessage | null {
  if (!isRecord(value)) return null;
  if (value.protocolVersion !== PROTOCOL_VERSION || typeof value.type !== "string") return null;
  if (value.type !== "token-sync") return { type: "match", payload: value };
  const token = decodeTokenConfig(value.token);
  if (!token) return null;
  return { protocolVersion: PROTOCOL_VERSION, type: "token-sync", token };
}

// ─── Projection ───

/**
 * Project persisted Room data plus cosmetic token state into a Ready Room.
 * Persisted names win; a missing token falls back to the Role's colour default,
 * which is why token data can never delay readiness.
 */
export function projectReadyRoom(
  record: RoomRecord,
  role: Role,
  tokens: { host: TokenConfig | null; guest: TokenConfig | null },
): ReadyRoom {
  return {
    code: record.code,
    role,
    timerDuration: record.timerDuration,
    blastTokens: record.blastTokens,
    participants: {
      red: { name: record.hostName, token: tokens.host ?? defaultTokenFor("red") },
      yellow: { name: record.guestName ?? "Player 2", token: tokens.guest ?? defaultTokenFor("yellow") },
    },
  };
}

// ─── Adapter port ───

export type ChannelStatus = "subscribed" | "closed" | "error";

export interface RoomChannel {
  /** Publish this client's Presence payload. Called only after `subscribed`. */
  track(payload: RoomPresence): Promise<void>;
  /** Broadcast a Room or Match message to the peer. */
  send(message: RoomMessage): Promise<void>;
  /** Release the channel. Idempotent. */
  close(): Promise<void>;
}

export interface OpenChannelInput {
  code: string;
  /** This Room Module's client identity — also the channel's Presence key. */
  clientId: string;
  onStatus: (status: ChannelStatus, detail?: string) => void;
  /** Raw Presence states for the whole channel — decoded by the Room Module. */
  onPresence: (states: unknown[]) => void;
  /** A raw broadcast payload — decoded by the Room Module. */
  onMessage: (payload: unknown) => void;
}

/**
 * The Room's port onto the outside world: persisted Room HTTP plus a Realtime
 * channel. `roomSupabaseAdapter.ts` implements it for production; tests use an
 * in-memory implementation with controllable results and transitions.
 */
export interface RoomAdapter {
  createRoom(input: {
    hostName: string;
    timerDuration: number;
    blastTokens?: boolean;
  }): Promise<Result<RoomRecord>>;
  joinRoom(input: { code: string; guestName: string }): Promise<Result<RoomRecord>>;
  fetchRoom(code: string): Promise<Result<RoomRecord>>;
  openChannel(input: OpenChannelInput): RoomChannel;
  /** A fresh client identity. The Room Module asks once for its lifetime; only a
   *  participant that returns with the same identity may reconnect. */
  createClientId(): string;
  /** The Room code that was active in this page session before a full reload, if any. */
  recallActiveRoom(): string | null;
  /** Remember (or, with `null`, forget) the active Room so a reload can be refused. */
  rememberActiveRoom(code: string | null): void;
}
