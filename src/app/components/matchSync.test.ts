/**
 * Match sync tests — two Match sync modules over a fake transport, no React.
 *
 * Each peer's Match is a tiny stand-in that applies Drops and Blasts to a Board,
 * so these tests pin the protocol itself: revisions, envelopes, duplicate
 * detection, the Snapshot handshake, and rematch legality.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchSnapshot } from "./matchSnapshot";
import {
  OPENING_MATCH_ID,
  createMatchSync,
  decodeMatchMessage,
  type MatchAction,
  type MatchMessage,
  type MatchState,
  type MatchSync,
  type SyncedMatch,
} from "./matchSync";
import type { InterruptReason, OnlineMatchTransport, Role } from "./room";
import { COLS, ROWS, type Board } from "./useConnect4";

// ─── Fake transport ───

type Status = OnlineMatchTransport["status"];

class Wire {
  queue: { to: FakeTransport; payload: unknown }[] = [];
  /** Messages matching this predicate are lost in transit. */
  lose: ((message: MatchMessage) => boolean) | null = null;
  transports: FakeTransport[] = [];

  transmit(from: FakeTransport, message: MatchMessage) {
    const to = this.transports.find((transport) => transport !== from);
    if (!to || this.lose?.(message)) return;
    this.queue.push({ to, payload: JSON.parse(JSON.stringify(message)) });
  }

  /** Deliver the next queued message only, letting its continuations settle. */
  async step() {
    const next = this.queue.shift();
    next?.to.receive(next.payload);
    for (let i = 0; i < 3; i++) await Promise.resolve();
  }

  async flush() {
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.to.receive(next.payload);
      await Promise.resolve();
    }
    // Let acknowledgement continuations settle.
    for (let i = 0; i < 3; i++) await Promise.resolve();
  }
}

class FakeTransport implements OnlineMatchTransport {
  status: Status = "ready";
  sent: MatchMessage[] = [];
  interrupts: InterruptReason[] = [];
  failures: string[] = [];
  private handlers = new Set<(payload: unknown) => void>();

  constructor(
    readonly role: Role,
    private readonly wire: Wire,
  ) {
    wire.transports.push(this);
  }

  send(message: MatchMessage) {
    this.sent.push(message);
    this.wire.transmit(this, message);
    return Promise.resolve();
  }
  subscribe(handler: (payload: unknown) => void) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
  interrupt(reason: InterruptReason) {
    if (this.status !== "ready") return;
    this.interrupts.push(reason);
    this.status = "resynchronizing";
  }
  resume() {
    if (this.status === "resynchronizing") this.status = "ready";
  }
  fail(message: string) {
    this.failures.push(message);
  }
  receive(payload: unknown) {
    for (const handler of this.handlers) handler(payload);
  }
}

// ─── Fake Match ───

const emptyBoard = (): Board => Array.from({ length: ROWS }, () => Array(COLS).fill(null));

const freshState = (): MatchState => ({
  board: emptyBoard(),
  currentPlayer: "red",
  winner: null,
  winningCells: null,
  redBlastToken: true,
  yellowBlastToken: true,
  timer: 0,
  countdown: 0,
});

/** A stand-in Match: Drops fall, Blasts clear one cell, turns alternate. */
function fakeMatch(): SyncedMatch & {
  state: MatchState;
  applied: MatchAction[];
  rematches: string[];
  restores: MatchSnapshot[];
} {
  const match = {
    state: freshState(),
    applied: [] as MatchAction[],
    rematches: [] as string[],
    restores: [] as MatchSnapshot[],
    read: () => match.state,
    apply(action: MatchAction) {
      const { state } = match;
      if (state.winner) return false;
      const board = state.board.map((row) => [...row]);
      if (action.type === "timeout") {
        // The turn passes with no Board change.
      } else if (action.type === "drop") {
        const row = board.map((cells) => cells[action.col]).lastIndexOf(null);
        if (row < 0) return false;
        board[row][action.col] = state.currentPlayer;
      } else {
        if (board[action.row][action.col] === null) return false;
        board[action.row][action.col] = null;
      }
      match.state = {
        ...state,
        board,
        currentPlayer: state.currentPlayer === "red" ? "yellow" : "red",
      };
      match.applied.push(action);
      return true;
    },
    rematch(matchId: string) {
      match.rematches.push(matchId);
      match.state = freshState();
    },
    restore(snapshot: MatchSnapshot) {
      match.restores.push(snapshot);
      const { protocolVersion: _v, matchId: _id, revision: _r, ...state } = snapshot;
      match.state = state;
    },
  };
  return match;
}

