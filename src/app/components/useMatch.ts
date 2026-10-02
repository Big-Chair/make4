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
import { colorFor } from "./room";
import {
  OPENING_MATCH_ID,
  createMatchSync,
  nextMatchId,
  type MatchAction,
  type MatchSync,
} from "./matchSync";
import {
  playDrop,
  playBlast,
  playWin,
  playDraw,
  playTimerTick,
  playTimerUrgent,
  playReset,
  playHover,
  playClick,
} from "./useSoundEffects";

/**
 * useMatch — the deep move pipeline.
 *
 * Owns everything between "a player intends a move" and "the board reflects it":
 * turn legality, applying the move locally, broadcasting it when online, replying
 * as the bot, applying the opponent's broadcast, the pre-game countdown, and
 * recording the winner once per Match identity.
 *
 * Callers learn four verbs — `drop`, `blast`, `autoBlast`, `reset` — and never
 * re-derive turn checks or remember to broadcast. Online play is injected as the
 * narrow `transport` Adapter owned by the Room Module — the Match never sees Room
 * creation, joining, Player Token, invitation, failure, or Supabase concerns.
 * Absence of a transport is local/bot play.
 *
 * Invariants:
 *  - `drop`/`blast`/`autoBlast` return whether the move applied. They refuse it
 *    during the countdown, on the bot's turn, and online when it is not
 *    `isMyTurn` or the Match is paused; the rules refuse illegal moves.
 *  - The Match owns move feedback: every applied move plays its sound and an
 *    applied Blast leaves blast mode. A refused move does neither, so inputs
 *    (board, keyboard, camera) never play sounds themselves — they signal
 *    `hover()` and the Match plays its cue.
 *  - `onGameEnd` fires at most once per Match identity — restoring a decided
 *    Match Snapshot cannot record its winner again.
 *
 * Online play goes through the Match sync module (`matchSync.ts`), which owns
 * the wire: revisions, envelopes, duplicate detection, the Match Snapshot
 * handshake, and rematch legality. This hook speaks to it only in actions — it
 * plays and applies Drops, Blasts and Timeouts, starts a rematch under the
 * identity the sync gives it, and restores a snapshot — and never builds a
 * message. Online, only the player whose turn it is times it out.
 *
 * Online, `reset` is a rematch: refused until the Match is decided, so no peer
 * can reset a Match in progress.
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
  /** False while `reset` would be refused — online, until the Match is decided. */
  canReset: boolean;
  isMyTurn: boolean;
  /** True when the board should reject input (bot's turn, opponent's turn, countdown, or an online pause). */
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

  // Move verbs — legality-checked, locally applied, broadcast when online. True when applied.
  drop: (col: number) => boolean;
  blast: (row: number, col: number) => boolean;
  autoBlast: () => boolean;
  reset: () => void;

  /** Hover cue: inputs signal a hover, the Match plays it when sound is on. */
  hover: () => void;
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

  // Pre-game countdown
  const [countdown, setCountdown] = useState(4);

  // Delayed winner overlay — let players see the winning line first
  const [showWinnerOverlay, setShowWinnerOverlay] = useState(false);
  const winnerOverlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Online: which color this player controls + whose turn it is
  const myColor = colorFor(transport?.role ?? "host");
  const isMyTurn = gameMode !== "online" || game.currentPlayer === myColor;
  // Online input and clocks run only while the Room's Match transport is ready.
  const onlinePaused = gameMode === "online" && transport?.status !== "ready";

  // Match identity. Both online peers start a Room's first Match under the same
  // identity (the Match remounts per Room); a rematch or restored snapshot replaces it.
  const [matchId, setMatchId] = useState(OPENING_MATCH_ID);
  /** The Match identity whose winner has been recorded. */
  const recordedMatchIdRef = useRef<string | null>(null);
  /** The online Match sync for the current transport. */
  const syncRef = useRef<MatchSync | null>(null);

  // Refs keep the sync pointed at the freshest state and callbacks.
  const gameRef = useRef(game);
  gameRef.current = game;
  const countdownRef = useRef(countdown);
  countdownRef.current = countdown;
  const soundRef = useRef(soundEnabled);
  soundRef.current = soundEnabled;

  const clearWinnerOverlay = useCallback(() => {
    setShowWinnerOverlay(false);
    if (winnerOverlayTimeoutRef.current) {
      clearTimeout(winnerOverlayTimeoutRef.current);
      winnerOverlayTimeoutRef.current = null;
    }
  }, []);

  /** Apply a Drop, Blast or Timeout for the current player. False when the rules reject it. */
  const applyAction = useCallback((action: MatchAction) => {
    const liveGame = gameRef.current;
    if (action.type === "timeout") return liveGame.timeoutTurn();
    return action.type === "drop"
      ? liveGame.dropPiece(action.col)
      : liveGame.blastPiece(action.row, action.col);
  }, []);

  /** Start a fresh Match under `id` after a new countdown. The winner of the
   *  Match being replaced starts; after a draw or an unfinished Match, red does.
   *  Read from the Board, so both peers agree even after a snapshot restore. */
  const startFresh = useCallback((id: string) => {
    const { winner } = gameRef.current;
    gameRef.current.resetGame(winner === "red" || winner === "yellow" ? winner : undefined);
    setMatchId(id);
    setBlastMode(false);
    clearWinnerOverlay();
    setCountdown(4);
    if (soundRef.current) playReset();
  }, [clearWinnerOverlay]);

  // Online: hand the transport to a Match sync that applies, rematches, and restores.
  useEffect(() => {
    if (!transport) return;
    const myTransportColor = colorFor(transport.role);
    const sync = createMatchSync({
      transport,
      match: {
        read: () => {
          const liveGame = gameRef.current;
          return {
            board: liveGame.board,
            currentPlayer: liveGame.currentPlayer,
            winner: liveGame.winner,
            winningCells: liveGame.winningCells,
            redBlastToken: liveGame.redBlastToken,
            yellowBlastToken: liveGame.yellowBlastToken,
            timer: liveGame.timer,
            countdown: countdownRef.current,
          };
        },
        apply: (action) => {
          const byOpponent = gameRef.current.currentPlayer !== myTransportColor;
          if (!applyAction(action)) return false;
          // The local human's moves sound from the board UI; the opponent's sound here.
          if (byOpponent && soundRef.current) {
            if (action.type === "drop") playDrop();
            else if (action.type === "blast") playBlast();
          }
          return true;
        },
        rematch: startFresh,
        // All state setters run in one synchronous batch: one render, no half-restored Match.
        restore: (snapshot) => {
          gameRef.current.restore(snapshot);
          setMatchId(snapshot.matchId);
          setCountdown(snapshot.countdown);
          setBlastMode(false);
        },
      },
    });
    syncRef.current = sync;
    return () => {
      sync.dispose();
      syncRef.current = null;
    };
  }, [transport, applyAction, startFresh]);

  // Online: tell the sync when the Room's status moves, so it can run the handshake.
  const transportStatus = transport?.status;
  useEffect(() => {
    syncRef.current?.statusChanged();
  }, [transport, transportStatus]);

  // Pause the game clock during the countdown and while an online Match is paused
  useEffect(() => {
    game.setPaused(countdown > 0 || onlinePaused);
  }, [countdown, onlinePaused]);

  // The turn clock ran out: the player whose turn it is plays a Timeout. Online
  // only this peer's own turn times out here; the peer's clock is display only,
  // waiting at zero for the broadcast Timeout (or move) to pass the turn.
  const clockExpired =
    game.timerEnabled && game.timer === 0 && !game.winner && countdown === 0 && !onlinePaused;
  useEffect(() => {
    if (!clockExpired) return;
    if (gameMode === "online") {
      if (gameRef.current.currentPlayer === myColor) syncRef.current?.play({ type: "timeout" });
    } else {
      gameRef.current.timeoutTurn();
    }
  }, [clockExpired, game.currentPlayer, gameMode, myColor]);

  // Tick the countdown
  useEffect(() => {
    if (countdown <= 0 || onlinePaused) return;
    const timeout = setTimeout(() => {
      if (soundEnabled && countdown > 1) playClick();
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearTimeout(timeout);
  }, [countdown, soundEnabled, onlinePaused]);

  const toggleBlast = useCallback(() => {
    if (!game.winner) {
      setBlastMode((prev) => {
        // Can only enter blast mode if a token is available; can always exit
        if (!prev && !game.hasBlastToken) return false;
        return !prev;
      });
    }
  }, [game.hasBlastToken, game.winner]);

  // Record the winner once per Match identity, play the sting, schedule the overlay
  useEffect(() => {
    if (!game.winner || recordedMatchIdRef.current === matchId) return;
    recordedMatchIdRef.current = matchId;
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
  }, [game.winner, matchId, onGameEnd, soundEnabled]);

  // Clear winner display when the game resets
  useEffect(() => {
    if (!game.winner) {
      clearWinnerOverlay();
    }
  }, [game.winner, clearWinnerOverlay]);

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

  /**
   * Play the local human's move. False when it is refused: during the countdown,
   * on the bot's turn, by the sync (online turn and pause), or by the rules.
   * Only an applied move sounds, and an applied Blast leaves blast mode.
   */
  const play = useCallback(
    (action: MatchAction) => {
      if (countdownRef.current > 0) return false;
      if (gameMode === "bot" && gameRef.current.currentPlayer === "yellow") return false;
      const applied = gameMode === "online"
        ? syncRef.current?.play(action) ?? false
        : applyAction(action);
      if (!applied) return false;
      if (action.type === "blast") setBlastMode(false);
      if (soundRef.current) {
        if (action.type === "drop") playDrop();
        else playBlast();
      }
      return true;
    },
    [gameMode, applyAction],
  );

  const drop = useCallback((col: number) => play({ type: "drop", col }), [play]);

  const blast = useCallback((row: number, col: number) => play({ type: "blast", row, col }), [play]);

  // Find the best target and blast it in one action (camera fist gesture)
  const autoBlast = useCallback(() => {
    const bestPos = findBestBlastTarget(game.board, game.currentPlayer);
    return bestPos ? play({ type: "blast", row: bestPos[0], col: bestPos[1] }) : false;
  }, [game.board, game.currentPlayer, play]);

  const hover = useCallback(() => {
    if (soundRef.current) playHover();
  }, []);

  const canReset = gameMode !== "online" || (!onlinePaused && game.winner !== null);

  const reset = useCallback(() => {
    // Online, a rematch: the sync refuses it until the Match is decided.
    if (gameMode === "online") syncRef.current?.rematch();
    else startFresh(nextMatchId(matchId));
  }, [gameMode, matchId, startFresh]);

  const countdownLabel = countdown > 0
    ? countdown === 1 ? "GO!" : `${countdown - 1}`
    : null;

  const inputDisabled =
    (gameMode === "bot" && game.currentPlayer === "yellow") ||
    (gameMode === "online" && !isMyTurn) ||
    onlinePaused ||
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
    canReset,
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
    hover,
  };
}
