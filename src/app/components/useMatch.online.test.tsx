/**
 * Match/Room seam tests — two real peers, each a Room Module plus a Match,
 * linked by an in-memory network the test controls.
 *
 * The network can hold, drop, duplicate, or reorder Broadcast messages, which is
 * how a revision gap is produced. Nothing here touches Supabase or renders UI.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROTOCOL_VERSION,
  type MatchWireMessage,
  type OpenChannelInput,
  type RoomAdapter,
  type RoomChannel,
  type RoomPresence,
  type RoomRecord,
} from "./room";
import type { TokenConfig } from "./tokens";
import { useMatch } from "./useMatch";
import { useRoom } from "./useRoom";

// ─── In-memory network ───

type Envelope = { from: FakeChannel; to: FakeChannel; payload: unknown };

class FakeNetwork {
  channels: FakeChannel[] = [];
  queue: Envelope[] = [];
  /** Messages matching this predicate are lost in transit. */
  lose: ((message: MatchWireMessage) => boolean) | null = null;

  transmit(from: FakeChannel, message: MatchWireMessage) {
    const to = this.channels.find((channel) => channel !== from);
    if (!to) return;
    if (this.lose?.(message)) return;
    // A JSON round trip, as the real wire would do.
    this.queue.push({ from, to, payload: JSON.parse(JSON.stringify(message)) });
  }

  /** Deliver every queued message, including replies sent while delivering. */
  async flush() {
    while (this.queue.length > 0) {
      const envelope = this.queue.shift();
      envelope?.to.input.onMessage(envelope.payload);
      await Promise.resolve();
    }
  }
}

class FakeChannel implements RoomChannel {
  sent: MatchWireMessage[] = [];

  constructor(
    readonly input: OpenChannelInput,
    readonly network: FakeNetwork,
  ) {
    network.channels.push(this);
  }

  track(_payload: RoomPresence) {
    return Promise.resolve();
  }
  send(message: MatchWireMessage) {
    this.sent.push(message);
    this.network.transmit(this, message);
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

const DEFAULT_TOKEN: TokenConfig = { type: "default" };

const playingRecord: RoomRecord = {
  code: "ABCD",
  hostName: "Ana",
  guestName: "Bo",
  timerDuration: 0,
  blastTokens: true,
  status: "playing",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function presence(role: "host" | "guest"): RoomPresence {
  return {
    protocolVersion: PROTOCOL_VERSION,
    clientId: `client-${role}`,
    role,
    token: { type: "default" },
    onlineAt: "2026-01-01T00:00:00.000Z",
  };
}

function fakeAdapter(network: FakeNetwork, role: "host" | "guest") {
  const channels: FakeChannel[] = [];
  const adapter: RoomAdapter = {
    async createRoom() {
      return { ok: true, data: { ...playingRecord, guestName: null, status: "waiting" } };
    },
    async joinRoom() {
      return { ok: true, data: playingRecord };
    },
    async fetchRoom() {
      return { ok: true, data: playingRecord };
    },
    openChannel(input) {
      const channel = new FakeChannel(input, network);
      channels.push(channel);
      return channel;
    },
    clientId: () => `client-${role}`,
  };
  return { adapter, channel: () => channels[channels.length - 1] };
}

// ─── Peers ───

function visibleState(match: ReturnType<typeof useMatch>) {
  return JSON.stringify({
    board: match.board,
    currentPlayer: match.currentPlayer,
    winner: match.winner,
    redBlastToken: match.redBlastToken,
    yellowBlastToken: match.yellowBlastToken,
  });
}

function renderPeer(opts: { network: FakeNetwork; role: "host" | "guest"; timerDuration: number }) {
  const { adapter, channel } = fakeAdapter(opts.network, opts.role);
  const onGameEnd = vi.fn();
  /** What each render showed — used to prove a snapshot restore is atomic. */
  const renders: string[] = [];
  const view = renderHook(() => {
    const room = useRoom(adapter);
    const match = useMatch({
      gameMode: "online",
      difficulty: "easy",
      timerDuration: opts.timerDuration,
      soundEnabled: false,
      transport: room.matchTransport ?? undefined,
      onGameEnd,
    });
    renders.push(visibleState(match));
    return { room, match };
  });
  return {
    channel,
    onGameEnd,
    renders,
    get room() {
      return view.result.current.room;
    },
    get match() {
      return view.result.current.match;
    },
  };
}

type Peer = ReturnType<typeof renderPeer>;

/** Advance time a second at a time, so each tick's re-render can schedule the next. */
async function elapse(ms: number) {
  for (let t = 0; t < ms; t += 1000) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(1000, ms - t));
    });
  }
}