// ─── Peers ───

function peer(wire: Wire, role: Role) {
  const transport = new FakeTransport(role, wire);
  const match = fakeMatch();
  const sync = createMatchSync({ transport, match });
  const sentOfType = <T extends MatchMessage["type"]>(type: T) =>
    transport.sent.filter((message): message is Extract<MatchMessage, { type: T }> => message.type === type);
  return { transport, match, sync, sentOfType };
}

type Peer = ReturnType<typeof peer>;

let syncs: MatchSync[] = [];

function pair() {
  const wire = new Wire();
  const host = peer(wire, "host");
  const guest = peer(wire, "guest");
  syncs.push(host.sync, guest.sync);
  return { wire, host, guest };
}

/** The Room says both sessions are back: every peer starts resynchronizing. */
function resynchronize(...peers: Peer[]) {
  for (const p of peers) {
    p.transport.status = "resynchronizing";
    p.sync.statusChanged();
  }
}

const actions = (p: Peer) =>
  p.transport.sent.filter((m) => m.type === "drop" || m.type === "blast" || m.type === "timeout");

/** Play Drops alternately until red has four in column 0. */
async function playRedWin({ host, guest, wire }: ReturnType<typeof pair>) {
  for (let i = 0; i < 3; i++) {
    host.sync.play({ type: "drop", col: 0 });
    await wire.flush();
    guest.sync.play({ type: "drop", col: 1 });
    await wire.flush();
  }
  host.sync.play({ type: "drop", col: 0 });
  await wire.flush();
  // The stand-in Match has no win detection: decide it on both Boards.
  host.match.state = { ...host.match.state, winner: "red" };
  guest.match.state = { ...guest.match.state, winner: "red" };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const sync of syncs) sync.dispose();
  syncs = [];
  vi.restoreAllMocks();
});

// ─── Envelopes ───

describe("wire envelopes", () => {
  it("decodes only protocol-1 Match messages with well-typed fields", () => {
    expect(decodeMatchMessage({ type: "drop", revision: 1, col: 3 })).toBeNull();
    expect(decodeMatchMessage({ protocolVersion: 1, type: "drop", revision: 1, col: 3 })).toBeNull();
    expect(decodeMatchMessage({ protocolVersion: 2, type: "teleport", col: 3 })).toBeNull();
    expect(decodeMatchMessage({ protocolVersion: 2, type: "drop", revision: 1, col: "3" })).toBeNull();
    expect(decodeMatchMessage({ protocolVersion: 2, type: "token-sync", token: { type: "default" } })).toBeNull();
    expect(decodeMatchMessage({ protocolVersion: 2, type: "rematch", matchId: "not-a-match" })).toBeNull();
    expect(decodeMatchMessage({ protocolVersion: 2, type: "timeout" })).toBeNull();
    expect(decodeMatchMessage("junk")).toBeNull();

    expect(decodeMatchMessage({ protocolVersion: 2, type: "drop", revision: 1, col: 3 })).toEqual({
      protocolVersion: 2,
      type: "drop",
      revision: 1,
      col: 3,
    });
    expect(decodeMatchMessage({ protocolVersion: 2, type: "timeout", revision: 4 })).toEqual({
      protocolVersion: 2,
      type: "timeout",
      revision: 4,
    });
    expect(decodeMatchMessage({ protocolVersion: 2, type: "rematch", matchId: "match-2" })).toEqual({
      protocolVersion: 2,
      type: "rematch",
      matchId: "match-2",
    });
  });

  it("ignores a malformed payload without touching the Match", () => {
    const { host } = pair();
    host.transport.receive({ protocolVersion: 2, type: "drop", col: "3" });
    expect(host.match.applied).toEqual([]);
    expect(host.transport.status).toBe("ready");
  });
});

