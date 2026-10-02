/**
 * matchSync.ts — the Match side of the online wire.
 *
 * One module owns everything that keeps two peers' Matches in step: the Match
 * revision, the Match message envelopes (`protocolVersion`) and their decoding,
 * duplicate detection, the Match Snapshot request / push / acknowledge
 * handshake, and rematch legality. It has no React and no clock.
 *
 * The Match it serves speaks only in actions — it applies a Drop or Blast,
 * starts a rematch under an identity it is given, and restores a snapshot — and
 * never sees an envelope. The Room carries these messages opaquely over the
 * `OnlineMatchTransport`.
 *
 * Revisions: each successfully applied local Drop, Blast or Timeout advances the
 * revision and is broadcast with it; rejected ones do neither. A turn ends on the
 * clock only through a Timeout from the player whose turn it is, so the peer's
 * clock never moves the turn and every turn change has a revision. An incoming
 * action applies only at exactly revision + 1 on the opponent's turn. Anything else — missing,
 * duplicate, out of order, out of turn, or unplayable — interrupts the Room, and
 * the host's authoritative Match Snapshot repairs it: the guest requests it (or
 * the host pushes it when the host saw the gap), the guest restores it and
 * acknowledges the revision, and only then do both resume.
 *
 * Reconnect reuses the handshake. Once both sessions are live again the
 * transport becomes `resynchronizing` and both ends start it (the guest requests,
 * the host pushes) because either may be the only one that noticed. A peer still
 * waiting for the other session ignores it and starts its own once
 * resynchronizing. A ready guest that receives a snapshot identical to its Match
 * only acknowledges it, so a duplicate never pauses the Match again.
 *
 * Rematch: a rematch is legal only once the current Match is decided, and its
 * identity is the successor of the current one, so both peers mint the same
 * identity — simultaneous rematches collapse into one Match, and a rematch for
 * the Match already running is a duplicate. A rematch for a Match still in
 * progress here is a divergence, repaired from the host's snapshot like any
 * other; it never resets the Board.
 */
import { decodeMatchSnapshot, type MatchSnapshot } from "./matchSnapshot";
import { PROTOCOL_VERSION, colorFor, type OnlineMatchTransport } from "./room";

// ─── Match identity ───

/** Both peers start a Room's first Match under this identity. */
export const OPENING_MATCH_ID = "match-0";

const MATCH_ID = /^match-(\d+)$/;

export function isMatchId(value: unknown): value is string {
  return typeof value === "string" && MATCH_ID.test(value);
}

/** The identity a rematch of `matchId` starts — the same on both peers. */
export function nextMatchId(matchId: string): string {
  const sequence = Number(MATCH_ID.exec(matchId)?.[1] ?? 0);
  return `match-${sequence + 1}`;
}

// ─── Wire ───

/** A move. A Timeout passes the turn with no Board change; only the player whose
 *  turn it is plays it, from their own clock. */
export type MatchAction =
  | { type: "drop"; col: number }
  | { type: "blast"; row: number; col: number }
  | { type: "timeout" };

type MatchMessageBody =
  | (MatchAction & { revision: number })
  | { type: "rematch"; matchId: string }
  | { type: "snapshot-request"; requestId: string }
  | { type: "snapshot"; requestId: string; snapshot: unknown }
  | { type: "snapshot-applied"; requestId: string; revision: number };

/** Every message the Match sends its peer. `snapshot` stays opaque until decoded
 *  by `matchSnapshot.ts`. */
export type MatchMessage = MatchMessageBody & { protocolVersion: typeof PROTOCOL_VERSION };

