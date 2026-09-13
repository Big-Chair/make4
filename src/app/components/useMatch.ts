import { useState, useEffect, useRef, useCallback } from "react";
import {
  useConnect4,
  type Board,
  type CellValue,
} from "./useConnect4";
import { findBestBlastTarget } from "./blast";
import { getBestMove, getBestBlastMove, type Difficulty } from "./connect4AI";
import type { GameMode } from "./StartScreen";
import type { OnlineMatchTransport } from "./room";
import { PROTOCOL_VERSION } from "./room";
import {
  playDrop,
  playBlast,
  playWin,
  playDraw,
  playTimerTick,
  playTimerUrgent,
  playReset,
  playClick,
} from "./useSoundEffects";

function newMatchId(): string {
  return `match-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * useMatch — the deep move pipeline.
 *
 * Owns everything between "a player intends a move" and "the board reflects it":
 * turn legality, applying the move locally, broadcasting it when online, replying
 * as the bot, applying the opponent's broadcast, the pre-game countdown, and
 * recording the winner exactly once.
 *
 * Callers learn four verbs — `drop`, `blast`, `autoBlast`, `reset` — and never
 * re-derive turn checks or remember to broadcast. Online play is injected as the
 * narrow `transport` Adapter owned by the Room Module — the Match never sees Room
 * creation, joining, Player Token, invitation, failure, or Supabase concerns.
 * Absence of a transport is local/bot play.
 *
 * Invariants:
 *  - `drop`/`blast`/`autoBlast` are no-ops when it is not `isMyTurn` (online).
 *  - `drop`/`blast`/`autoBlast` do NOT play sound for the local human path —
 *    GameBoard / CameraControl own that. Bot and opponent-received moves DO play
 *    sound, since those never pass through the board UI.
 *  - `onGameEnd` fires exactly once per decided game.
 */
export interface UseMatchOptions {
  gameMode: GameMode;
  difficulty: Difficulty;
  timerDuration: number;
  soundEnabled: boolean;
  /** The Room's Match seam. Stable for one Room generation. */
  transport?: OnlineMatchTransport;
  onGameEnd: (winner: "red" | "yellow" | "draw") => void;
}

export interface UseMatchReturn {
  // Board state (from the rules engine)
  board: Board;
  currentPlayer: "red" | "yellow";
  winner: CellValue | "draw" | null;
  winningCells: number[][] | null;
  timer: number;
  timerDuration: number;
  timerEnabled: boolean;
  hasBlastToken: boolean;
  redBlastToken: boolean;
  yellowBlastToken: boolean;

  // Turn / role
  myColor: "red" | "yellow";
  isMyTurn: boolean;
  /** True when the board should reject input (bot's turn, opponent's turn, or countdown). */
  inputDisabled: boolean;

  // Blast targeting UI mode
  blastMode: boolean;
  setBlastMode: (v: boolean) => void;
  toggleBlast: () => void;

  // Pre-game countdown
  countdown: number;
  countdownLabel: string | null;

  // Delayed winner overlay
  showWinnerOverlay: boolean;
  setShowWinnerOverlay: (v: boolean) => void;

  // Move verbs — turn-checked, locally applied, broadcast when online
  drop: (col: number) => void;
  blast: (row: number, col: number) => void;
  autoBlast: () => void;
  reset: () => void;
}

export function useMatch({
  gameMode,
  difficulty,
  timerDuration,
  soundEnabled,
  transport,
  onGameEnd,
}: UseMatchOptions): UseMatchReturn {
  const game = useConnect4(timerDuration);

  const [blastMode, setBlastMode] = useState(false);
  const [botThinking, setBotThinking] = useState(false);
  const botMoveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRecordedWinner = useRef<string | null>(null);
  const lastWinnerColor = useRef<"red" | "yellow" | null>(null);

  // Pre-game countdown
  const [countdown, setCountdown] = useState(4);

  // Delayed winner overlay — let players see the winning line first
  const [showWinnerOverlay, setShowWinnerOverlay] = useState(false);
  const winnerOverlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Online: which color this player controls + whose turn it is
  const myColor = transport?.role === "guest" ? "yellow" : "red";
  const isMyTurn = gameMode !== "online" || game.currentPlayer === myColor;

  // Online: the local action revision (incremented per applied action) and the
  // current Match identity. Revision-gap repair lands with the Match Snapshot work.
  const revisionRef = useRef(0);
  const matchIdRef = useRef(newMatchId());

  // Online: register a move handler that fires immediately on broadcast.
  // Refs keep the handler pointed at the freshest game callbacks.
  const dropPieceRef = useRef(game.dropPiece);
  dropPieceRef.current = game.dropPiece;
  const blastPieceRef = useRef(game.blastPiece);
  blastPieceRef.current = game.blastPiece;
  const resetGameRef = useRef(game.resetGame);
  resetGameRef.current = game.resetGame;

  useEffect(() => {
    if (!transport) return;
    return transport.subscribe((msg) => {
      if (msg.type === "drop") {
        revisionRef.current = msg.revision;
        dropPieceRef.current(msg.col);
        if (soundEnabled) playDrop();
      } else if (msg.type === "blast") {
        revisionRef.current = msg.revision;
        blastPieceRef.current(msg.row, msg.col);
        if (soundEnabled) playBlast();
      } else if (msg.type === "rematch") {
        matchIdRef.current = msg.matchId;
        revisionRef.current = 0;
        const starter = lastWinnerColor.current || undefined;
        resetGameRef.current(starter);
        setBlastMode(false);
        setShowWinnerOverlay(false);
        if (winnerOverlayTimeoutRef.current) {
          clearTimeout(winnerOverlayTimeoutRef.current);
          winnerOverlayTimeoutRef.current = null;
        }
        setCountdown(4);
        lastRecordedWinner.current = null;
        if (soundEnabled) playReset();
      }
    });
  }, [transport, soundEnabled]);

  // Pause the game clock during the countdown
  useEffect(() => {
    game.setPaused(countdown > 0);
  }, [countdown]);

  // Tick the countdown
  useEffect(() => {
    if (countdown <= 0) return;
    const timeout = setTimeout(() => {
      if (soundEnabled && countdown > 1) playClick();
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearTimeout(timeout);
  }, [countdown, soundEnabled]);

  const toggleBlast = useCallback(() => {
    if (!game.winner) {
      setBlastMode((prev) => {
        // Can only enter blast mode if a token is available; can always exit
        if (!prev && !game.hasBlastToken) return false;
        return !prev;
      });
    }
  }, [game.hasBlastToken, game.winner]);

  // Record the winner exactly once, play the sting, schedule the overlay
  useEffect(() => {
    if (game.winner && game.winner !== lastRecordedWinner.current) {
      lastRecordedWinner.current = game.winner as string;
      // Only update the next starter on a decisive win, not on draws
      if (game.winner === "red" || game.winner === "yellow") {
        lastWinnerColor.current = game.winner;
      }
      onGameEnd(game.winner as "red" | "yellow" | "draw");
      if (game.winner === "red" || game.winner === "yellow") {
        if (soundEnabled) playWin();
      } else {
        if (soundEnabled) playDraw();
      }

      const delay = game.winner === "draw" ? 1500 : 3000;
      winnerOverlayTimeoutRef.current = setTimeout(() => {
        setShowWinnerOverlay(true);
      }, delay);
    }
  }, [game.winner, onGameEnd, soundEnabled]);

  // Clear winner tracking when the game resets
  useEffect(() => {
    if (!game.winner) {
      lastRecordedWinner.current = null;
      lastWinnerColor.current = null;
      setShowWinnerOverlay(false);
      if (winnerOverlayTimeoutRef.current) {
        clearTimeout(winnerOverlayTimeoutRef.current);
        winnerOverlayTimeoutRef.current = null;
      }
    }
  }, [game.winner]);

  // Timer tick sounds
  useEffect(() => {
    if (!soundEnabled) return;
    if (!game.timerEnabled) return;
    if (game.winner) return;
    if (countdown > 0) return;
    if (game.timer <= 3 && game.timer > 0) {
      playTimerUrgent();
    } else if (game.timer <= 5 && game.timer > 0) {
      playTimerTick();
    }
  }, [game.timer, game.winner, soundEnabled, game.timerEnabled, countdown]);

  // Bot reply — blast intelligence first, then a normal drop
  useEffect(() => {
    if (gameMode !== "bot") return;
    if (game.currentPlayer !== "yellow") return;
    if (game.winner) return;
    if (botThinking) return;
    if (countdown > 0) return;

    setBotThinking(true);

    botMoveTimeout.current = setTimeout(() => {
      if (game.yellowBlastToken) {
        const blastDecision = getBestBlastMove(game.board, "yellow", "red", difficulty);
        if (blastDecision && blastDecision.shouldBlast) {
          game.blastPiece(blastDecision.row, blastDecision.col);
          if (soundEnabled) playBlast();
          setBotThinking(false);
          return;
        }
      }

      const col = getBestMove(game.board, "yellow", "red", difficulty);
      if (col >= 0) {
        game.dropPiece(col);
        if (soundEnabled) playDrop();
      }
      setBotThinking(false);
    }, 400 + Math.random() * 400);

    return () => {
      if (botMoveTimeout.current) clearTimeout(botMoveTimeout.current);
    };
  }, [gameMode, game.currentPlayer, game.winner, game.board, difficulty, soundEnabled, countdown, game.yellowBlastToken]);

  // ─── Move verbs ───
  const drop = useCallback((col: number) => {
    if (gameMode === "online" && !isMyTurn) return;
    game.dropPiece(col);
    if (transport) {
      revisionRef.current += 1;
      void transport.send({
        protocolVersion: PROTOCOL_VERSION,
        type: "drop",
        revision: revisionRef.current,
        col,
      });
    }
  }, [game.dropPiece, gameMode, isMyTurn, transport]);

  const blast = useCallback((row: number, col: number) => {
    if (gameMode === "online" && !isMyTurn) return;
    game.blastPiece(row, col);
    if (transport) {
      revisionRef.current += 1;
      void transport.send({
        protocolVersion: PROTOCOL_VERSION,
        type: "blast",
        revision: revisionRef.current,
        row,
        col,
      });
    }
  }, [game.blastPiece, gameMode, isMyTurn, transport]);

  // Find the best target and blast it in one action (camera fist gesture)
  const autoBlast = useCallback(() => {
    if (game.winner || !game.hasBlastToken) return;
    if (gameMode === "online" && !isMyTurn) return;

    const bestPos = findBestBlastTarget(game.board, game.currentPlayer);
    if (bestPos) {
      game.blastPiece(bestPos[0], bestPos[1]);
      if (transport) {
        revisionRef.current += 1;
        void transport.send({
          protocolVersion: PROTOCOL_VERSION,
          type: "blast",
          revision: revisionRef.current,
          row: bestPos[0],
          col: bestPos[1],
        });
      }
    }
  }, [game.winner, game.hasBlastToken, game.board, game.currentPlayer, game.blastPiece, gameMode, isMyTurn, transport]);

  const reset = useCallback(() => {
    const starter = lastWinnerColor.current || undefined;
    game.resetGame(starter);
    setBlastMode(false);
    setShowWinnerOverlay(false);
    if (winnerOverlayTimeoutRef.current) {
      clearTimeout(winnerOverlayTimeoutRef.current);
      winnerOverlayTimeoutRef.current = null;
    }
    setCountdown(4);
    if (soundEnabled) playReset();
    if (transport) {
      // A rematch is a fresh Match identity with its revision reset.
      matchIdRef.current = newMatchId();
      revisionRef.current = 0;
      void transport.send({
        protocolVersion: PROTOCOL_VERSION,
        type: "rematch",
        matchId: matchIdRef.current,
      });
    }
  }, [game.resetGame, soundEnabled, transport]);

  const countdownLabel = countdown > 0
    ? countdown === 1 ? "GO!" : `${countdown - 1}`
    : null;

  const inputDisabled =
    (gameMode === "bot" && game.currentPlayer === "yellow") ||
    (gameMode === "online" && !isMyTurn) ||
    countdown > 0;

  return {
    board: game.board,
    currentPlayer: game.currentPlayer,
    winner: game.winner,
    winningCells: game.winningCells,
    timer: game.timer,
    timerDuration: game.timerDuration,
    timerEnabled: game.timerEnabled,
    hasBlastToken: game.hasBlastToken,
    redBlastToken: game.redBlastToken,
    yellowBlastToken: game.yellowBlastToken,

    myColor,
    isMyTurn,
    inputDisabled,

    blastMode,
    setBlastMode,
    toggleBlast,

    countdown,
    countdownLabel,

    showWinnerOverlay,
    setShowWinnerOverlay,

    drop,
    blast,
    autoBlast,
    reset,
  };
}