// ─── Revisions ───

describe("revisions", () => {
  it("applies and broadcasts local actions at the next revision, and the peer applies them", async () => {
    const { wire, host, guest } = pair();

    expect(host.sync.play({ type: "drop", col: 3 })).toBe(true);
    await wire.flush();
    expect(guest.sync.play({ type: "drop", col: 3 })).toBe(true);
    await wire.flush();

    expect(actions(host)).toEqual([{ protocolVersion: 2, type: "drop", revision: 1, col: 3 }]);
    expect(actions(guest)).toEqual([{ protocolVersion: 2, type: "drop", revision: 2, col: 3 }]);
    expect(guest.match.state.board).toEqual(host.match.state.board);
    expect(guest.transport.status).toBe("ready");
  });

  it("neither advances the revision nor broadcasts a rejected action", async () => {
    const { wire, host } = pair();

    expect(host.sync.play({ type: "blast", row: 5, col: 3 })).toBe(false);
    expect(host.sync.play({ type: "drop", col: 2 })).toBe(true);
    await wire.flush();

    expect(actions(host)).toEqual([{ protocolVersion: 2, type: "drop", revision: 1, col: 2 }]);
  });

  it("refuses local actions on the opponent's turn or while not ready", () => {
    const { host, guest } = pair();

    expect(guest.sync.play({ type: "drop", col: 2 })).toBe(false);
    host.transport.status = "interrupted";
    expect(host.sync.play({ type: "drop", col: 2 })).toBe(false);

    expect(actions(host)).toEqual([]);
    expect(actions(guest)).toEqual([]);
    expect(host.match.applied).toEqual([]);
  });

  it.each([
    ["missing", 3],
    ["duplicate", 1],
    ["out-of-order", 0],
  ])("interrupts instead of applying a %s action", async (_label, revision) => {
    const { wire, host, guest } = pair();
    host.sync.play({ type: "drop", col: 3 });
    await wire.flush();
    const board = guest.match.state.board;

    guest.transport.receive({ protocolVersion: 2, type: "drop", revision, col: 5 });

    expect(guest.match.state.board).toEqual(board);
    expect(guest.transport.interrupts).toEqual(["revision-gap"]);
    expect(guest.sentOfType("snapshot-request")).toHaveLength(1);
  });

  it("interrupts on an action at the right revision that is out of turn or unplayable", () => {
    const { host, guest } = pair();

    // Red moves first, so a "guest" Drop at revision 1 is out of turn for the guest's opponent.
    host.transport.receive({ protocolVersion: 2, type: "drop", revision: 1, col: 5 });
    expect(host.transport.interrupts).toEqual(["revision-gap"]);

    guest.transport.receive({ protocolVersion: 2, type: "blast", revision: 1, row: 5, col: 5 });
    expect(guest.transport.interrupts).toEqual(["revision-gap"]);
    expect(guest.match.applied).toEqual([]);
  });

  it("ignores actions while resynchronizing: the snapshot supersedes them", () => {
    const { guest } = pair();
    guest.transport.status = "resynchronizing";
    guest.transport.receive({ protocolVersion: 2, type: "drop", revision: 1, col: 5 });
    expect(guest.match.applied).toEqual([]);
    expect(guest.sentOfType("snapshot-request")).toHaveLength(0);
  });
});

// ─── Timeout ───

