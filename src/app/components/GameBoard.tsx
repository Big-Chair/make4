import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowDown } from "lucide-react";
import type { Board, CellValue } from "./useConnect4";
import { blastTargets, findBestBlastTarget } from "./blast";
import { useBoardAnimation, isWinningCell } from "./useBoardAnimation";
import { playDrop, playHover, playBlast } from "./useSoundEffects";
import type { Gesture } from "./useHandTracking";
import { type TokenConfig, getTokenVisuals, DEFAULT_PALETTE } from "./tokens";
import { g } from "./ThemeContext";

// Reusable pointing-arrow SVG for hand-tracking column indicators
function PointingArrow({ color }: { color: string }) {
  return (
    <svg width="24" height="28" viewBox="0 0 24 28" fill="none">
      <path d="M12 26 L12 8" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <path d="M5 14 L12 4 L19 14" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="12" cy="4" r="3" fill={color} opacity="0.3" />
    </svg>
  );
}

interface GameBoardProps {
  board: Board;
  currentPlayer: "red" | "yellow";
  winner: CellValue | "draw";
  winningCells: number[][] | null;
  onDrop: (col: number) => void;
  onBlast: (row: number, col: number) => void;
  hasBlastToken: boolean;
  blastMode: boolean;
  setBlastMode: (v: boolean) => void;
  disabled?: boolean;
  soundEnabled: boolean;
  onToggleBlast: () => void;
  handSelectedCol?: number | null;
  handBlastCursor?: [number, number] | null;
  handGesture?: Gesture;
  p1Token?: TokenConfig;
  p2Token?: TokenConfig;
  reducedMotion?: boolean;
}

const PLAYER_COLORS = DEFAULT_PALETTE;

