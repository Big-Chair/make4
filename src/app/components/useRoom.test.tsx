/**
 * Room Module tests — written against the Room Interface, not Supabase.
 *
 * Everything the Room touches arrives through an in-memory Adapter with
 * controllable HTTP results, subscription transitions, Presence snapshots,
 * broadcasts, and teardown, driven with fake timers. No network, no Realtime,
 * no rendering of the lobby.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROTOCOL_VERSION,
  type MatchWireMessage,
  type OpenChannelInput,
  type RoomAdapter,
  type RoomApiResult,
  type RoomChannel,
  type RoomPresence,
  type RoomRecord,
  type RoomState,
} from "./room";
import { DEFAULT_PALETTE, type TokenConfig } from "./tokens";
import { useRoom } from "./useRoom";

// ─── In-memory Adapter ───

class FakeChannel implements RoomChannel {
  tracked: RoomPresence[] = [];
  sent: MatchWireMessage[] = [];
  closeCount = 0;

  constructor(readonly input: OpenChannelInput) {}

  track(payload: RoomPresence) {
    this.tracked.push(payload);
    return Promise.resolve();
  }
  send(message: MatchWireMessage) {
    this.sent.push(message);
    return Promise.resolve();
  }
  close() {
    this.closeCount++;
    return Promise.resolve();
  }

  // ── Controls a test drives the Room with ──
  subscribed() {
    this.input.onStatus("subscribed");
  }
  errored(detail = "channel error") {
    this.input.onStatus("error", detail);
  }
  closed() {
    this.input.onStatus("closed");
  }
  presence(states: unknown[]) {
    this.input.onPresence(states);
  }
  message(payload: unknown) {
    this.input.onMessage(payload);
  }
}

function roomRecord(overrides: Partial<RoomRecord> = {}): RoomRecord {
  return {
    code: "ABCD",
    hostName: "Ana",
    guestName: null,
    timerDuration: 40,
    blastTokens: true,
    status: "waiting",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const playingRecord = (overrides: Partial<RoomRecord> = {}) =>
  roomRecord({ guestName: "Bo", status: "playing", ...overrides });

function createFakeAdapter() {
  const state = {
    createResult: { ok: true, data: roomRecord() } as RoomApiResult<RoomRecord>,
    joinResult: { ok: true, data: playingRecord() } as RoomApiResult<RoomRecord>,
    fetchResult: { ok: true, data: roomRecord() } as RoomApiResult<RoomRecord>,
    fetchCalls: 0,
    joinedCodes: [] as string[],
    channels: [] as FakeChannel[],
    clientIdsCreated: 0,
    /** What a page-session store would still hold across a reload. */
    activeRoom: null as string | null,
  };

  const adapter: RoomAdapter = {
    async createRoom() {
      return state.createResult;
    },
    async joinRoom({ code }) {
      state.joinedCodes.push(code);
      return state.joinResult;
    },
    async fetchRoom() {
      state.fetchCalls++;
      return state.fetchResult;
    },
    openChannel(input) {
      const channel = new FakeChannel(input);
      state.channels.push(channel);
      return channel;
    },
    createClientId: () => {
      state.clientIdsCreated++;
      return `client-under-test-${state.clientIdsCreated}`;
    },
    recallActiveRoom: () => state.activeRoom,
    rememberActiveRoom: (code) => {
      state.activeRoom = code;
    },
  };

  return { adapter, state, channel: () => state.channels[state.channels.length - 1] };
}

const RED: TokenConfig = { type: "gradient", gradient: "red-gradient" };
const BLUE: TokenConfig = { type: "gradient", gradient: "blue-gradient" };