describe("timeout", () => {
  it("broadcasts a Timeout at the next revision, and the peer passes the turn on it", async () => {
    const { wire, host, guest } = pair();

    expect(host.sync.play({ type: "timeout" })).toBe(true);
    await wire.flush();

    expect(actions(host)).toEqual([{ protocolVersion: 2, type: "timeout", revision: 1 }]);
    expect(guest.match.applied).toEqual([{ type: "timeout" }]);
    expect(guest.match.state.currentPlayer).toBe("yellow");

    // The Timeout took a revision: the guest's next move is revision 2.
    expect(guest.sync.play({ type: "drop", col: 3 })).toBe(true);
    await wire.flush();
    expect(actions(guest)).toEqual([{ protocolVersion: 2, type: "drop", revision: 2, col: 3 }]);
    expect(host.match.state.board).toEqual(guest.match.state.board);
    expect(host.transport.status).toBe("ready");
    expect(guest.transport.status).toBe("ready");
  });

  it("refuses a Timeout on the opponent's turn or while not ready", () => {
    const { host, guest } = pair();

    expect(guest.sync.play({ type: "timeout" })).toBe(false);
    host.transport.status = "interrupted";
    expect(host.sync.play({ type: "timeout" })).toBe(false);

    expect(actions(host)).toEqual([]);
    expect(actions(guest)).toEqual([]);
    expect(host.match.applied).toEqual([]);
  });

  it.each([
    ["missing", 3],
    ["duplicate", 1],
  ])("interrupts instead of applying a %s Timeout", async (_label, revision) => {
    const { wire, host, guest } = pair();
    host.sync.play({ type: "drop", col: 3 });
    await wire.flush();

    guest.transport.receive({ protocolVersion: 2, type: "timeout", revision });

    expect(guest.match.state.currentPlayer).toBe("yellow");
    expect(guest.transport.interrupts).toEqual(["revision-gap"]);
    expect(guest.sentOfType("snapshot-request")).toHaveLength(1);
  });

  it("interrupts on a Timeout at the right revision that is out of turn", () => {
    const { host } = pair();

    // Red's turn: only the host may time it out.
    host.transport.receive({ protocolVersion: 2, type: "timeout", revision: 1 });

    expect(host.transport.interrupts).toEqual(["revision-gap"]);
    expect(host.match.applied).toEqual([]);
  });
});

// ─── Snapshot handshake ───

