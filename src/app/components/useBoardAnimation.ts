import { useState, useEffect, useRef, useLayoutEffect } from "react";
import gsap from "gsap";
import type { Board, CellValue } from "./useConnect4";

const ROWS = 6;
const COLS = 7;

function emptyBoard(): CellValue[][] {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

export function isWinningCell(row: number, col: number, winningCells: number[][] | null): boolean {
  if (!winningCells) return false;
  return winningCells.some(([r, c]) => r === row && c === col);
}

export interface BoardAnimation {
  /** What the board should render — lags behind `board` during blast exit animations. */
  displayBoard: CellValue[][];
  /** Stable ref callback for a piece cell; drives the drop/win/blast GSAP tweens. */
  pieceRef: (row: number, col: number) => (el: HTMLDivElement | null) => void;
  /** Stable ref callback for an empty cell anchor. */
  emptyRef: (row: number, col: number) => (el: HTMLDivElement | null) => void;
}

/**
 * useBoardAnimation — the GSAP engine behind the board.
 *
 * Owns every transform a piece undergoes over time: the drop-in keyframes, the
 * blast exit tween, the win pulse, and the dimming of losing pieces. The diff
 * is driven entirely by the `board` prop; callers attach `pieceRef`/`emptyRef`
 * to their cells and render `displayBoard` (not `board`) so exit animations can
 * finish before a piece leaves the tree.
 *
 * This is an internal seam: the engine's refs and effects never surface — only
 * `displayBoard` and the two ref attachers do.
 */
export function useBoardAnimation(
  board: Board,
  winner: CellValue | "draw",
  winningCells: number[][] | null,
  reducedMotion?: boolean,
): BoardAnimation {
  // ── GSAP refs ──
  const pieceRefs = useRef<(HTMLDivElement | null)[][]>(
    Array.from({ length: ROWS }, () => Array(COLS).fill(null))
  );
  const prevBoardRef = useRef<CellValue[][]>(emptyBoard());
  const winTweensRef = useRef<gsap.core.Tween[]>([]);
  // Pending drop animations: key = "row-col", value = row index (for drop height)
  const pendingAnimations = useRef<Map<string, number>>(new Map());
  // Whether to use reduced motion for pending animations
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  // displayBoard: what React renders. Lags behind `board` for blast exit animations.
  const [displayBoard, setDisplayBoard] = useState<CellValue[][]>(board.map(r => [...r]));

  // ── Stable ref callbacks (created once, read dynamic values from refs) ──
  const pieceRefCallbacks = useRef<((el: HTMLDivElement | null) => void)[][]>(null!);
  const emptyRefCallbacks = useRef<((el: HTMLDivElement | null) => void)[][]>(null!);
  if (!pieceRefCallbacks.current) {
    pieceRefCallbacks.current = Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, (_, c) => (el: HTMLDivElement | null) => {
        pieceRefs.current[r][c] = el;
        if (!el) return;

        const key = `${r}-${c}`;
        const pendingRow = pendingAnimations.current.get(key);
        if (pendingRow === undefined) return;
        pendingAnimations.current.delete(key);

        const rm = reducedMotionRef.current;
        if (rm) {
          gsap.fromTo(el,
            { opacity: 0, scale: 1, y: 0 },
            { opacity: 1, scale: 1, y: 0, duration: 0.15, ease: "power2.out" }
          );
        } else {
          const startY = -(r + 1) * 60;
          const duration = 0.25 + r * 0.03;
          gsap.set(el, { y: startY, scale: 0.85, opacity: 0.6 });
          gsap.to(el, {
            keyframes: [
              { y: 4, scale: 1.08, opacity: 1, duration: duration * 0.65, ease: "power2.in" },
              { y: -2, scale: 0.97, duration: duration * 0.2, ease: "power2.out" },
              { y: 0, scale: 1, duration: duration * 0.15, ease: "power2.out" },
            ],
          });
        }
      })
    );
  }
  if (!emptyRefCallbacks.current) {
    emptyRefCallbacks.current = Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, (_, c) => (el: HTMLDivElement | null) => {
        pieceRefs.current[r][c] = el;
      })
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GSAP board-diff engine
  // Runs in useLayoutEffect → fires before browser paint.
  // - New pieces: recorded in pendingAnimations ref. The ref callback on the
  //   piece div (which fires during React's commit, also before paint) picks
  //   these up and triggers gsap.fromTo() with the correct initial offset.
  //   Result: the piece is NEVER painted at y:0 — zero flash.
  // - Blasted pieces: kept in displayBoard for exit animation. GSAP tween
  //   runs on the existing ref, then onComplete syncs displayBoard to remove.
  // ═══════════════════════════════════════════════════════════════════════════
  useLayoutEffect(() => {
    const prev = prevBoardRef.current;

    // Detect full reset (board completely empty, previous had pieces)
    const isReset = board.every(row => row.every(cell => cell === null));
    const prevHadPieces = prev.some(row => row.some(cell => cell !== null));

    if (isReset && prevHadPieces) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const el = pieceRefs.current[r][c];
          if (el) {
            gsap.killTweensOf(el);
            gsap.set(el, { clearProps: "all" });
          }
        }
      }
      winTweensRef.current.forEach(t => t.kill());
      winTweensRef.current = [];
      pendingAnimations.current.clear();
      setDisplayBoard(board.map(r => [...r]));
      prevBoardRef.current = board.map(r => [...r]);
      return;
    }

    const newDisplay = board.map(r => [...r]);
    const blastedPieces: [number, number][] = [];

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!prev[r][c] && board[r][c]) {
          // New piece → mark for animation via ref callback
          pendingAnimations.current.set(`${r}-${c}`, r);
        } else if (prev[r][c] && !board[r][c]) {
          // Blasted piece → keep in displayBoard for exit animation
          newDisplay[r][c] = prev[r][c];
          blastedPieces.push([r, c]);
        }
      }
    }

    // Update displayBoard — React will synchronously re-render (since we're
    // inside useLayoutEffect), mounting new piece divs whose ref callbacks
    // will pick up pendingAnimations and trigger GSAP before paint.
    setDisplayBoard(newDisplay);

    // Animate blasted pieces out (refs already available from previous render)
    blastedPieces.forEach(([r, c]) => {
      const el = pieceRefs.current[r][c];
      if (!el) return;
      gsap.to(el, {
        scale: 1.3,
        opacity: 0,
        duration: 0.3,
        ease: "power2.in",
        onComplete: () => {
          setDisplayBoard(prev => {
            const next = prev.map(row => [...row]);
            next[r][c] = null;
            return next;
          });
          gsap.set(el, { clearProps: "all" });
        },
      });
    });

    prevBoardRef.current = board.map(r => [...r]);
  }, [board]);

  // ═══════════════════════════════════════════════════════════════════════════
  // GSAP win pulse + dimming
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    winTweensRef.current.forEach(t => t.kill());
    winTweensRef.current = [];

    if (winner && winner !== "draw" && winningCells) {
      // Pulse winning cells
      winningCells.forEach(([r, c]) => {
        const el = pieceRefs.current[r][c];
        if (!el) return;
        const tween = gsap.to(el, {
          scale: reducedMotion ? 1.08 : 1.12,
          duration: 0.4,
          yoyo: true,
          repeat: -1,
          ease: "sine.inOut",
        });
        winTweensRef.current.push(tween);
      });

      // Dim non-winning pieces
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (board[r][c] && !isWinningCell(r, c, winningCells)) {
            const el = pieceRefs.current[r][c];
            if (el) {
              gsap.to(el, {
                opacity: 0.25,
                duration: reducedMotion ? 0.3 : 0.6,
                ease: "power2.out",
              });
            }
          }
        }
      }
    } else if (!winner) {
      // Reset on rematch
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const el = pieceRefs.current[r][c];
          if (el && board[r][c]) {
            gsap.to(el, {
              opacity: 1, scale: 1, duration: 0.2, ease: "power2.out",
            });
          }
        }
      }
    }

    return () => {
      winTweensRef.current.forEach(t => t.kill());
      winTweensRef.current = [];
    };
  }, [winner, winningCells, board, reducedMotion]);

  return {
    displayBoard,
    pieceRef: (row, col) => pieceRefCallbacks.current[row][col],
    emptyRef: (row, col) => emptyRefCallbacks.current[row][col],
  };
}
