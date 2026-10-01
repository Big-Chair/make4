/**
 * Move feedback through the real board: GameBoard wired to a real local Match,
 * as GameScreen wires it. Only the sound module is faked.
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameBoard } from "./GameBoard";
import { playDrop } from "./useSoundEffects";
import { useMatch, type UseMatchReturn } from "./useMatch";

vi.mock("./useSoundEffects", () => ({
  playDrop: vi.fn(),
  playHover: vi.fn(),
  playBlast: vi.fn(),
  playWin: vi.fn(),
  playDraw: vi.fn(),
  playTimerTick: vi.fn(),
  playTimerUrgent: vi.fn(),
  playReset: vi.fn(),
  playClick: vi.fn(),
}));

let match: UseMatchReturn;

function LocalBoard() {
  match = useMatch({
    gameMode: "local",
    difficulty: "easy",
    timerDuration: 0,
    soundEnabled: true,
    onGameEnd: () => {},
  });
  return (
    <GameBoard
      board={match.board}
      currentPlayer={match.currentPlayer}
      winner={match.winner}
      winningCells={match.winningCells}
      onDrop={match.drop}
      onBlast={match.blast}
      hasBlastToken={match.hasBlastToken}
      blastMode={match.blastMode}
      disabled={match.inputDisabled}
      soundEnabled
      onToggleBlast={match.toggleBlast}
      reducedMotion
    />
  );
}

const press = (key: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  });

/** Run the pre-game countdown out, one second per act. */
async function finishCountdown() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

describe("GameBoard move feedback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a rejected drop into a full column plays no sound", async () => {
    render(<LocalBoard />);
    await finishCountdown();
    expect(match.countdown).toBe(0);

    // Fill column 1: six drops, alternating players, no four-in-a-row.
    for (let i = 0; i < 6; i++) press("1");
    expect(match.board.every((row) => row[0] !== null)).toBe(true);
    expect(match.winner).toBeNull();
    vi.mocked(playDrop).mockClear();

    const before = match.board;
    press("1");
    expect(match.board).toBe(before); // the Match rejected it
    expect(playDrop).not.toHaveBeenCalled();
  });
});
