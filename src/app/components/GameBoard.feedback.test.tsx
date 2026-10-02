/**
 * Move feedback through the real board: GameBoard wired to a real local Match,
 * as GameScreen wires it. Only the sound module is faked.
 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameBoard } from "./GameBoard";
import { publishHandInput, registerHandControls } from "./handInput";
import { playDrop, playHover } from "./useSoundEffects";
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
      onToggleBlast={match.toggleBlast}
      onHover={match.hover}
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
  afterEach(() => {
    cleanup(); // no Vitest globals, so Testing Library does not unmount for us
    vi.useRealTimers();
  });

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

  it("moving the keyboard blast cursor sounds the Match's hover cue", async () => {
    render(<LocalBoard />);
    await finishCountdown();
    press("1"); // a piece to aim at
    press("0"); // yellow enters blast mode
    expect(match.blastMode).toBe(true);
    vi.mocked(playHover).mockClear();

    press("ArrowUp");
    expect(playHover).toHaveBeenCalledTimes(1);
  });
});

describe("GameBoard as a dumb input", () => {
  afterEach(() => cleanup());

  const renderBoard = (onHover = vi.fn()) => {
    const view = render(
      <GameBoard
        board={Array.from({ length: 6 }, () => Array(7).fill(null))}
        currentPlayer="red"
        winner={null}
        winningCells={null}
        onDrop={() => true}
        onBlast={() => true}
        hasBlastToken
        blastMode={false}
        onToggleBlast={() => {}}
        onHover={onHover}
      />,
    );
    return { ...view, onHover };
  };

  it("signals hover on an empty cell and plays no sound itself", () => {
    vi.mocked(playHover).mockClear();
    const { container, onHover } = renderBoard();
    const cell = container.querySelector("button.rounded-full");
    if (!cell) throw new Error("no cell");
    fireEvent.mouseEnter(cell);
    expect(onHover).toHaveBeenCalledTimes(1);
    expect(playHover).not.toHaveBeenCalled();
  });

  it("points at the hand-tracking column straight from the hand input", () => {
    const { container } = renderBoard();
    const arrows = () => container.querySelectorAll('svg[width="24"][height="28"]').length;
    // The pointed column's cells get a faint tint (no exit animation, unlike the arrow).
    const tinted = () =>
      Array.from(container.querySelectorAll<HTMLElement>("button.rounded-full"))
        .filter((cell) => cell.style.background.includes("0.08")).length;
    expect(arrows()).toBe(0);
    expect(tinted()).toBe(0);

    let unregister = () => {};
    act(() => {
      unregister = registerHandControls({ start: () => {}, stop: () => {} });
      publishHandInput({
        isTracking: true,
        isLoading: false,
        error: null,
        gesture: "point",
        selectedCol: 2,
        blastCursor: null,
      });
    });
    expect(arrows()).toBe(1);
    expect(tinted()).toBe(6); // every cell of column 3

    act(() => unregister()); // the camera input unmounts
    expect(tinted()).toBe(0);
  });
});