/** Bring a host and a guest to a Ready Room and past the pre-game countdown. */
async function startReadyMatch({ timerDuration = 0 }: { timerDuration?: number } = {}) {
  const network = new FakeNetwork();
  const host = renderPeer({ network, role: "host", timerDuration });
  const guest = renderPeer({ network, role: "guest", timerDuration });

  await act(async () => {
    await host.room.create({ hostName: "Ana", timerDuration, token: DEFAULT_TOKEN });
  });
  await act(async () => {
    await guest.room.join({ code: "ABCD", guestName: "Bo", token: DEFAULT_TOKEN });
  });
  act(() => {
    for (const peer of [host, guest]) {
      peer.channel().input.onStatus("subscribed");
      peer.channel().input.onPresence([presence("host"), presence("guest")]);
    }
  });
  // The host learns the guest joined from its persisted-state poll.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(host.room.state.phase).toBe("ready");
  expect(guest.room.state.phase).toBe("ready");

  await elapse(4000);
  expect(host.match.countdown).toBe(0);
  expect(guest.match.countdown).toBe(0);

  const flush = () =>
    act(async () => {
      await network.flush();
    });
  return { network, host, guest, flush };
}

const sentActions = (peer: Peer) =>
  peer.channel().sent.filter((message) => message.type === "drop" || message.type === "blast");

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Valid sequencing ───

describe("action sequencing", () => {
  it("broadcasts each applied action with protocol version 1 and the resulting revision", async () => {
    const { host, guest, flush } = await startReadyMatch();

    act(() => host.match.drop(3));
    await flush();
    act(() => guest.match.drop(3));
    await flush();
    act(() => host.match.drop(4));
    await flush();

    expect(sentActions(host)).toEqual([
      { protocolVersion: 1, type: "drop", revision: 1, col: 3 },
      { protocolVersion: 1, type: "drop", revision: 3, col: 4 },
    ]);
    expect(sentActions(guest)).toEqual([{ protocolVersion: 1, type: "drop", revision: 2, col: 3 }]);
    expect(guest.match.board).toEqual(host.match.board);
    expect(guest.match.currentPlayer).toBe("yellow");
    expect(host.room.matchTransport?.status).toBe("ready");
    expect(guest.room.matchTransport?.status).toBe("ready");
  });
});

// ─── Rejected local actions ───

describe("rejected local actions", () => {
  it("does not broadcast or advance the revision for a Drop into a full column", async () => {
    const { host, guest, flush } = await startReadyMatch();

    for (let i = 0; i < 3; i++) {
      act(() => host.match.drop(0));
      await flush();
      act(() => guest.match.drop(0));
      await flush();
    }
    const before = sentActions(host).length;

    act(() => host.match.drop(0)); // column 0 is full
    await flush();
    expect(sentActions(host)).toHaveLength(before);

    act(() => host.match.drop(1));
    await flush();
    expect(sentActions(host).at(-1)).toEqual({ protocolVersion: 1, type: "drop", revision: 7, col: 1 });
    expect(guest.match.board).toEqual(host.match.board);
    expect(guest.room.matchTransport?.status).toBe("ready");
  });

  it("does not broadcast a Blast on an empty cell", async () => {
    const { host, guest, flush } = await startReadyMatch();

    act(() => host.match.blast(5, 3));
    await flush();
    expect(sentActions(host)).toHaveLength(0);

    act(() => host.match.drop(2));
    await flush();
    expect(sentActions(host)).toEqual([{ protocolVersion: 1, type: "drop", revision: 1, col: 2 }]);
    expect(guest.room.matchTransport?.status).toBe("ready");
  });

  it("does not broadcast on the opponent's turn", async () => {
    const { guest, flush } = await startReadyMatch();

    act(() => guest.match.drop(2));
    await flush();
    expect(sentActions(guest)).toHaveLength(0);
  });
});

// ─── Revision gaps ───

/** Deliver a raw payload straight to a peer, as if it came off the wire. */
function receive(peer: Peer, payload: unknown) {
  act(() => peer.channel().input.onMessage(payload));
}

const sentOfType = <T extends MatchWireMessage["type"]>(peer: Peer, type: T) =>
  peer
    .channel()
    .sent.filter((message): message is Extract<MatchWireMessage, { type: T }> => message.type === type);

