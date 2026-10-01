/**
 * Local and bot Match verbs: each reports whether the move applied, enforces
 * legality itself, and plays move feedback only when the move applied.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameMode } from "./StartScreen";
import { playBlast, playDrop, playHover } from "./useSoundEffects";
import { useMatch } from "./useMatch";

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

function renderMatch(gameMode: GameMode) {
  return renderHook(() =>
    useMatch({
      gameMode,
      difficulty: "easy",
      timerDuration: 0,
      soundEnabled: true,
      onGameEnd: () => {},
    }),
  );
}

/** Run the pre-game countdown out, one second per act. */
async function finishCountdown() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

describe("useMatch verbs (local and bot)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("an applied drop reports it and plays the drop sound", async () => {
    const { result } = renderMatch("local");
    await finishCountdown();

    let applied = false;
    act(() => {
      applied = result.current.drop(3);
    });
    expect(applied).toBe(true);
    expect(result.current.board[5][3]).toBe("red");
    expect(playDrop).toHaveBeenCalledTimes(1);
  });

  it("rejects a drop into a full column, silently", async () => {
    const { result } = renderMatch("local");
    await finishCountdown();
    for (let i = 0; i < 6; i++) act(() => void result.current.drop(0));
    vi.mocked(playDrop).mockClear();

    let applied = true;
    act(() => {
      applied = result.current.drop(0);
    });
    expect(applied).toBe(false);
    expect(playDrop).not.toHaveBeenCalled();
  });

  it("rejects every move during the countdown", () => {
    const { result } = renderMatch("local");
    expect(result.current.countdown).toBeGreaterThan(0);

    let applied = true;
    act(() => {
      applied = result.current.drop(3);
    });
    expect(applied).toBe(false);
    expect(result.current.board[5][3]).toBeNull();
    expect(playDrop).not.toHaveBeenCalled();
  });

  it("rejects the human's move on the bot's turn", async () => {
    const { result } = renderMatch("bot");
    await finishCountdown();
    act(() => void result.current.drop(3));
    expect(result.current.currentPlayer).toBe("yellow");

    let applied = true;
    act(() => {
      applied = result.current.drop(0);
    });
    expect(applied).toBe(false);
    expect(result.current.board[5][0]).toBeNull();
  });

  it("an applied blast plays the blast sound and leaves blast mode", async () => {
    const { result } = renderMatch("local");
    await finishCountdown();
    act(() => void result.current.drop(3));
    act(() => void result.current.drop(3));
    act(() => result.current.toggleBlast());
    expect(result.current.blastMode).toBe(true);

    let applied = false;
    act(() => {
      applied = result.current.blast(5, 3);
    });
    expect(applied).toBe(true);
    expect(playBlast).toHaveBeenCalledTimes(1);
    expect(result.current.blastMode).toBe(false);
  });

  it("a rejected blast stays in blast mode, silently", async () => {
    const { result } = renderMatch("local");
    await finishCountdown();
    act(() => void result.current.drop(3));
    act(() => result.current.toggleBlast());

    let applied = true;
    act(() => {
      applied = result.current.blast(0, 0); // empty cell
    });
    expect(applied).toBe(false);
    expect(playBlast).not.toHaveBeenCalled();
    expect(result.current.blastMode).toBe(true);
  });
});

describe("useMatch hover cue", () => {
  const renderWithSound = (soundEnabled: boolean) =>
    renderHook(() =>
      useMatch({ gameMode: "local", difficulty: "easy", timerDuration: 0, soundEnabled, onGameEnd: () => {} }),
    );

  it("plays the hover sound when sound is on", () => {
    vi.mocked(playHover).mockClear();
    const { result } = renderWithSound(true);
    act(() => result.current.hover());
    expect(playHover).toHaveBeenCalledTimes(1);
  });

  it("stays silent when sound is off", () => {
    vi.mocked(playHover).mockClear();
    const { result } = renderWithSound(false);
    act(() => result.current.hover());
    expect(playHover).not.toHaveBeenCalled();
  });
});