function presence(
  role: "host" | "guest",
  { token = { type: "default" }, clientId = `client-${role}` }: { token?: TokenConfig; clientId?: string } = {},
): RoomPresence {
  return {
    protocolVersion: PROTOCOL_VERSION,
    clientId,
    role,
    token,
    onlineAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Render the Room Module, recording every phase it passes through. */
function renderRoom(adapter: RoomAdapter) {
  const phases: RoomState["phase"][] = [];
  const view = renderHook(() => {
    const room = useRoom(adapter);
    phases.push(room.state.phase);
    return room;
  });
  return { ...view, phases };
}

const readyTransitions = (phases: RoomState["phase"][]) =>
  phases.filter((phase, i) => phase === "ready" && phases[i - 1] !== "ready").length;

async function hostRoom(adapter: RoomAdapter) {
  const view = renderRoom(adapter);
  await act(async () => {
    await view.result.current.create({ hostName: "Ana", timerDuration: 40, token: RED });
  });
  return view;
}

async function guestRoom(adapter: RoomAdapter) {
  const view = renderRoom(adapter);
  await act(async () => {
    await view.result.current.join({ code: "abcd", guestName: "Bo", token: BLUE });
  });
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── 1. Persisted `playing` is not readiness ───

describe("readiness gating", () => {
  it("does not make the host ready from persisted playing without guest Presence", async () => {
    const { adapter, state, channel } = createFakeAdapter();
    const { result } = await hostRoom(adapter);

    expect(result.current.state.phase).toBe("waiting");

    act(() => channel().subscribed());
    state.fetchResult = { ok: true, data: playingRecord() };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Persisted playing + SUBSCRIBED, but Presence has not proven both peers live.
    expect(result.current.state.phase).toBe("synchronizing");
    expect(result.current.matchTransport).toBeNull();

    act(() => channel().presence([presence("host", { token: RED })]));
    expect(result.current.state.phase).toBe("synchronizing");

    act(() => channel().presence([presence("host", { token: RED }), presence("guest", { token: BLUE })]));
    expect(result.current.state.phase).toBe("ready");
  });

  it("does not make the guest ready before the channel is SUBSCRIBED", async () => {
    const { adapter, channel } = createFakeAdapter();
    const { result } = await guestRoom(adapter);

    expect(result.current.state.phase).toBe("synchronizing");

    // Even with both peers live in Presence, an unsubscribed channel is not ready.
    act(() => channel().presence([presence("host", { token: RED }), presence("guest", { token: BLUE })]));
    expect(result.current.state.phase).toBe("synchronizing");
    expect(result.current.matchTransport).toBeNull();

    act(() => channel().subscribed());
    expect(result.current.state.phase).toBe("ready");
    expect(result.current.matchTransport).not.toBeNull();
  });

  it("normalizes the room code once on join", async () => {
    const { adapter, state } = createFakeAdapter();
    await guestRoom(adapter);
    expect(state.joinedCodes).toEqual(["ABCD"]);
  });

  it("tracks Presence only after SUBSCRIBED", async () => {
    const { adapter, channel } = createFakeAdapter();
    await hostRoom(adapter);

    expect(channel().tracked).toHaveLength(0);
    act(() => channel().subscribed());
    expect(channel().tracked).toHaveLength(1);
    expect(channel().tracked[0]).toMatchObject({ role: "host", token: RED, protocolVersion: 1 });
  });
});

// ─── 3./4. Ordering and exactly-once readiness ───

describe("ordering and exactly-once readiness", () => {
  it("converges when persisted state arrives before Presence", async () => {
    const { adapter, state, channel } = createFakeAdapter();
    const { result, phases } = await hostRoom(adapter);

    act(() => channel().subscribed());
    state.fetchResult = { ok: true, data: playingRecord() };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    act(() => channel().presence([presence("host"), presence("guest")]));

    expect(result.current.state.phase).toBe("ready");
    expect(readyTransitions(phases)).toBe(1);
  });

  it("converges when Presence arrives before persisted state", async () => {
    const { adapter, state, channel } = createFakeAdapter();
    const { result, phases } = await hostRoom(adapter);

    act(() => channel().subscribed());
    act(() => channel().presence([presence("host"), presence("guest")]));
    expect(result.current.state.phase).toBe("waiting");

    state.fetchResult = { ok: true, data: playingRecord() };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(result.current.state.phase).toBe("ready");
    expect(readyTransitions(phases)).toBe(1);
  });

  it("emits readiness once across duplicate Presence syncs", async () => {
    const { adapter, state, channel } = createFakeAdapter();
    const { result, phases } = await hostRoom(adapter);

    act(() => channel().subscribed());
    state.fetchResult = { ok: true, data: playingRecord() };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const both = [presence("host"), presence("guest")];
    act(() => channel().presence(both));
    const transport = result.current.matchTransport;

    act(() => channel().presence(both));
    act(() => channel().presence(both));

    expect(result.current.state.phase).toBe("ready");
    expect(readyTransitions(phases)).toBe(1);
    // The Match's seam keeps its identity for the whole Room generation.
    expect(result.current.matchTransport).toBe(transport);
  });

  it("stops join polling once the Room is ready", async () => {
    const { adapter, state, channel } = createFakeAdapter();
    await hostRoom(adapter);

    act(() => channel().subscribed());
    state.fetchResult = { ok: true, data: playingRecord() };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    act(() => channel().presence([presence("host"), presence("guest")]));

    const callsAtReady = state.fetchCalls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(state.fetchCalls).toBe(callsAtReady);
  });
});

// ─── 5./6./7. Player Tokens are cosmetic ───

describe("player tokens", () => {
  it("uses the role-coloured default when the peer token is missing, without delaying readiness", async () => {
    const { adapter, channel } = createFakeAdapter();
    const { result } = await guestRoom(adapter);

    act(() => channel().subscribed());
    // Host Presence carries no usable token payload at all.
    act(() =>
      channel().presence([
        { protocolVersion: 1, clientId: "c", role: "host", onlineAt: "now" },
        presence("guest", { token: BLUE }),
      ]),
    );

    expect(result.current.state.phase).toBe("ready");
    const room = result.current.state.phase === "ready" ? result.current.state.room : null;
    expect(room?.participants.red.token).toEqual({ type: "default" });
    expect(room?.participants.yellow.token).toEqual(BLUE);
    // The default red palette is what the board will draw.
    expect(DEFAULT_PALETTE.red.bg).toBeTruthy();
  });

  it("applies a late token-sync to the active projection", async () => {
    const { adapter, channel } = createFakeAdapter();
    const { result } = await guestRoom(adapter);

    act(() => channel().subscribed());
    act(() => channel().presence([presence("host"), presence("guest", { token: BLUE })]));
    expect(result.current.state.phase).toBe("ready");

    act(() =>
      channel().message({ protocolVersion: 1, type: "token-sync", token: RED } satisfies MatchWireMessage),
    );

    const room = result.current.state.phase === "ready" ? result.current.state.room : null;
    expect(room?.participants.red.token).toEqual(RED);
    // Still one Ready Room — a cosmetic change never restarts the Match.
    expect(result.current.state.phase).toBe("ready");
  });

  it("reconciles the peer token from Presence after a re-sync", async () => {
    const { adapter, channel } = createFakeAdapter();
    const { result } = await guestRoom(adapter);

    act(() => channel().subscribed());
    act(() => channel().presence([presence("host"), presence("guest", { token: BLUE })]));

    const updatedHostToken: TokenConfig = { type: "emoji", emoji: "🔥" };
    act(() => channel().presence([presence("host", { token: updatedHostToken }), presence("guest", { token: BLUE })]));

    const room = result.current.state.phase === "ready" ? result.current.state.room : null;
    expect(room?.participants.red.token).toEqual(updatedHostToken);
  });

  it("broadcasts and re-tracks the local token, and never forwards token-sync to the Match", async () => {
    const { adapter, channel } = createFakeAdapter();
    const { result } = await guestRoom(adapter);

    act(() => channel().subscribed());
    act(() => channel().presence([presence("host"), presence("guest", { token: BLUE })]));

    const received: MatchWireMessage[] = [];
    act(() => {
      result.current.matchTransport?.subscribe((message) => received.push(message));
    });

    const mine: TokenConfig = { type: "gradient", gradient: "mine" };
    act(() => result.current.updateLocalToken(mine));

    expect(channel().sent.at(-1)).toEqual({ protocolVersion: 1, type: "token-sync", token: mine });
    expect(channel().tracked.at(-1)?.token).toEqual(mine);
    const room = result.current.state.phase === "ready" ? result.current.state.room : null;
    expect(room?.participants.yellow.token).toEqual(mine);

    act(() => channel().message({ protocolVersion: 1, type: "token-sync", token: RED }));
    expect(received).toHaveLength(0);
  });
});

// ─── 8. Failures are values ───

describe("failures", () => {
  it("maps a create failure", async () => {
    const { adapter, state } = createFakeAdapter();
    state.createResult = { ok: false, error: { status: 429, message: "at capacity" } };
    const { result } = await hostRoom(adapter);

    expect(result.current.state).toEqual({
      phase: "failed",
      error: { kind: "create-failed", message: "at capacity" },
    });
  });

  it("maps a join failure", async () => {
    const { adapter, state } = createFakeAdapter();
    state.joinResult = { ok: false, error: { status: 404, message: "no such room" } };
    const { result } = await guestRoom(adapter);

    expect(result.current.state.phase).toBe("failed");
    expect(result.current.state.phase === "failed" && result.current.state.error).toEqual({
      kind: "join-failed",
      message: "no such room",
    });
  });

  it("maps a subscription failure", async () => {
    const { adapter, channel } = createFakeAdapter();
    const { result } = await hostRoom(adapter);

    act(() => channel().errored("websocket died"));

    expect(result.current.state.phase).toBe("failed");
    expect(result.current.state.phase === "failed" && result.current.state.error).toEqual({
      kind: "subscription-failed",
      message: "websocket died",
    });
  });

  it("keeps polling through a 404 and fails on anything else", async () => {
    const { adapter, state } = createFakeAdapter();
    const { result } = await hostRoom(adapter);

    state.fetchResult = { ok: false, error: { status: 404, message: "not visible yet" } };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(result.current.state.phase).toBe("waiting");
    expect(state.fetchCalls).toBeGreaterThanOrEqual(2);

    state.fetchResult = { ok: false, error: { status: 500, message: "Room is gone." } };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.state.phase).toBe("failed");
    expect(result.current.state.phase === "failed" && result.current.state.error).toEqual({
      kind: "room-unavailable",
      message: "Room is gone.",
    });
  });

  it("ignores malformed presence and broadcast payloads instead of casting them", async () => {
    const { adapter, channel } = createFakeAdapter();
    const { result } = await guestRoom(adapter);

    act(() => channel().subscribed());
    // Wrong protocol version, unknown type, and junk — none of it reaches state.
    act(() =>
      channel().presence([{ protocolVersion: 99, role: "host" }, "nonsense", presence("guest", { token: BLUE })]),
    );
    expect(result.current.state.phase).toBe("synchronizing");

    act(() => channel().presence([presence("host"), presence("guest", { token: BLUE })]));
    const received: MatchWireMessage[] = [];
    act(() => {
      result.current.matchTransport?.subscribe((message) => received.push(message));
    });

    act(() => channel().message({ type: "drop", col: 3 })); // no protocolVersion
    act(() => channel().message({ protocolVersion: 2, type: "drop", revision: 1, col: 3 }));
    act(() => channel().message({ protocolVersion: 1, type: "teleport", col: 3 }));
    act(() => channel().message({ protocolVersion: 1, type: "drop", col: "3" }));
    expect(received).toHaveLength(0);

    act(() => channel().message({ protocolVersion: 1, type: "drop", revision: 1, col: 3 }));
    expect(received).toEqual([{ protocolVersion: 1, type: "drop", revision: 1, col: 3 }]);
  });
});

// ─── 9. Cleanup ───

describe("cleanup", () => {
  it("closes the channel, stops polling and drops handlers exactly once on leave", async () => {
    const { adapter, state, channel } = createFakeAdapter();
    const { result } = await hostRoom(adapter);
    const opened = channel();

    act(() => opened.subscribed());
    state.fetchResult = { ok: true, data: playingRecord() };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    act(() => opened.presence([presence("host"), presence("guest")]));

    const received: MatchWireMessage[] = [];
    act(() => {
      result.current.matchTransport?.subscribe((message) => received.push(message));
    });

    await act(async () => {
      await result.current.leave();
    });

    expect(opened.closeCount).toBe(1);
    expect(result.current.state).toEqual({ phase: "idle" });
    expect(result.current.matchTransport).toBeNull();

    const callsAfterLeave = state.fetchCalls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(state.fetchCalls).toBe(callsAfterLeave);

    // A late broadcast from the closed generation reaches nobody.
    act(() => opened.message({ protocolVersion: 1, type: "drop", revision: 1, col: 3 }));
    expect(received).toHaveLength(0);
  });

  it("closes the channel exactly once on unmount", async () => {
    const { adapter, state, channel } = createFakeAdapter();
    const { unmount } = await hostRoom(adapter);
    const opened = channel();
    act(() => opened.subscribed());

    unmount();

    expect(opened.closeCount).toBe(1);
    const callsAfterUnmount = state.fetchCalls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(state.fetchCalls).toBe(callsAfterUnmount);
  });

  it("releases the previous generation when a new Room is created", async () => {
    const { adapter, state, channel } = createFakeAdapter();
    const { result } = await hostRoom(adapter);
    const first = channel();

    await act(async () => {
      await result.current.create({ hostName: "Ana", timerDuration: 40, token: RED });
    });

    expect(first.closeCount).toBe(1);
    expect(state.channels).toHaveLength(2);
    expect(channel()).not.toBe(first);
  });
});

// ─── 10.–14. Interruption, same-session reconnect, and no contest ───

/** A guest Room that is Ready, with both participant sessions latched. */
async function readyGuest(adapter: RoomAdapter, channel: () => FakeChannel) {
  const view = await guestRoom(adapter);
  act(() => channel().subscribed());
  act(() => channel().presence([presence("host", { token: RED }), presence("guest", { token: BLUE })]));
  expect(view.result.current.state.phase).toBe("ready");
  return view;
}

const interruption = (state: RoomState) => (state.phase === "interrupted" ? state : null);

describe("interruption and reconnect", () => {
  it("interrupts a Ready Room when peer Presence disappears", async () => {
    const { adapter, channel } = createFakeAdapter();
    const { result } = await readyGuest(adapter, channel);
    const transport = result.current.matchTransport;

    act(() => channel().presence([presence("guest", { token: BLUE })]));

    expect(interruption(result.current.state)).toMatchObject({
      reason: "peer-left",
      resynchronizing: false,
      reconnectDeadline: Date.now() + 20_000,
    });
    // The Match keeps the same seam and sees the pause immediately.
    expect(result.current.matchTransport).toBe(transport);
    expect(transport?.status).toBe("interrupted");
  });

  it("interrupts rather than fails when the local channel is lost after readiness", async () => {
    const { adapter, channel } = createFakeAdapter();
    const { result } = await readyGuest(adapter, channel);

    act(() => channel().errored("socket dropped"));

    expect(interruption(result.current.state)?.reason).toBe("channel-lost");
    expect(result.current.matchTransport?.status).toBe("interrupted");
    expect(channel().closeCount).toBe(0);
  });

  it("re-tracks Presence and resynchronizes when the channel comes back", async () => {
    const { adapter, channel } = createFakeAdapter();
    const { result } = await readyGuest(adapter, channel);
    act(() => channel().closed());
    expect(interruption(result.current.state)?.reason).toBe("channel-lost");

    act(() => channel().subscribed());
    expect(channel().tracked).toHaveLength(2);
    expect(channel().tracked[1].clientId).toBe(channel().tracked[0].clientId);
    // Presence from before the loss proves nothing: wait for a fresh sync.
    expect(result.current.matchTransport?.status).toBe("interrupted");
    // Subscribed again, but Presence has not yet proven both sessions live.
    act(() => channel().presence([presence("guest", { token: BLUE })]));
    expect(result.current.matchTransport?.status).toBe("interrupted");

    act(() => channel().presence([presence("host", { token: RED }), presence("guest", { token: BLUE })]));
    expect(interruption(result.current.state)?.resynchronizing).toBe(true);
    expect(result.current.matchTransport?.status).toBe("resynchronizing");
  });

  it("returns to ready only when the Match acknowledges resynchronization", async () => {
    const { adapter, channel } = createFakeAdapter();
    const { result, phases } = await readyGuest(adapter, channel);

    act(() => channel().presence([presence("guest", { token: BLUE })]));
    // Resuming while the peer is still gone does nothing.
    act(() => result.current.matchTransport?.resume());
    expect(result.current.matchTransport?.status).toBe("interrupted");

    act(() => channel().presence([presence("host", { token: RED }), presence("guest", { token: BLUE })]));
    expect(result.current.state.phase).toBe("interrupted");

    act(() => result.current.matchTransport?.resume());
    expect(result.current.state.phase).toBe("ready");
    expect(result.current.matchTransport?.status).toBe("ready");

    // Recovery cleared the deadline: nothing fails later.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(result.current.state.phase).toBe("ready");
    expect(phases.filter((phase) => phase === "failed")).toHaveLength(0);
  });

  it("ends as a peer timeout when the peer does not return within 20 seconds", async () => {
    const { adapter, channel } = createFakeAdapter();
    const { result } = await readyGuest(adapter, channel);

    act(() => channel().presence([presence("guest", { token: BLUE })]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_999);
    });
    expect(result.current.state.phase).toBe("interrupted");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const { state } = result.current;
    expect(state.phase).toBe("failed");
    expect(state.phase === "failed" && state.error.kind).toBe("peer-timeout");
    expect(state.phase === "failed" && state.previousRoom?.code).toBe("ABCD");
    expect(result.current.matchTransport).toBeNull();
    expect(channel().closeCount).toBe(1);
  });

  it("ends as a resynchronization failure when the peer returns but the handshake never completes", async () => {
    const { adapter, channel } = createFakeAdapter();
    const { result } = await readyGuest(adapter, channel);

    act(() => channel().presence([presence("guest", { token: BLUE })]));
    act(() => channel().presence([presence("host", { token: RED }), presence("guest", { token: BLUE })]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    const { state } = result.current;
    expect(state.phase === "failed" && state.error.kind).toBe("resync-failed");
  });

  it("keeps one deadline for the whole interruption, however often the peer flickers", async () => {
    const { adapter, channel } = createFakeAdapter();
    const { result } = await readyGuest(adapter, channel);

    act(() => channel().presence([presence("guest", { token: BLUE })]));
    const deadline = interruption(result.current.state)?.reconnectDeadline;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    act(() => channel().presence([presence("host", { token: RED }), presence("guest", { token: BLUE })]));
    act(() => channel().presence([presence("guest", { token: BLUE })]));
    expect(interruption(result.current.state)?.reconnectDeadline).toBe(deadline);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.state.phase).toBe("failed");
  });

  it("refuses a peer that comes back as a different client session", async () => {
    const { adapter, channel } = createFakeAdapter();
    const { result } = await readyGuest(adapter, channel);

    act(() => channel().presence([presence("guest", { token: BLUE })]));
    // The host reloaded: same Role, new browser-session identity.
    act(() => channel().presence([presence("host", { token: RED, clientId: "client-host-reloaded" }), presence("guest", { token: BLUE })]));

    const { state } = result.current;
    expect(state.phase).toBe("failed");
    expect(state.phase === "failed" && state.error.kind).toBe("resync-failed");
    expect(result.current.matchTransport).toBeNull();
  });

  it("generates one client identity for the Room Module lifetime", async () => {
    const { adapter, state, channel } = createFakeAdapter();
    const { result } = await hostRoom(adapter);
    act(() => channel().subscribed());
    const first = channel().tracked[0].clientId;

    await act(async () => {
      await result.current.create({ hostName: "Ana", timerDuration: 40, token: RED });
    });
    act(() => channel().subscribed());

    expect(channel().tracked[0].clientId).toBe(first);
    expect(channel().input.clientId).toBe(first);
    expect(state.clientIdsCreated).toBe(1);
  });

  it("clears the reconnect deadline exactly once when leaving an interrupted Room", async () => {
    const { adapter, channel } = createFakeAdapter();
    const { result, phases } = await readyGuest(adapter, channel);
    act(() => channel().presence([presence("guest", { token: BLUE })]));

    await act(async () => {
      await result.current.leave();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(channel().closeCount).toBe(1);
    expect(result.current.state).toEqual({ phase: "idle" });
    expect(phases.filter((phase) => phase === "failed")).toHaveLength(0);
  });
});

describe("reload refusal", () => {
  it("remembers the Ready Room for this page session and forgets it on leave", async () => {
    const { adapter, state, channel } = createFakeAdapter();
    const { result } = await readyGuest(adapter, channel);
    expect(state.activeRoom).toBe("ABCD");

    await act(async () => {
      await result.current.leave();
    });
    expect(state.activeRoom).toBeNull();
  });

  it("refuses to recover a Room that was active before a full-page reload", () => {
    const { adapter, state } = createFakeAdapter();
    state.activeRoom = "ABCD";

    const { result } = renderRoom(adapter);

    const room = result.current.state;
    expect(room.phase).toBe("failed");
    expect(room.phase === "failed" && room.error.kind).toBe("resync-failed");
    expect(room.phase === "failed" && room.error.message).toMatch(/reload/i);
    expect(result.current.matchTransport).toBeNull();
    expect(state.channels).toHaveLength(0);
    expect(state.activeRoom).toBeNull();
  });
});