/** Wrap a message body in the protocol envelope. */
function envelope(body: MatchMessageBody): MatchMessage {
  return { protocolVersion: PROTOCOL_VERSION, ...body };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const isNumber = (value: unknown): value is number => typeof value === "number";
const isString = (value: unknown): value is string => typeof value === "string";

/** Malformed or unknown payloads decode to `null`; they never reach the Match. */
export function decodeMatchMessage(value: unknown): MatchMessage | null {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION) return null;
  switch (value.type) {
    case "drop":
      if (!isNumber(value.revision) || !isNumber(value.col)) return null;
      return envelope({ type: "drop", revision: value.revision, col: value.col });
    case "blast":
      if (!isNumber(value.revision) || !isNumber(value.row) || !isNumber(value.col)) return null;
      return envelope({ type: "blast", revision: value.revision, row: value.row, col: value.col });
    case "timeout":
      if (!isNumber(value.revision)) return null;
      return envelope({ type: "timeout", revision: value.revision });
    case "rematch":
      if (!isMatchId(value.matchId)) return null;
      return envelope({ type: "rematch", matchId: value.matchId });
    case "snapshot-request":
      if (!isString(value.requestId)) return null;
      return envelope({ type: "snapshot-request", requestId: value.requestId });
    case "snapshot":
      if (!isString(value.requestId) || !("snapshot" in value)) return null;
      return envelope({ type: "snapshot", requestId: value.requestId, snapshot: value.snapshot });
    case "snapshot-applied":
      if (!isString(value.requestId) || !isNumber(value.revision)) return null;
      return envelope({ type: "snapshot-applied", requestId: value.requestId, revision: value.revision });
    default:
      return null;
  }
}

// ─── The synced Match ───

/** Everything a Match Snapshot captures, read live from the Match. */
export type MatchState = Omit<MatchSnapshot, "protocolVersion" | "matchId" | "revision">;

/** What the Match offers its sync: its live state and three actions. */
export interface SyncedMatch {
  read(): MatchState;
  /** Apply a Drop, Blast or Timeout for the current player. False when the rules reject it. */
  apply(action: MatchAction): boolean;
  /** Start a fresh Match under `matchId`. */
  rematch(matchId: string): void;
  /** Replace the whole Match with the host's snapshot in one batch. */
  restore(snapshot: MatchSnapshot): void;
}

export interface MatchSync {
  /** Play a local action: refused unless ready and this peer's turn; broadcast
   *  at the next revision only if the Match applied it. */
  play(action: MatchAction): boolean;
  /** Start a rematch. Refused unless ready and the current Match is decided. */
  rematch(): boolean;
  /** The transport's status changed: start or forget the snapshot handshake. */
  statusChanged(): void;
  dispose(): void;
}