export function GameBoard({
  board,
  currentPlayer,
  winner,
  winningCells,
  onDrop,
  onBlast,
  hasBlastToken,
  blastMode,
  setBlastMode,
  disabled,
  soundEnabled,
  onToggleBlast,
  handSelectedCol,
  handBlastCursor,
  handGesture,
  p1Token,
  p2Token,
  reducedMotion,
}: GameBoardProps) {
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const [hoveredCell, setHoveredCell] = useState<[number, number] | null>(null);
  const [blastCursor, setBlastCursor] = useState<[number, number] | null>(null);

  // GSAP animation engine — owns the drop/win/blast tweens and the displayBoard
  // lag buffer. We render `displayBoard` and attach pieceRef/emptyRef to cells.
  const { displayBoard, pieceRef, emptyRef } = useBoardAnimation(board, winner, winningCells, reducedMotion);

  // ── Stale-closure prevention refs (for keyboard handler) ──
  const blastCursorRef = useRef(blastCursor);
  blastCursorRef.current = blastCursor;
  const blastModeRef = useRef(blastMode);
  blastModeRef.current = blastMode;
  const boardRef = useRef(board);
  boardRef.current = board;
  const winnerRef = useRef(winner);
  winnerRef.current = winner;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const hasBlastTokenRef = useRef(hasBlastToken);
  hasBlastTokenRef.current = hasBlastToken;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const currentPlayerRef = useRef(currentPlayer);
  currentPlayerRef.current = currentPlayer;
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const onBlastRef = useRef(onBlast);
  onBlastRef.current = onBlast;
  const onToggleBlastRef = useRef(onToggleBlast);
  onToggleBlastRef.current = onToggleBlast;

  // ── Blast cursor initialization ──
  useEffect(() => {
    if (blastMode) {
      const best = findBestBlastTarget(board, currentPlayer);
      if (best) {
        setBlastCursor(best);
      } else {
        for (let r = 0; r < board.length; r++) {
          for (let c = 0; c < board[0].length; c++) {
            if (board[r][c] !== null) {
              setBlastCursor([r, c]);
              return;
            }
          }
        }
        setBlastCursor([0, 0]);
      }
    } else {
      setBlastCursor(null);
    }
  }, [blastMode, board, currentPlayer]);

  // ── Keyboard handler (registered once) ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (winnerRef.current || disabledRef.current) return;

      if (e.key === "0") {
        onToggleBlastRef.current();
        return;
      }

      if (blastModeRef.current && blastCursorRef.current) {
        const [row, col] = blastCursorRef.current;
        const currentBoard = boardRef.current;
        const rows = currentBoard.length;
        const cols = currentBoard[0].length;
        let newRow = row;
        let newCol = col;
        let moved = false;

        switch (e.key) {
          case "ArrowUp": case "w": case "W":
            e.preventDefault();
            if (row > 0) { newRow = row - 1; moved = true; }
            break;
          case "ArrowDown": case "s": case "S":
            e.preventDefault();
            if (row < rows - 1) { newRow = row + 1; moved = true; }
            break;
          case "ArrowLeft": case "a": case "A":
            e.preventDefault();
            if (col > 0) { newCol = col - 1; moved = true; }
            break;
          case "ArrowRight": case "d": case "D":
            e.preventDefault();
            if (col < cols - 1) { newCol = col + 1; moved = true; }
            break;
          case "Enter": case " ":
            e.preventDefault();
            if (currentBoard[row][col] !== null && hasBlastTokenRef.current) {
              onBlastRef.current(row, col);
              setBlastMode(false);
              setBlastCursor(null);
              setHoveredCell(null);
              if (soundEnabledRef.current) playBlast();
            }
            return;
        }

        if (moved) {
          setBlastCursor([newRow, newCol]);
          setHoveredCell([newRow, newCol]);
          if (soundEnabledRef.current) playHover();
        }
        return;
      }

      const col = parseInt(e.key, 10);
      if (col >= 1 && col <= 7) {
        onDropRef.current(col - 1);
        if (soundEnabledRef.current) playDrop();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Blast targeting logic ──
  const activeBlastCell = hoveredCell || blastCursor;

  const activeBlastTargets = blastMode && activeBlastCell && board[activeBlastCell[0]][activeBlastCell[1]]
    ? blastTargets(board, activeBlastCell[0], activeBlastCell[1])
    : [];

  function isBlastTarget(row: number, col: number): boolean {
    return activeBlastTargets.some(([r, c]) => r === row && c === col);
  }

  function isBlastCenter(row: number, col: number): boolean {
    return blastMode && activeBlastCell !== null && activeBlastCell[0] === row && activeBlastCell[1] === col && board[row][col] !== null;
  }

  const handleCellClick = (row: number, col: number) => {
    if (winner || disabled) return;
    if (blastMode && hasBlastToken) {
      if (board[row][col] !== null) {
        onBlast(row, col);
        setBlastMode(false);
        setHoveredCell(null);
        if (soundEnabled) playBlast();
      }
    } else {
      onDrop(col);
      if (soundEnabled) playDrop();
    }
  };

  const cellSize = "min(clamp(32px, calc((100vh - 200px) / 7), 76px), clamp(32px, calc((100vw - 90px) / 7), 76px))";
  const gap = "clamp(2px, 0.4vw, 8px)";

  return (
    <div className="flex flex-col items-center">
      {/* ── Column hover indicators (kept as Motion — 7 lightweight instances) ── */}
      <div
        className="flex items-end justify-center mb-0.5 sm:mb-1"
        style={{ gap, paddingLeft: 0 }}
      >
        {board[0].map((_, colIndex) => (
          <div
            key={colIndex}
            className="flex flex-col items-center justify-end"
            style={{ width: cellSize, height: "24px" }}
          >
            <span
              className="select-none pointer-events-none hidden sm:block"
              style={{
                fontSize: "var(--text-2xs)",
                color: hoveredCol === colIndex && !winner && !blastMode
                  ? g.textFaint
                  : g.textGhost,
                lineHeight: 1,
                transition: "color 0.15s",
              }}
            >
              {colIndex + 1}
            </span>
            <AnimatePresence>
              {hoveredCol === colIndex && !winner && !blastMode && (
                <motion.div
                  initial={{ y: -8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -8, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <ArrowDown
                    size={22}
                    strokeWidth={3}
                    color={currentPlayer === "red" ? "#F24E1E" : "#FFBF00"}
                  />
                </motion.div>
              )}
              {handGesture === "point" && handSelectedCol === colIndex && !winner && !blastMode && hoveredCol !== colIndex && (
                <motion.div
                  initial={{ y: -12, opacity: 0, scale: 0.7 }}
                  animate={{ y: [0, -3, 0], opacity: 1, scale: 1 }}
                  exit={{ y: -12, opacity: 0, scale: 0.7 }}
                  transition={{
                    y: { repeat: Infinity, duration: 1.2, ease: "easeInOut" },
                    opacity: { duration: 0.2 },
                    scale: { duration: 0.2 },
                  }}
                  className="flex flex-col items-center"
                >
                  <PointingArrow color={currentPlayer === "red" ? "#F24E1E" : "#FFBF00"} />
                </motion.div>
              )}
              {handGesture === "point" && blastMode && handBlastCursor && handBlastCursor[1] === colIndex && !winner && hoveredCol !== colIndex && (
                <motion.div
                  initial={{ y: -12, opacity: 0, scale: 0.7 }}
                  animate={{ y: [0, -3, 0], opacity: 1, scale: 1 }}
                  exit={{ y: -12, opacity: 0, scale: 0.7 }}
                  transition={{
                    y: { repeat: Infinity, duration: 1.2, ease: "easeInOut" },
                    opacity: { duration: 0.2 },
                    scale: { duration: 0.2 },
                  }}
                  className="flex flex-col items-center"
                >
                  <PointingArrow color={currentPlayer === "red" ? "#F24E1E" : "#FFBF00"} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>

      {/* ── Board Frame ── */}
      <div
        className="relative rounded-2xl sm:rounded-3xl"
        style={{
          padding: "clamp(6px, 1.2vw, 20px)",
          background: `linear-gradient(180deg, var(--g-board-frame-start) 0%, var(--g-board-frame-end) 100%)`,
          border: blastMode ? "3px solid #A259FF" : `3px solid var(--g-board-border)`,
          boxShadow: blastMode
            ? `0 0 0 1px rgba(162,89,255,0.3), 0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(162,89,255,0.15), inset 0 1px 0 var(--g-border-subtle)`
            : `0 0 0 1px var(--g-border-subtle), 0 20px 60px rgba(31,30,31,0.5), 0 0 120px rgba(31,30,31,0), inset 0 1px 0 var(--g-border-subtle)`,
          transition: "border-color 0.3s, box-shadow 0.3s",
        }}
      >
        <div
          className="rounded-xl sm:rounded-2xl relative overflow-hidden"
          style={{
            padding: "clamp(6px, 1vw, 16px)",
            background: `linear-gradient(180deg, var(--g-board-inner-start) 0%, var(--g-board-inner-end) 100%)`,
            border: `2px solid var(--g-board-inner-border)`,
          }}
        >
          {/* Subtle grid pattern overlay */}
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.03]"
            style={{
              backgroundImage: `linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px),
                                linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)`,
              backgroundSize: "20px 20px",
            }}
          />

          {/* ── Cell grid — plain <button> + <div> with GSAP animations ── */}
          <div className="relative flex flex-col" style={{ gap }}>
            {displayBoard.map((row, rowIndex) => (
              <div key={rowIndex} className="flex" style={{ gap }}>
                {row.map((cell, colIndex) => {
                  const isWin = isWinningCell(rowIndex, colIndex, winningCells);
                  const isHovered = hoveredCol === colIndex && !winner && !blastMode;
                  const isHandHovered = handSelectedCol === colIndex && !winner && !blastMode && !isHovered;
                  const tokenCfg = cell === "red" ? p1Token : cell === "yellow" ? p2Token : undefined;
                  const tv = cell && tokenCfg ? getTokenVisuals(tokenCfg, cell) : null;
                  const colors = cell ? (tv ? { bg: tv.bg, highlight: tv.highlight, border: tv.border, dark: tv.dark, glow: tv.glow } : PLAYER_COLORS[cell]) : null;
                  const isTarget = isBlastTarget(rowIndex, colIndex);
                  const isCenter = isBlastCenter(rowIndex, colIndex);
                  const isCursorHere = blastMode && blastCursor && blastCursor[0] === rowIndex && blastCursor[1] === colIndex && !hoveredCell;
                  const isDimmed = !!winner && winner !== "draw" && cell && !isWin;

                  return (
                    <button
                      key={colIndex}
                      className="rounded-full relative cursor-pointer flex-shrink-0"
                      style={{
                        width: cellSize,
                        height: cellSize,
                        background: cell
                          ? "transparent"
                          : isHovered
                          ? currentPlayer === "red"
                            ? "radial-gradient(circle, rgba(242,78,30,0.12) 0%, rgba(242,78,30,0.03) 100%)"
                            : "radial-gradient(circle, rgba(255,191,0,0.12) 0%, rgba(255,191,0,0.03) 100%)"
                          : isHandHovered
                          ? currentPlayer === "red"
                            ? "radial-gradient(circle, rgba(242,78,30,0.08) 0%, rgba(242,78,30,0.02) 100%)"
                            : "radial-gradient(circle, rgba(255,191,0,0.08) 0%, rgba(255,191,0,0.02) 100%)"
                          : isCursorHere
                          ? "radial-gradient(circle, rgba(162,89,255,0.1) 0%, rgba(162,89,255,0.02) 100%)"
                          : "radial-gradient(circle at 40% 40%, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
                        border: isTarget
                          ? `2px solid rgba(162,89,255,0.7)`
                          : isCursorHere && !cell
                          ? `2px dashed rgba(162,89,255,0.4)`
                          : isHovered && !cell
                          ? `2px solid ${currentPlayer === "red" ? "rgba(242,78,30,0.35)" : "rgba(255,191,0,0.35)"}`
                          : `2px solid ${g.cellBorder}`,
                        transition: "background 0.15s, border-color 0.15s, transform 0.15s",
                        // CSS-only hover scale — replaces motion.button whileHover
                        transform: !cell && !winner && !blastMode && !reducedMotion && isHovered
                          ? "scale(1.06)" : "scale(1)",
                      }}
                      onClick={() => handleCellClick(rowIndex, colIndex)}
                      onMouseEnter={() => {
                        setHoveredCol(colIndex);
                        if (blastMode) setHoveredCell([rowIndex, colIndex]);
                        if (!cell && soundEnabled && !reducedMotion) playHover();
                      }}
                      onMouseLeave={() => {
                        setHoveredCol(null);
                        if (blastMode) setHoveredCell(null);
                      }}
                    >
                      {/* Piece token — GSAP controls y/scale/opacity transforms */}
                      {cell && (
                        <div
                          ref={pieceRef(rowIndex, colIndex)}
                          className="absolute inset-1 rounded-full"
                          style={{
                            background: colors!.bg,
                            boxShadow: isCenter
                              ? `0 0 24px #A259FF, 0 0 48px rgba(162,89,255,0.5), inset 0 2px 5px rgba(255,255,255,0.4), inset 0 -3px 6px ${colors!.dark}`
                              : isTarget
                              ? `0 0 16px rgba(162,89,255,0.4), inset 0 2px 5px rgba(255,255,255,0.3), inset 0 -3px 6px ${colors!.dark}`
                              : isWin
                              ? `0 0 24px ${colors!.glow}, 0 0 48px ${colors!.glow}60, 0 0 80px ${colors!.glow}25, inset 0 2px 5px rgba(255,255,255,0.4), inset 0 -3px 6px ${colors!.dark}`
                              : isDimmed
                              ? `0 2px 8px rgba(0,0,0,0.3), inset 0 1px 3px rgba(255,255,255,0.1)`
                              : `0 4px 16px rgba(0,0,0,0.4), inset 0 2px 5px rgba(255,255,255,0.4), inset 0 -3px 6px ${colors!.dark}`,
                            border: `3px solid ${isWin ? colors!.glow : colors!.highlight}`,
                            outline: isDimmed ? 'none' : `3px solid ${isWin ? colors!.glow : colors!.border}`,
                            outlineOffset: '-1px',
                            filter: isDimmed ? "saturate(0.3)" : "none",
                            overflow: "hidden",
                            transition: "box-shadow 0.2s, border-color 0.2s, outline-color 0.2s, filter 0.3s",
                          }}
                        >
                          {/* Custom token overlay: image */}
                          {tv?.imageUrl && !isCenter && !isTarget && (
                            <img src={tv.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover rounded-full pointer-events-none" />
                          )}
                          {/* Custom token overlay: emoji */}
                          {tv?.emoji && !isCenter && !isTarget && (
                            <span className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ fontSize: "clamp(14px, 2.5vw, 28px)", lineHeight: 1, textShadow: tv?.imageUrl ? "0 1px 4px rgba(0,0,0,0.7)" : "none" }}>
                              {tv.emoji}
                            </span>
                          )}
                          {/* Blast crosshair overlay */}
                          {isCenter && (
                            <div
                              className="absolute inset-0 rounded-full flex items-center justify-center"
                              style={{ background: "rgba(162,89,255,0.3)" }}
                            >
                              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                <circle cx="10" cy="10" r="3" stroke="white" strokeWidth="1.5" fill="none" />
                                <line x1="10" y1="2" x2="10" y2="6" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                                <line x1="10" y1="14" x2="10" y2="18" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                                <line x1="2" y1="10" x2="6" y2="10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                                <line x1="14" y1="10" x2="18" y2="10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                              </svg>
                            </div>
                          )}
                          {/* Blast target X for neighbors */}
                          {isTarget && !isCenter && (
                            <div
                              className="absolute inset-0 rounded-full flex items-center justify-center"
                              style={{ background: "rgba(162,89,255,0.25)" }}
                            >
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                <line x1="3" y1="3" x2="11" y2="11" stroke="white" strokeWidth="2" strokeLinecap="round" />
                                <line x1="11" y1="3" x2="3" y2="11" stroke="white" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                            </div>
                          )}
                        </div>
                      )}
                      {/* Hidden ref anchor for empty cells (so GSAP can target if needed) */}
                      {!cell && (
                        <div
                          ref={emptyRef(rowIndex, colIndex)}
                          style={{ display: "none" }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Board feet / stand */}
        <div className="flex justify-between px-4 -mb-2">
          <div className="w-12 h-2 rounded-b-lg" style={{ background: "var(--g-feet-color)" }} />
          <div className="w-12 h-2 rounded-b-lg" style={{ background: "var(--g-feet-color)" }} />
        </div>
      </div>

      {/* Keyboard shortcut hint */}
      <p
        className="mt-3 select-none text-center hidden sm:block"
        style={{
          fontSize: "var(--text-xs)",
          color: g.textGhost,
          letterSpacing: "0.04em",
        }}
      >
        {blastMode ? (
          <>
            <span style={{ color: "rgba(162,89,255,0.5)", fontWeight: 500 }}>↑↓←→</span> or{" "}
            <span style={{ color: "rgba(162,89,255,0.5)", fontWeight: 500 }}>WASD</span> to move
            {" · "}
            <span style={{ color: "rgba(162,89,255,0.5)", fontWeight: 500 }}>Enter/Space</span> to blast
            {" · "}
            <span style={{ color: g.textDim, fontWeight: 500 }}>0</span> to toggle off
          </>
        ) : (
          <>
            Press <span style={{ color: g.textFaint, fontWeight: 500 }}>1–7</span> to drop
            {" · "}
            <span style={{ color: "rgba(162,89,255,0.5)", fontWeight: 500 }}>0</span> for Blast
          </>
        )}
      </p>
    </div>
  );
}