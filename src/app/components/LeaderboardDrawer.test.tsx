/**
 * LeaderboardDrawer tests — the drawer as a render layer over `useLeaderboard`,
 * with the leaderboard endpoint replaced by an in-memory fake.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardResponse, Result } from "./api";

const fetchLeaderboard = vi.fn<
  (player?: string, limit?: number, level?: string) => Promise<Result<LeaderboardResponse>>
>();
vi.mock("./api", () => ({
  fetchLeaderboard: (player?: string, limit?: number, level?: string) =>
    fetchLeaderboard(player, limit, level),
}));

import { LeaderboardDrawer } from "./LeaderboardDrawer";

const board = (names: string[]): Result<LeaderboardResponse> => ({
  ok: true,
  data: {
    players: names.map((name) => ({ name, wins: 1, losses: 0, draws: 0, gamesPlayed: 1 })),
    currentPlayer: null,
    currentPlayerRank: null,
    tokenConfigs: {},
  },
});

beforeEach(() => {
  fetchLeaderboard.mockReset();
  fetchLeaderboard.mockResolvedValue(board(["Grace"]));
});

describe("LeaderboardDrawer", () => {
  it("refresh keeps level", async () => {
    render(<LeaderboardDrawer isOpen onClose={() => {}} viewingPlayerName="Ada" />);
    fireEvent.click(screen.getByRole("button", { name: /Hard/ }));
    await waitFor(() => expect(fetchLeaderboard).toHaveBeenLastCalledWith("Ada", 20, "30"));

    fetchLeaderboard.mockClear();
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Refresh leaderboard" }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh leaderboard" }));
    await waitFor(() => expect(fetchLeaderboard).toHaveBeenCalledTimes(1));
    expect(fetchLeaderboard).toHaveBeenLastCalledWith("Ada", 20, "30");

    act(() => fireEvent.click(screen.getByRole("button", { name: /All/ })));
    await waitFor(() => expect(fetchLeaderboard).toHaveBeenLastCalledWith("Ada", 20, undefined));
  });

  it("loads for the viewing player only once opened", async () => {
    const { rerender } = render(<LeaderboardDrawer isOpen={false} onClose={() => {}} viewingPlayerName="Guest" />);
    expect(fetchLeaderboard).not.toHaveBeenCalled();
    rerender(<LeaderboardDrawer isOpen onClose={() => {}} viewingPlayerName="Guest" />);
    await waitFor(() => expect(screen.getByText("Grace")).toBeTruthy());
    expect(fetchLeaderboard.mock.calls.map((c) => c[0])).toEqual(["Guest"]);
  });
});
