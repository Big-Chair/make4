/**
 * room.ts — the Room seam.
 *
 * Owns the vocabulary of an online Room: its discriminated lifecycle state, the
 * Ready Room projection, typed failures, the wire protocol (Presence payloads
 * and Broadcast messages), the decoders that guard that protocol, and the
 * Adapter port the owning Module (`useRoom`) talks to.
 *
 * Nothing here touches Supabase or React. The production Adapter lives in
 * `roomSupabaseAdapter.ts`; tests substitute an in-memory one.
 *
 * Two rules this module exists to enforce:
 *  - Persisted Room data is authoritative for status, Role projection, player
 *    names, timer, and Blast-token configuration. Presence proves liveness only.
 *  - Every payload crossing the wire carries `protocolVersion: 1` and is decoded
 *    here. Application state never receives a cast of an arbitrary payload.
 */
import type { Room as RoomRecord } from "./api";
import { defaultTokenFor, type TokenConfig } from "./tokens";

export type { RoomRecord };

/** Online players are `host` (red) or `yellow`'s `guest`. */
export type Role = "host" | "guest";

export const PROTOCOL_VERSION = 1 as const;

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
      /** Epoch ms by which resynchronization must complete, or the Room fails. */
      reconnectDeadline: number;
      reason: InterruptReason;
    }
  | { phase: "failed"; error: RoomFailure; previousRoom?: ReadyRoom };

/** Why a Ready Room stopped accepting Match input. */
export type InterruptReason = "revision-gap";

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

/** Broadcast messages. `token-sync` is Room state and is never forwarded to the
 *  Match; the rest cross the Match transport.
 *
 *  A `snapshot` payload is opaque to the Room: the Match owns its contents and
 *  decodes it (`matchSnapshot.ts`), so the Room never interprets Board state. */
export type MatchWireMessage =
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "drop"; revision: number; col: number }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "blast"; revision: number; row: number; col: number }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "rematch"; matchId: string }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "token-sync"; token: TokenConfig }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "snapshot-request"; requestId: string }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "snapshot"; requestId: string; snapshot: unknown }
  | { protocolVersion: typeof PROTOCOL_VERSION; type: "snapshot-applied"; requestId: string; revision: number };

/** The single Room seam visible to the Match. Its identity is stable for one
 *  Room generation, so the Match never re-subscribes mid-Match; `status` is read
 *  live from the Room. */
export interface OnlineMatchTransport {
  role: Role;
  /** Match input and its timer run only while this is `ready`. */
  readonly status: "ready" | "interrupted" | "resynchronizing";
  send(message: MatchWireMessage): Promise<void>;
  subscribe(handler: (message: MatchWireMessage) => void): () => void;
  /** The Match saw its Board may have diverged: pause and start resynchronizing.
   *  The Room owns the deadline by which `resume` must follow. No-op unless ready. */
  interrupt(reason: InterruptReason): void;
  /** This peer's snapshot acknowledgement completed: the Room is ready again. */
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

export function decodeMatchWireMessage(value: unknown): MatchWireMessage | null {
  if (!isRecord(value)) return null;
  if (value.protocolVersion !== PROTOCOL_VERSION) return null;
  switch (value.type) {
    case "drop":
      if (typeof value.revision !== "number" || typeof value.col !== "number") return null;
      return { protocolVersion: PROTOCOL_VERSION, type: "drop", revision: value.revision, col: value.col };
    case "blast":
      if (
        typeof value.revision !== "number" ||
        typeof value.row !== "number" ||
        typeof value.col !== "number"
      ) {
        return null;
      }
      return {
        protocolVersion: PROTOCOL_VERSION,
        type: "blast",
        revision: value.revision,
        row: value.row,
        col: value.col,
      };
    case "rematch":
      if (typeof value.matchId !== "string") return null;
      return { protocolVersion: PROTOCOL_VERSION, type: "rematch", matchId: value.matchId };
    case "token-sync": {
      const token = decodeTokenConfig(value.token);
      if (!token) return null;
      return { protocolVersion: PROTOCOL_VERSION, type: "token-sync", token };
    }
    case "snapshot-request":
      if (typeof value.requestId !== "string") return null;
      return { protocolVersion: PROTOCOL_VERSION, type: "snapshot-request", requestId: value.requestId };
    case "snapshot":
      if (typeof value.requestId !== "string" || !("snapshot" in value)) return null;
      return {
        protocolVersion: PROTOCOL_VERSION,
        type: "snapshot",
        requestId: value.requestId,
        snapshot: value.snapshot,
      };
    case "snapshot-applied":
      if (typeof value.requestId !== "string" || typeof value.revision !== "number") return null;
      return {
        protocolVersion: PROTOCOL_VERSION,
        type: "snapshot-applied",
        requestId: value.requestId,
        revision: value.revision,
      };
    default:
      return null;
  }
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
  /** Broadcast a Match/Room message to the peer. */
  send(message: MatchWireMessage): Promise<void>;
  /** Release the channel. Idempotent. */
  close(): Promise<void>;
}

export interface OpenChannelInput {
  code: string;
  onStatus: (status: ChannelStatus, detail?: string) => void;
  /** Raw Presence states for the whole channel — decoded by the Room Module. */
  onPresence: (states: unknown[]) => void;
  /** A raw broadcast payload — decoded by the Room Module. */
  onMessage: (payload: unknown) => void;
}

export interface RoomApiResult<T> {
  ok: boolean;
  data?: T;
  error?: { status?: number; message: string };
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
  }): Promise<RoomApiResult<RoomRecord>>;
  joinRoom(input: { code: string; guestName: string }): Promise<RoomApiResult<RoomRecord>>;
  fetchRoom(code: string): Promise<RoomApiResult<RoomRecord>>;
  openChannel(input: OpenChannelInput): RoomChannel;
  /** Identity for this browser session; same-session reconnect is recognized by it. */
  clientId(): string;
}