describe("snapshot handshake", () => {
  it("guest requests, restores the host snapshot, and acknowledges before either resumes", async () => {
    const { wire, host, guest } = pair();
    wire.lose = (message) => message.type === "drop";
    host.sync.play({ type: "drop", col: 3 });
    await wire.flush();
    wire.lose = null;

    guest.transport.receive({ protocolVersion: 2, type: "drop", revision: 2, col: 4 });
    const [request] = guest.sentOfType("snapshot-request");
    expect(request).toBeDefined();

    // Hold the acknowledgement: the host must not resume without it.
    wire.lose = (message) => message.type === "snapshot-applied";
    await wire.flush();
    expect(host.transport.status).toBe("resynchronizing");
    expect(host.sync.play({ type: "drop", col: 1 })).toBe(false);

    const [snapshot] = host.sentOfType("snapshot");
    expect(snapshot.requestId).toBe(request.requestId);
    expect(snapshot.snapshot).toMatchObject({ protocolVersion: 2, matchId: OPENING_MATCH_ID, revision: 1 });
    expect(guest.match.state.board).toEqual(host.match.state.board);
    expect(guest.transport.status).toBe("ready");
    const [ack] = guest.sentOfType("snapshot-applied");
    expect(ack).toEqual({ protocolVersion: 2, type: "snapshot-applied", requestId: request.requestId, revision: 1 });

    wire.lose = null;
    host.transport.receive(JSON.parse(JSON.stringify(ack)));
    expect(host.transport.status).toBe("ready");

    // Play continues from the restored revision.
    expect(guest.sync.play({ type: "drop", col: 4 })).toBe(true);
    await wire.flush();
    expect(actions(guest)).toEqual([{ protocolVersion: 2, type: "drop", revision: 2, col: 4 }]);
    expect(host.match.state.board).toEqual(guest.match.state.board);
  });

  it("host pushes its snapshot when it detects the gap", async () => {
    const { wire, host, guest } = pair();
    host.sync.play({ type: "drop", col: 3 });
    await wire.flush();
    // The guest's reply is lost; the host then sees a later revision.
    wire.lose = (message) => message.type === "drop";
    guest.sync.play({ type: "drop", col: 4 });
    await wire.flush();
    wire.lose = null;

    host.transport.receive({ protocolVersion: 2, type: "drop", revision: 3, col: 5 });
    expect(host.sentOfType("snapshot")).toHaveLength(1);
    await wire.flush();

    expect(guest.match.restores).toHaveLength(1);
    expect(guest.match.state.board).toEqual(host.match.state.board);
    expect(host.transport.status).toBe("ready");
    expect(guest.transport.status).toBe("ready");
  });

  it("only acknowledges a snapshot identical to the Match a ready guest already has", async () => {
    const { wire, host, guest } = pair();
    host.sync.play({ type: "drop", col: 3 });
    await wire.flush();

    host.transport.status = "resynchronizing";
    host.sync.statusChanged();
    await wire.flush();

    expect(guest.sentOfType("snapshot-applied")).toHaveLength(1);
    expect(guest.transport.interrupts).toEqual([]);
    expect(guest.match.restores).toEqual([]);
    expect(host.transport.status).toBe("ready");
  });

  it("never rolls a resumed guest back to a late answer to its own request", async () => {
    const { wire, host, guest } = pair();
    host.sync.play({ type: "drop", col: 3 });
    await wire.flush();

    // Both ends start: the host pushes S1 while the guest requests S2.
    resynchronize(host, guest);
    await wire.step(); // S1 reaches the guest: restore, acknowledge, resume
    await wire.step(); // the request reaches the host: it answers with S2
    await wire.step(); // the acknowledgement of S1 resumes the host
    expect(host.transport.status).toBe("ready");
    expect(guest.transport.status).toBe("ready");

    // The guest moves before the late S2 arrives.
    expect(guest.sync.play({ type: "drop", col: 4 })).toBe(true);
    const board = guest.match.state.board;
    await wire.flush();

    expect(guest.match.restores).toHaveLength(1);
    expect(guest.match.state.board).toEqual(board);
    expect(host.match.state.board).toEqual(board);
    expect(guest.transport.status).toBe("ready");
    expect(host.transport.status).toBe("ready");
  });

  it("fails resynchronization on an undecodable snapshot", () => {
    const { guest } = pair();
    guest.transport.receive({ protocolVersion: 2, type: "snapshot", requestId: "r1", snapshot: { board: "junk" } });
    expect(guest.transport.failures).toHaveLength(1);
    expect(guest.match.restores).toEqual([]);
  });

  it("fails resynchronization when the guest acknowledges another revision", async () => {
    const { wire, host } = pair();
    resynchronize(host);
    const [snapshot] = host.sentOfType("snapshot");
    await wire.flush();
    host.transport.failures = [];

    host.transport.receive({ protocolVersion: 2, type: "snapshot-applied", requestId: snapshot.requestId, revision: 7 });
    // The guest's real acknowledgement already resumed the host; a stray one is ignored.
    expect(host.transport.failures).toEqual([]);

    resynchronize(host);
    const latest = host.sentOfType("snapshot").at(-1);
    wire.queue = [];
    host.transport.receive({ protocolVersion: 2, type: "snapshot-applied", requestId: latest?.requestId, revision: 7 });
    expect(host.transport.failures).toHaveLength(1);
    expect(host.transport.status).toBe("resynchronizing");
  });

  it("does not answer the handshake while still waiting for the other session", async () => {
    const { wire, host, guest } = pair();
    guest.transport.status = "interrupted";
    guest.sync.statusChanged();
    resynchronize(host);
    await wire.flush();

    // The guest could not resume, so it must not acknowledge.
    expect(guest.sentOfType("snapshot-applied")).toHaveLength(0);
    expect(host.transport.status).toBe("resynchronizing");

    host.transport.status = "interrupted";
    host.sync.statusChanged();
    host.transport.receive({ protocolVersion: 2, type: "snapshot-request", requestId: "r9" });
    expect(host.sentOfType("snapshot")).toHaveLength(1);
  });

  it("runs the handshake from both ends once both sessions are back", async () => {
    const { wire, host, guest } = pair();
    resynchronize(host, guest);
    resynchronize(host, guest); // a repeated status report starts nothing new

    expect(host.sentOfType("snapshot")).toHaveLength(1);
    expect(guest.sentOfType("snapshot-request")).toHaveLength(1);
    await wire.flush();

    expect(host.transport.status).toBe("ready");
    expect(guest.transport.status).toBe("ready");
  });
});

