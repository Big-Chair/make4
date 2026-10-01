/**
 * Leaderboard query tests — written against `useLeaderboard`, with the
 * leaderboard endpoint replaced by an in-memory fake keyed by level.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardResponse, PlayerStats, Result } from "./api";

const fetchLeaderboard = vi.fn<
  (player?: string, limit?: number, level?: string) => Promise<Result<LeaderboardResponse>>
>();
vi.mock("./api", () => ({
  fetchLeaderboard: (player?: string, limit?: number, level?: string) =>
    fetchLeaderboard(player, limit, level),
}));

import { LEVEL_TABS, useLeaderboard } from "./leaderboardQuery";

const stats = (name: string): PlayerStats => ({ name, wins: 1, losses: 0, draws: 0, gamesPlayed: 1 });

/** Each level's board holds one player named after the level, so data shows which level it is. */
function boardFor(level: string | undefined): Result<LeaderboardResponse> {
  const name = `top-${level ?? "all"}`;
  return {
    ok: true,
    data: {
      players: [stats(name)],
      currentPlayer: stats("Ada"),
      currentPlayerRank: 7,
      tokenConfigs: { [name.toUpperCase()]: { type: "emoji", emoji: "🔥" } },
    },
  };
}

const lastLevel = () => fetchLeaderboard.mock.calls.at(-1)?.[2];

beforeEach(async () => {
  fetchLeaderboard.mockReset();
  fetchLeaderboard.mockImplementation(async (_p, _l, level) => boardFor(level));
  // The selected level outlives every view by design; start each test on "All".
  const { result, unmount } = renderHook(() => useLeaderboard({ playerName: "Ada" }));
  act(() => result.current.selectLevel(""));
  await waitFor(() => expect(result.current.loading).toBe(false));
  unmount();
  fetchLeaderboard.mockClear();
});

describe("useLeaderboard", () => {
  it("offers one tab list: All, Easy, Medium, Hard", () => {
    expect(LEVEL_TABS.map((t) => t.label)).toEqual(["All", "Easy", "Medium", "Hard"]);
  });

  it("loads the selected level for the viewing player", async () => {
    const { result } = renderHook(() => useLeaderboard({ playerName: "Ada" }));
    await waitFor(() => expect(result.current.players[0]?.name).toBe("top-all"));
    expect(fetchLeaderboard).toHaveBeenLastCalledWith("Ada", 20, undefined);

    act(() => result.current.selectLevel("35"));
    await waitFor(() => expect(result.current.players[0]?.name).toBe("top-35"));
    expect(result.current.level).toBe("35");
    expect(lastLevel()).toBe("35");
  });

  it("refresh keeps level", async () => {
    const { result } = renderHook(() => useLeaderboard({ playerName: "Ada" }));
    act(() => result.current.selectLevel("30"));
    await waitFor(() => expect(result.current.players[0]?.name).toBe("top-30"));

    fetchLeaderboard.mockClear();
    // A render layer may wire refresh straight to onClick; the event must not become the level.
    act(() => (result.current.refresh as (e?: unknown) => void)({ type: "click" }));
    await waitFor(() => expect(fetchLeaderboard).toHaveBeenCalledTimes(1));
    expect(lastLevel()).toBe("30");
    expect(result.current.level).toBe("30");
  });

  it("remount keeps level", async () => {
    const first = renderHook(() => useLeaderboard({ playerName: "Ada" }));
    act(() => first.result.current.selectLevel("40"));
    await waitFor(() => expect(first.result.current.players[0]?.name).toBe("top-40"));
    first.unmount();

    fetchLeaderboard.mockClear();
    const second = renderHook(() => useLeaderboard({ playerName: "Ada" }));
    expect(second.result.current.level).toBe("40");
    await waitFor(() => expect(second.result.current.players[0]?.name).toBe("top-40"));
    expect(fetchLeaderboard.mock.calls.every((c) => c[2] === "40")).toBe(true);
  });

  it("does not load while inactive, and loads when it becomes active", async () => {
    const { result, rerender } = renderHook((active: boolean) => useLeaderboard({ playerName: "Ada", active }), {
      initialProps: false,
    });
    expect(fetchLeaderboard).not.toHaveBeenCalled();
    rerender(true);
    await waitFor(() => expect(result.current.players).toHaveLength(1));
  });

  it("ignores a stale response that lands after a newer level was selected", async () => {
    let releaseAll!: () => void;
    fetchLeaderboard.mockImplementation((_p, _l, level) =>
      level === undefined
        ? new Promise((resolve) => (releaseAll = () => resolve(boardFor(undefined))))
        : Promise.resolve(boardFor(level)),
    );
    const { result } = renderHook(() => useLeaderboard({ playerName: "Ada" }));
    act(() => result.current.selectLevel("35"));
    await waitFor(() => expect(result.current.players[0]?.name).toBe("top-35"));

    await act(async () => releaseAll());
    expect(result.current.players[0]?.name).toBe("top-35");
  });

  it("knows the viewing player, case-insensitively, and whether they are outside the list", async () => {
    const { result } = renderHook(() => useLeaderboard({ playerName: "Ada" }));
    await waitFor(() => expect(result.current.currentPlayer?.rank).toBe(7));
    expect(result.current.isCurrentPlayer(" ada ")).toBe(true);
    expect(result.current.isCurrentPlayer("top-all")).toBe(false);
    expect(result.current.currentPlayerOutsideList).toBe(true);
  });

  it("resolves a player's token from the server configs, case-insensitively", async () => {
    const { result } = renderHook(() => useLeaderboard({ playerName: "Ada" }));
    await waitFor(() => expect(result.current.players).toHaveLength(1));
    expect(result.current.tokenFor("top-all")).toEqual({ type: "emoji", emoji: "🔥" });
  });

  it("shows an empty board when the request fails", async () => {
    fetchLeaderboard.mockResolvedValue({ ok: false, error: { kind: "network", message: "down" } });
    const { result } = renderHook(() => useLeaderboard({ playerName: "Ada" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.players).toEqual([]);
    expect(result.current.currentPlayer).toBeNull();
  });
});
