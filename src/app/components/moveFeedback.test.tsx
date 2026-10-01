/**
 * Move feedback — the real Match driving the real GameBoard, sounds mocked.
 * A move sounds only when the Match applies it.
 */
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameBoard } from "./GameBoard";
import * as sfx from "./useSoundEffects";
import { useMatch } from "./useMatch";

vi.mock("./useSoundEffects", () => ({
  setSfxVolume: vi.fn(),
  playDrop: vi.fn(),
  playHover: vi.fn(),
  playWin: vi.fn(),
  playDraw: vi.fn(),
  playBlast: vi.fn(),
  playTimerTick: vi.fn(),
  playTimerUrgent: vi.fn(),
  playClick: vi.fn(),
  playReset: vi.fn(),
}));

function LocalMatch() {
  const match = useMatch({
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

async function elapse(ms: number) {
  for (let t = 0; t < ms; t += 1000) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

const press = (key: string) => act(() => { fireEvent.keyDown(window, { key }); });

describe("move feedback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup(); // no Vitest globals, so Testing Library does not unmount for us
    vi.useRealTimers();
  });

  it("a rejected drop into a full column plays no sound", async () => {
    render(<LocalMatch />);
    await elapse(4000); // countdown

    for (let i = 0; i < 6; i++) press("1"); // fill column 1
    expect(sfx.playDrop).toHaveBeenCalledTimes(6);

    press("1"); // column full — rejected
    expect(sfx.playDrop).toHaveBeenCalledTimes(6);
  });

  it("an applied blast sounds once and exits blast mode", async () => {
    const { container } = render(<LocalMatch />);
    const hint = () => container.querySelector("p.mt-3")?.textContent ?? "";
    await elapse(4000);

    press("1"); // red piece to blast
    press("0"); // yellow enters blast mode
    expect(hint()).toContain("to blast");

    press("Enter");
    expect(sfx.playBlast).toHaveBeenCalledTimes(1);
    expect(hint()).toContain("to drop");
  });
});

describe("Match legality", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup(); // no Vitest globals, so Testing Library does not unmount for us
    vi.useRealTimers();
  });

  const options = (gameMode: "local" | "bot") => ({
    gameMode,
    difficulty: "easy" as const,
    timerDuration: 0,
    soundEnabled: true,
    onGameEnd: () => {},
  });

  it("rejects moves during the countdown, silently", () => {
    const { result } = renderHook(() => useMatch(options("local")));
    let outcome = "";
    act(() => { outcome = result.current.drop(0); });
    expect(outcome).toBe("rejected");
    expect(result.current.board[5][0]).toBeNull();
    expect(sfx.playDrop).not.toHaveBeenCalled();
  });

  it("rejects the human's move on the bot's turn", async () => {
    const { result } = renderHook(() => useMatch(options("bot")));
    for (let i = 0; i < 4; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    }
    let outcome = "";
    act(() => { outcome = result.current.drop(0); });
    expect(outcome).toBe("applied");
    expect(result.current.currentPlayer).toBe("yellow");

    act(() => { outcome = result.current.drop(1); });
    expect(outcome).toBe("rejected");
    expect(result.current.board[5][1]).toBeNull();
  });
});