function newRequestId(): string {
  return `resync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Everything a snapshot restores except clocks, for spotting a duplicate. */
function matchContent(snapshot: MatchSnapshot): string {
  return JSON.stringify([
    snapshot.matchId,
    snapshot.revision,
    snapshot.board,
    snapshot.currentPlayer,
    snapshot.winner,
    snapshot.redBlastToken,
    snapshot.yellowBlastToken,
  ]);
}

export function createMatchSync({
  transport,
  match,
}: {
  transport: OnlineMatchTransport;
  match: SyncedMatch;
}): MatchSync {
  let matchId = OPENING_MATCH_ID;
  let revision = 0;
  /** Host: snapshots sent this resynchronization, any of whose acknowledgement resumes. */
  const pendingSnapshotIds = new Set<string>();
  /** A snapshot handshake is under way for the current resynchronization. */
  let handshaking = false;
  /** Guest: every snapshot request it has sent. */
  const requestIds = new Set<string>();

  const myColor = colorFor(transport.role);
  const opponentColor = colorFor(transport.role === "host" ? "guest" : "host");
  const send = (body: MatchMessageBody) => transport.send(envelope(body));

  const createSnapshot = (): MatchSnapshot => ({
    protocolVersion: PROTOCOL_VERSION,
    matchId,
    revision,
    ...match.read(),
  });

  const sendSnapshot = (requestId: string) => {
    pendingSnapshotIds.add(requestId);
    void send({ type: "snapshot", requestId, snapshot: createSnapshot() });
  };

  const beginHandshake = () => {
    handshaking = true;
    // The host is authoritative: it pushes its snapshot for the guest to restore.
    if (transport.role === "host") sendSnapshot(newRequestId());
    else {
      const requestId = newRequestId();
      requestIds.add(requestId);
      void send({ type: "snapshot-request", requestId });
    }
  };

  const repairDivergence = () => {
    transport.interrupt("revision-gap");
    beginHandshake();
  };

  /** Answer the peer's handshake: pause (if still ready) and mark it under way. */
  const joinHandshake = () => {
    transport.interrupt("revision-gap");
    handshaking = true;
  };

  const resume = () => {
    handshaking = false;
    transport.resume();
  };

  const startRematch = (id: string) => {
    matchId = id;
    revision = 0;
    match.rematch(id);
  };

  const receiveAction = (message: Extract<MatchMessage, { type: MatchAction["type"] }>) => {
    // Mid-resynchronization, the incoming snapshot supersedes in-flight actions.
    if (transport.status !== "ready") return;
    if (message.revision !== revision + 1 || match.read().currentPlayer !== opponentColor) {
      repairDivergence();
      return;
    }
    const action: MatchAction =
      message.type === "drop"
        ? { type: "drop", col: message.col }
        : message.type === "blast"
          ? { type: "blast", row: message.row, col: message.col }
          : { type: "timeout" };
    if (!match.apply(action)) {
      repairDivergence();
      return;
    }
    revision = message.revision;
  };

  const receiveRematch = (id: string) => {
    // Mid-resynchronization the host's snapshot already carries its Match identity.
    if (transport.status !== "ready") return;
    // Both peers pressed Rematch: they minted the same identity.
    if (id === matchId) return;
    if (id === nextMatchId(matchId) && match.read().winner !== null) {
      startRematch(id);
      return;
    }
    // A rematch of a Match still in progress here (or of another Match): the
    // peers disagree. Repair from the host rather than reset the Board.
    repairDivergence();
  };

  const receiveSnapshot = (requestId: string, payload: unknown) => {
    if (transport.role !== "guest") return;
    const snapshot = decodeMatchSnapshot(payload);
    if (!snapshot || !isMatchId(snapshot.matchId)) {
      console.warn("[Match] Ignoring undecodable Match Snapshot:", payload);
      transport.fail("The host's Match Snapshot could not be read.");
      return;
    }
    // Waiting for the host's session: this peer could not resume, so it must
    // not acknowledge; it requests a snapshot once resynchronizing.
    if (transport.status === "interrupted") return;
    const acknowledge = () => send({ type: "snapshot-applied", requestId, revision: snapshot.revision });
    // A guest only requests while paused and only resumes once a handshake is
    // done, so a ready guest's own request being answered is a late duplicate —
    // play may have moved on since, and restoring it would roll that back.
    const duplicate =
      requestIds.has(requestId) || matchContent(snapshot) === matchContent(createSnapshot());
    if (transport.status === "ready" && duplicate) {
      // A duplicate of the Match already restored: acknowledge, never pause again.
      void acknowledge();
      return;
    }
    joinHandshake();
    matchId = snapshot.matchId;
    revision = snapshot.revision;
    match.restore(snapshot);
    acknowledge().then(
      () => resume(),
      () => transport.fail("Could not acknowledge the host's Match Snapshot."),
    );
  };

  const receiveAcknowledgement = (requestId: string, acknowledged: number) => {
    if (transport.role !== "host" || !pendingSnapshotIds.has(requestId)) return;
    pendingSnapshotIds.clear();
    if (acknowledged !== revision) {
      transport.fail("The guest acknowledged a different Match revision.");
      return;
    }
    resume();
  };

  const unsubscribe = transport.subscribe((payload) => {
    const message = decodeMatchMessage(payload);
    if (!message) {
      console.warn("[Match] Ignoring malformed Match message:", payload);
      return;
    }
    switch (message.type) {
      case "drop":
      case "blast":
      case "timeout":
        receiveAction(message);
        return;
      case "rematch":
        receiveRematch(message.matchId);
        return;
      case "snapshot-request":
        // While the guest's session is still missing the host could not resume on
        // its acknowledgement; it pushes its own snapshot once resynchronizing.
        if (transport.role !== "host" || transport.status === "interrupted") return;
        joinHandshake();
        sendSnapshot(message.requestId);
        return;
      case "snapshot":
        receiveSnapshot(message.requestId, message.snapshot);
        return;
      case "snapshot-applied":
        receiveAcknowledgement(message.requestId, message.revision);
        return;
    }
  });

  return {
    play(action) {
      if (transport.status !== "ready" || match.read().currentPlayer !== myColor) return false;
      if (!match.apply(action)) return false;
      revision += 1;
      void send({ ...action, revision });
      return true;
    },

    rematch() {
      if (transport.status !== "ready" || match.read().winner === null) return false;
      const id = nextMatchId(matchId);
      startRematch(id);
      void send({ type: "rematch", matchId: id });
      return true;
    },

    statusChanged() {
      if (transport.status !== "resynchronizing") {
        // Ready, or waiting for a session: any earlier handshake is over.
        handshaking = false;
        if (transport.status === "interrupted") pendingSnapshotIds.clear();
        return;
      }
      if (!handshaking) beginHandshake();
    },

    dispose: unsubscribe,
  };
}
