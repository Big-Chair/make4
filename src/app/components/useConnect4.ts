import { useState, useCallback, useEffect, useRef } from "react";
import { applyBlast } from "./blast";

export type CellValue = null | "red" | "yellow";
export type Board = CellValue[][];

export const ROWS = 6;
export const COLS = 7;

function createEmptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function checkWin(board: Board, player: CellValue): number[][] | null {
  if (!player) return null;

  // Horizontal
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      if (
        board[r][c] === player &&
        board[r][c + 1] === player &&
        board[r][c + 2] === player &&
        board[r][c + 3] === player
      ) {
        return [[r, c], [r, c + 1], [r, c + 2], [r, c + 3]];
      }
    }
  }

  // Vertical
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 0; c < COLS; c++) {
      if (
        board[r][c] === player &&
        board[r + 1][c] === player &&
        board[r + 2][c] === player &&
        board[r + 3][c] === player
      ) {
        return [[r, c], [r + 1, c], [r + 2, c], [r + 3, c]];
      }
    }
  }

  // Diagonal (down-right)
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      if (
        board[r][c] === player &&
        board[r + 1][c + 1] === player &&
        board[r + 2][c + 2] === player &&
        board[r + 3][c + 3] === player
      ) {
        return [[r, c], [r + 1, c + 1], [r + 2, c + 2], [r + 3, c + 3]];
      }
    }
  }

  // Diagonal (down-left)
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 3; c < COLS; c++) {
      if (
        board[r][c] === player &&
        board[r + 1][c - 1] === player &&
        board[r + 2][c - 2] === player &&
        board[r + 3][c - 3] === player
      ) {
        return [[r, c], [r + 1, c - 1], [r + 2, c - 2], [r + 3, c - 3]];
      }
    }
  }

  return null;
}

function isBoardFull(board: Board): boolean {
  return board[0].every((cell) => cell !== null);
}

/** Check if a player has four in a row (boolean version — no cell tracking) */
export function hasConnect4(board: Board, player: CellValue): boolean {
  if (!player) return false;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      if (
        board[r][c] === player &&
        board[r][c + 1] === player &&
        board[r][c + 2] === player &&
        board[r][c + 3] === player
      )
        return true;
    }
  }
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 0; c < COLS; c++) {
      if (
        board[r][c] === player &&
        board[r + 1][c] === player &&
        board[r + 2][c] === player &&
        board[r + 3][c] === player
      )
        return true;
    }
  }
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      if (
        board[r][c] === player &&
        board[r + 1][c + 1] === player &&
        board[r + 2][c + 2] === player &&
        board[r + 3][c + 3] === player
      )
        return true;
    }
  }
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 3; c < COLS; c++) {
      if (
        board[r][c] === player &&
        board[r + 1][c - 1] === player &&
        board[r + 2][c - 2] === player &&
        board[r + 3][c - 3] === player
      )
        return true;
    }
  }
  return false;
}