// ─── Rematch ───

describe("rematch", () => {
  it("cannot reset a Match that is still in progress", async () => {
    const { wire, host, guest } = pair();
    host.sync.play({ type: "drop", col: 3 });
    await wire.flush();

    expect(host.sync.rematch()).toBe(false);
    expect(guest.sync.rematch()).toBe(false);
    await wire.flush();

    expect(host.sentOfType("rematch")).toEqual([]);
    expect(host.match.rematches).toEqual([]);
    expect(guest.match.rematches).toEqual([]);
  });

  it("does not let a peer's rematch reset a Match still in progress here", async () => {
    const { wire, host, guest } = pair();
    host.sync.play({ type: "drop", col: 3 });
    await wire.flush();
    const board = host.match.state.board;

    guest.transport.receive({ protocolVersion: 2, type: "rematch", matchId: "match-1" });
    host.transport.receive({ protocolVersion: 2, type: "rematch", matchId: "match-1" });
    await wire.flush();

    expect(host.match.rematches).toEqual([]);
    expect(guest.match.rematches).toEqual([]);
    expect(host.match.state.board).toEqual(board);
    // The disagreement is repaired from the host's Match, not by resetting it.
    expect(guest.match.state.board).toEqual(board);
    expect(host.transport.status).toBe("ready");
    expect(guest.transport.status).toBe("ready");
  });

  it("starts a fresh Match identity at revision zero once the Match is decided", async () => {
    const ctx = pair();
    const { wire, host, guest } = ctx;
    await playRedWin(ctx);

    expect(guest.sync.rematch()).toBe(true);
    await wire.flush();

    expect(guest.sentOfType("rematch")).toEqual([{ protocolVersion: 2, type: "rematch", matchId: "match-1" }]);
    expect(host.match.rematches).toEqual(["match-1"]);
    expect(guest.match.rematches).toEqual(["match-1"]);

    host.sync.play({ type: "drop", col: 2 });
    await wire.flush();
    expect(actions(host).at(-1)).toEqual({ protocolVersion: 2, type: "drop", revision: 1, col: 2 });
    expect(guest.match.state.board).toEqual(host.match.state.board);
    expect(guest.transport.interrupts).toEqual([]);
  });

  it("gives simultaneous rematches exactly one new Match identity", async () => {
    const ctx = pair();
    const { wire, host, guest } = ctx;
    await playRedWin(ctx);

    // Both press Rematch before either hears the other.
    expect(host.sync.rematch()).toBe(true);
    expect(guest.sync.rematch()).toBe(true);
    await wire.flush();

    expect(host.match.rematches).toEqual(["match-1"]);
    expect(guest.match.rematches).toEqual(["match-1"]);
    expect(host.transport.interrupts).toEqual([]);
    expect(guest.transport.interrupts).toEqual([]);

    // Both play on as one Match: the snapshot carries the shared identity.
    host.sync.play({ type: "drop", col: 2 });
    await wire.flush();
    resynchronize(host, guest);
    expect(host.sentOfType("snapshot").at(-1)?.snapshot).toMatchObject({ matchId: "match-1", revision: 1 });
    await wire.flush();
    expect(host.transport.failures).toEqual([]);
    expect(host.transport.status).toBe("ready");
    expect(guest.match.state.board).toEqual(host.match.state.board);
  });

  it("ignores a rematch that arrives mid-resynchronization", async () => {
    const ctx = pair();
    const { host } = ctx;
    await playRedWin(ctx);
    host.transport.status = "resynchronizing";

    host.transport.receive({ protocolVersion: 2, type: "rematch", matchId: "match-1" });
    expect(host.sync.rematch()).toBe(false);

    expect(host.match.rematches).toEqual([]);
    expect(host.transport.interrupts).toEqual([]);
  });
});