describe("revision gaps", () => {
  it.each([
    ["missing", 3],
    ["duplicate", 1],
    ["out-of-order", 0],
  ])("pauses instead of applying a %s action", async (_label, revision) => {
    const { host, guest, flush } = await startReadyMatch();
    act(() => host.match.drop(3));
    await flush();
    const board = guest.match.board;

    // The guest is at revision 1 and expects revision 2 next.
    receive(guest, { protocolVersion: 1, type: "drop", revision, col: 5 });

    expect(guest.match.board).toEqual(board);
    expect(guest.room.state.phase).toBe("interrupted");
    expect(guest.room.state.phase === "interrupted" && guest.room.state.reason).toBe("revision-gap");
    expect(guest.room.matchTransport?.status).toBe("resynchronizing");
    expect(guest.match.inputDisabled).toBe(true);
    act(() => guest.match.drop(0));
    expect(sentActions(guest)).toHaveLength(0);
  });

  it("pauses the Match timer while resynchronizing", async () => {
    const { host, guest, flush } = await startReadyMatch({ timerDuration: 40 });
    act(() => host.match.drop(3));
    await flush();
    await elapse(2000);
    const timer = guest.match.timer;
    expect(timer).toBeLessThan(40);

    receive(guest, { protocolVersion: 1, type: "drop", revision: 7, col: 5 });
    await elapse(5000);

    expect(guest.match.timer).toBe(timer);
  });
});

// ─── Snapshot repair ───

describe("snapshot repair", () => {
  it("guest requests the host snapshot, restores it, and acknowledges before both resume", async () => {
    const { network, host, guest, flush } = await startReadyMatch();
    // The host's first Drop is lost: the Boards now disagree.
    network.lose = (message) => message.type === "drop";
    act(() => host.match.drop(3));
    await flush();
    network.lose = null;
    expect(guest.match.board).not.toEqual(host.match.board);

    receive(guest, { protocolVersion: 1, type: "drop", revision: 2, col: 4 });
    expect(sentOfType(guest, "snapshot-request")).toHaveLength(1);

    await flush();

    const [snapshot] = sentOfType(host, "snapshot");
    expect(snapshot.requestId).toBe(sentOfType(guest, "snapshot-request")[0].requestId);
    expect(snapshot.snapshot).toMatchObject({ protocolVersion: 1, revision: 1, currentPlayer: "yellow" });
    expect(sentOfType(guest, "snapshot-applied")).toEqual([
      { protocolVersion: 1, type: "snapshot-applied", requestId: snapshot.requestId, revision: 1 },
    ]);

    expect(guest.match.board).toEqual(host.match.board);
    expect(guest.match.currentPlayer).toBe("yellow");
    expect(host.room.state.phase).toBe("ready");
    expect(guest.room.state.phase).toBe("ready");

    // Play continues from the repaired revision.
    act(() => guest.match.drop(4));
    await flush();
    expect(sentActions(guest)).toEqual([{ protocolVersion: 1, type: "drop", revision: 2, col: 4 }]);
    expect(host.match.board).toEqual(guest.match.board);
    expect(host.room.matchTransport?.status).toBe("ready");
  });

  it("does not resume either peer before the acknowledgement completes", async () => {
    const { network, host, guest, flush } = await startReadyMatch();
    let guestStatusWhenAcking: string | undefined;
    const transmit = network.transmit.bind(network);
    network.transmit = (from, message) => {
      if (message.type === "snapshot-applied") {
        guestStatusWhenAcking = guest.room.matchTransport?.status;
        return; // held: the host never hears it
      }
      transmit(from, message);
    };

    receive(guest, { protocolVersion: 1, type: "drop", revision: 5, col: 4 });
    await flush();

    expect(guestStatusWhenAcking).toBe("resynchronizing");
    expect(host.room.state.phase).toBe("interrupted");
    expect(host.room.matchTransport?.status).toBe("resynchronizing");
    act(() => host.match.drop(1));
    expect(sentActions(host)).toHaveLength(0);
  });

  it("replaces divergent guest state atomically", async () => {
    const { network, host, guest, flush } = await startReadyMatch();
    act(() => host.match.drop(3));
    await flush();
    act(() => guest.match.drop(3));
    await flush();
    // The host's Blast is lost: Board, turn, and Blast Tokens all diverge.
    network.lose = (message) => message.type === "blast";
    act(() => host.match.blast(5, 3));
    await flush();
    network.lose = null;

    const before = visibleState(guest.match);
    const after = visibleState(host.match);
    expect(before).not.toEqual(after);
    const firstRender = guest.renders.length;

    receive(guest, { protocolVersion: 1, type: "drop", revision: 9, col: 0 });
    await flush();

    expect(visibleState(guest.match)).toEqual(after);
    // Every render in between showed the old Match or the new one — never a mix.
    for (const render of guest.renders.slice(firstRender)) {
      expect([before, after]).toContain(render);
    }
  });

  it("host pushes its snapshot when it detects the gap", async () => {
    const { network, host, guest, flush } = await startReadyMatch();
    act(() => host.match.drop(3));
    await flush();
    // The guest's reply is lost; the host then sees a later revision.
    network.lose = (message) => message.type === "drop";
    act(() => guest.match.drop(4));
    await flush();
    network.lose = null;

    receive(host, { protocolVersion: 1, type: "drop", revision: 3, col: 5 });
    expect(host.room.state.phase).toBe("interrupted");
    expect(sentOfType(host, "snapshot")).toHaveLength(1);

    await flush();

    expect(guest.match.board).toEqual(host.match.board);
    expect(guest.match.currentPlayer).toBe("yellow");
    expect(host.room.state.phase).toBe("ready");
    expect(guest.room.state.phase).toBe("ready");
  });

  it("turns an undecodable snapshot into a resynchronization failure", async () => {
    const { guest } = await startReadyMatch();
    const board = guest.match.board;

    receive(guest, { protocolVersion: 1, type: "snapshot", requestId: "r1", snapshot: { board: "junk" } });

    expect(guest.room.state.phase).toBe("failed");
    expect(guest.room.state.phase === "failed" && guest.room.state.error.kind).toBe("resync-failed");
    expect(guest.match.board).toEqual(board);
    expect(guest.match.inputDisabled).toBe(true);
  });

  it("turns a missing acknowledgement into a resynchronization failure", async () => {
    const { network, host, guest, flush } = await startReadyMatch();
    network.lose = (message) => message.type === "snapshot-applied";

    receive(guest, { protocolVersion: 1, type: "drop", revision: 5, col: 4 });
    await flush();
    expect(host.room.state.phase).toBe("interrupted");

    await elapse(20_000);

    expect(host.room.state.phase).toBe("failed");
    expect(host.room.state.phase === "failed" && host.room.state.error.kind).toBe("resync-failed");
    expect(host.match.inputDisabled).toBe(true);
  });

  it("turns a missing snapshot reply into a resynchronization failure", async () => {
    const { network, guest, flush } = await startReadyMatch();
    network.lose = (message) => message.type === "snapshot";

    receive(guest, { protocolVersion: 1, type: "drop", revision: 5, col: 4 });
    await flush();
    await elapse(20_000);

    expect(guest.room.state.phase).toBe("failed");
    expect(guest.room.state.phase === "failed" && guest.room.state.error.kind).toBe("resync-failed");
  });
});