/** timerDuration: 0 = no timer, positive number = seconds per turn */
export function useConnect4(timerDuration: number = 40) {
  const [board, setBoard] = useState<Board>(createEmptyBoard());
  const [currentPlayer, setCurrentPlayer] = useState<"red" | "yellow">("red");
  const [winner, setWinner] = useState<CellValue | "draw">(null);
  const [winningCells, setWinningCells] = useState<number[][] | null>(null);
  const [redBlastToken, setRedBlastToken] = useState(true);
  const [yellowBlastToken, setYellowBlastToken] = useState(true);
  const [timer, setTimer] = useState(timerDuration || 0);
  const [moveCount, setMoveCount] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasBlastToken = currentPlayer === "red" ? redBlastToken : yellowBlastToken;
  const timerEnabled = timerDuration > 0;

  const resetTimer = useCallback(() => {
    if (timerDuration > 0) {
      setTimer(timerDuration);
    }
  }, [timerDuration]);

  useEffect(() => {
    if (!timerEnabled) return;
    if (winner || paused) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          // Time's up - switch turns
          setCurrentPlayer((p) => (p === "red" ? "yellow" : "red"));
          return timerDuration;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentPlayer, winner, timerEnabled, timerDuration, paused]);

  const dropPiece = useCallback(
    (col: number) => {
      if (winner) return false;

      const newBoard = board.map((row) => [...row]);
      // Find lowest empty row
      for (let r = ROWS - 1; r >= 0; r--) {
        if (newBoard[r][col] === null) {
          newBoard[r][col] = currentPlayer;
          setBoard(newBoard);
          setMoveCount((c) => c + 1);

          const win = checkWin(newBoard, currentPlayer);
          if (win) {
            setWinner(currentPlayer);
            setWinningCells(win);
          } else if (isBoardFull(newBoard)) {
            setWinner("draw");
          } else {
            setCurrentPlayer((p) => (p === "red" ? "yellow" : "red"));
            resetTimer();
          }
          return true;
        }
      }
      return false; // Column full
    },
    [board, currentPlayer, winner, resetTimer]
  );

  const blastPiece = useCallback(
    (row: number, col: number) => {
      if (winner) return false;
      if (!hasBlastToken) return false;
      if (board[row][col] === null) return false;

      // Remove the blast targets and settle the board
      const settledBoard = applyBlast(board, row, col);

      // Use the blast token
      if (currentPlayer === "red") setRedBlastToken(false);
      else setYellowBlastToken(false);

      setBoard(settledBoard);
      setMoveCount((c) => c + 1);

      // Check if this created a win for either player
      const winRed = checkWin(settledBoard, "red");
      const winYellow = checkWin(settledBoard, "yellow");
      if (winRed) {
        setWinner("red");
        setWinningCells(winRed);
      } else if (winYellow) {
        setWinner("yellow");
        setWinningCells(winYellow);
      } else if (isBoardFull(settledBoard)) {
        setWinner("draw");
      } else {
        setCurrentPlayer((p) => (p === "red" ? "yellow" : "red"));
        resetTimer();
      }
      return true;
    },
    [board, currentPlayer, winner, hasBlastToken, resetTimer]
  );

  const resetGame = useCallback((startingPlayer?: "red" | "yellow") => {
    setBoard(createEmptyBoard());
    setCurrentPlayer(startingPlayer || "red");
    setWinner(null);
    setWinningCells(null);
    setRedBlastToken(true);
    setYellowBlastToken(true);
    setTimer(timerDuration || 0);
    setMoveCount(0);
    setPaused(false);
  }, [timerDuration]);

  /**
   * Replace the whole game state in one batch, so a render never sees half of a
   * restored Match. Internal to the Match — not for render Modules.
   */
  const restore = useCallback((state: {
    board: Board;
    currentPlayer: "red" | "yellow";
    winner: CellValue | "draw";
    winningCells: number[][] | null;
    redBlastToken: boolean;
    yellowBlastToken: boolean;
    timer: number;
  }) => {
    setBoard(state.board.map((row) => [...row]));
    setCurrentPlayer(state.currentPlayer);
    setWinner(state.winner);
    setWinningCells(state.winningCells);
    setRedBlastToken(state.redBlastToken);
    setYellowBlastToken(state.yellowBlastToken);
    setTimer(state.timer);
    // Blasts also count as moves, so this is a lower bound; nothing reads it for rules.
    setMoveCount(state.board.flat().filter((cell) => cell !== null).length);
  }, []);

  return {
    board,
    currentPlayer,
    winner,
    winningCells,
    dropPiece,
    blastPiece,
    resetGame,
    restore,
    hasBlastToken,
    redBlastToken,
    yellowBlastToken,
    timer,
    timerEnabled,
    timerDuration,
    moveCount,
    paused,
    setPaused,
  };
}