// ─── Winner recording ───

describe("winner recording", () => {
  it("does not record a winner again when restoring a decided snapshot", async () => {
    const { host, guest, flush } = await startReadyMatch();
    for (let i = 0; i < 3; i++) {
      act(() => host.match.drop(0));
      await flush();
      act(() => guest.match.drop(1));
      await flush();
    }
    act(() => host.match.drop(0));
    await flush();
    expect(host.match.winner).toBe("red");
    expect(guest.match.winner).toBe("red");
    expect(guest.onGameEnd).toHaveBeenCalledTimes(1);

    receive(guest, { protocolVersion: 1, type: "drop", revision: 99, col: 4 });
    await flush();

    expect(sentOfType(guest, "snapshot-applied")).toHaveLength(1);
    expect(guest.match.winner).toBe("red");
    expect(guest.onGameEnd).toHaveBeenCalledTimes(1);
    expect(host.onGameEnd).toHaveBeenCalledTimes(1);
  });
});

// ─── Rematch ───

describe("rematch", () => {
  it("ignores a rematch that arrives mid-resynchronization", async () => {
    const { network, host, guest, flush } = await startReadyMatch();
    act(() => host.match.drop(3));
    await flush();
    // The guest's acknowledgement is lost, so the host stays resynchronizing.
    network.lose = (message) => message.type === "snapshot-applied";
    receive(guest, { protocolVersion: 1, type: "drop", revision: 9, col: 0 });
    await flush();
    expect(host.room.matchTransport?.status).toBe("resynchronizing");
    const board = host.match.board;

    act(() => guest.match.reset());
    await flush();

    expect(sentOfType(guest, "rematch")).toHaveLength(1);
    expect(host.match.board).toEqual(board);
    expect(host.room.state.phase).toBe("interrupted");
  });

  it("starts a fresh Match identity with revision zero", async () => {
    const { host, guest, flush } = await startReadyMatch();
    act(() => host.match.drop(3));
    await flush();
    receive(guest, { protocolVersion: 1, type: "drop", revision: 9, col: 0 });
    await flush();
    const firstMatch = sentOfType(host, "snapshot")[0].snapshot as { matchId: string };

    act(() => host.match.reset());
    await flush();
    const [rematch] = sentOfType(host, "rematch");
    expect(rematch.matchId).not.toBe(firstMatch.matchId);
    await elapse(4000);

    act(() => host.match.drop(2));
    await flush();
    expect(sentActions(host).at(-1)).toEqual({ protocolVersion: 1, type: "drop", revision: 1, col: 2 });
    expect(guest.match.board).toEqual(host.match.board);

    receive(guest, { protocolVersion: 1, type: "drop", revision: 9, col: 0 });
    await flush();
    expect(sentOfType(host, "snapshot").at(-1)?.snapshot).toMatchObject({
      matchId: rematch.matchId,
      revision: 1,
    });
    expect(guest.room.state.phase).toBe("ready");
  });
});
