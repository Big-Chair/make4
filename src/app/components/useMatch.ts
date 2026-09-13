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
import { PROTOCOL_VERSION, colorFor } from "./room";
import { decodeMatchSnapshot, type MatchSnapshot } from "./matchSnapshot";
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

const OPENING_MATCH_ID = "match-opening";

function newId(prefix: "match" | "resync"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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
 *  - `drop`/`blast`/`autoBlast` are no-ops when it is not `isMyTurn` (online).
 *  - `drop`/`blast`/`autoBlast` do NOT play sound for the local human path —
 *    GameBoard / CameraControl own that. Bot and opponent-received moves DO play
 *    sound, since those never pass through the board UI.
 *  - `onGameEnd` fires at most once per Match identity — restoring a decided
 *    Match Snapshot cannot record its winner again.
 *
 * Online revisions: each successfully applied Drop or Blast advances the Match
 * revision and is broadcast with it; rejected local actions do neither. An
 * incoming action applies only at exactly revision + 1. Anything else — missing,
 * duplicate, out of order, or unplayable — interrupts the Room instead of
 * changing the Board, and the host's authoritative Match Snapshot repairs it:
 * the guest requests it (or the host pushes it when the host saw the gap), the
 * guest restores it atomically and acknowledges the revision, and only then do
 * input and the timer resume.
 *
 * Reconnect reuses the same handshake. The Room pauses the Match when a channel
 * or a participant's Presence is lost; once both sessions are live again its
 * transport becomes `resynchronizing` and the Match starts the handshake from
 * both ends — the guest requests the snapshot and the host pushes it — because
 * either peer may be the only one that noticed. A peer still waiting for the
 * other session ignores the handshake (it could not resume anyway) and starts
 * its own once the Room is resynchronizing. A guest that is already ready and
 * receives a snapshot identical to its Match only acknowledges it, so a
 * duplicate snapshot never pauses the Match a second time.
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
  const lastWinnerColor = useRef<"red" | "yellow" | null>(null);

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

  // Match identity and online revision. A rematch or restored snapshot replaces both.
  // Both online peers start a Room's first Match under the same identity (the
  // Match remounts per Room), so a restored snapshot is recognizably the same Match.
  const [matchId, setMatchId] = useState(() =>
    gameMode === "online" ? OPENING_MATCH_ID : newId("match"),
  );
  const matchIdRef = useRef(matchId);
  const revisionRef = useRef(0);
  /** The Match identity whose winner has been recorded. */
  const recordedMatchIdRef = useRef<string | null>(null);
  /** Host: snapshots sent this resynchronization, any of whose acknowledgement resumes. */
  const pendingSnapshotIdsRef = useRef(new Set<string>());
  /** A snapshot handshake is under way for the current resynchronization. */
  const handshakeRef = useRef(false);
  /** Starts the handshake from this peer's end; set by the transport effect. */
  const beginHandshakeRef = useRef<(() => void) | null>(null);

  // Refs keep the transport handler pointed at the freshest state and callbacks.
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

  const startMatch = useCallback((id: string) => {
    matchIdRef.current = id;
    setMatchId(id);
    revisionRef.current = 0;
  }, []);

  // Online: apply the opponent's broadcasts and run snapshot resynchronization.
  useEffect(() => {
    if (!transport) return;

    const createSnapshot = (): MatchSnapshot => {
      const liveGame = gameRef.current;
      return {
        protocolVersion: PROTOCOL_VERSION,
        matchId: matchIdRef.current,
        revision: revisionRef.current,
        board: liveGame.board,
        currentPlayer: liveGame.currentPlayer,
        winner: liveGame.winner,
        winningCells: liveGame.winningCells,
        redBlastToken: liveGame.redBlastToken,
        yellowBlastToken: liveGame.yellowBlastToken,
        timer: liveGame.timer,
        countdown: countdownRef.current,
      };
    };

    /** Everything a snapshot restores except clocks, for spotting a duplicate. */
    const matchContent = (snapshot: MatchSnapshot) =>
      JSON.stringify([
        snapshot.matchId,
        snapshot.revision,
        snapshot.board,
        snapshot.currentPlayer,
        snapshot.winner,
        snapshot.redBlastToken,
        snapshot.yellowBlastToken,
      ]);

    const sendSnapshot = (requestId: string) => {
      pendingSnapshotIdsRef.current.add(requestId);
      void transport.send({
        protocolVersion: PROTOCOL_VERSION,
        type: "snapshot",
        requestId,
        snapshot: createSnapshot(),
      });
    };

    // All state setters below run in one synchronous batch: one render, no half-restored Match.
    const restoreSnapshot = (snapshot: MatchSnapshot) => {
      gameRef.current.restore(snapshot);
      matchIdRef.current = snapshot.matchId;
      setMatchId(snapshot.matchId);
      revisionRef.current = snapshot.revision;
      setCountdown(snapshot.countdown);
      setBlastMode(false);
    };

    const beginHandshake = () => {
      handshakeRef.current = true;
      if (transport.role === "host") {
        // The host is authoritative: push its snapshot for the guest to restore.
        sendSnapshot(newId("resync"));
      } else {
        void transport.send({
          protocolVersion: PROTOCOL_VERSION,
          type: "snapshot-request",
          requestId: newId("resync"),
        });
      }
    };
    beginHandshakeRef.current = beginHandshake;

    const repairDivergence = () => {
      transport.interrupt("revision-gap");
      beginHandshake();
    };

    /** Answer the peer's handshake: pause (if still ready) and mark it under way. */
    const joinHandshake = () => {
      transport.interrupt("revision-gap");
      handshakeRef.current = true;
    };

    const resume = () => {
      handshakeRef.current = false;
      transport.resume();
    };

    const opponentColor = colorFor(transport.role === "host" ? "guest" : "host");

    return transport.subscribe((msg) => {
      switch (msg.type) {
        case "drop":
        case "blast": {
          // Mid-resynchronization, the incoming snapshot supersedes in-flight actions.
          if (transport.status !== "ready") return;
          const liveGame = gameRef.current;
          if (msg.revision !== revisionRef.current + 1 || liveGame.currentPlayer !== opponentColor) {
            repairDivergence();
            return;
          }
          const applied =
            msg.type === "drop" ? liveGame.dropPiece(msg.col) : liveGame.blastPiece(msg.row, msg.col);
          if (!applied) {
            repairDivergence();
            return;
          }
          revisionRef.current = msg.revision;
          if (soundRef.current) {
            if (msg.type === "drop") playDrop();
            else playBlast();
          }
          return;
        }
        case "rematch": {
          // Mid-resynchronization the host's snapshot already carries its Match identity.
          if (transport.status !== "ready") return;
          startMatch(msg.matchId);
          const starter = lastWinnerColor.current || undefined;
          gameRef.current.resetGame(starter);
          setBlastMode(false);
          clearWinnerOverlay();
          setCountdown(4);
          if (soundRef.current) playReset();
          return;
        }
        case "snapshot-request": {
          // While the guest's session is still missing the host could not resume on
          // its acknowledgement; it pushes its own snapshot once resynchronizing.
          if (transport.role !== "host" || transport.status === "interrupted") return;
          joinHandshake();
          sendSnapshot(msg.requestId);
          return;
        }
        case "snapshot": {
          if (transport.role !== "guest") return;
          const snapshot = decodeMatchSnapshot(msg.snapshot);
          if (!snapshot) {
            console.warn("[Match] Ignoring undecodable Match Snapshot:", msg.snapshot);
            transport.fail("The host's Match Snapshot could not be read.");
            return;
          }
          // Waiting for the host's session: this peer could not resume, so it must
          // not acknowledge; it requests a snapshot once resynchronizing.
          if (transport.status === "interrupted") return;
          const acknowledge = () =>
            transport.send({
              protocolVersion: PROTOCOL_VERSION,
              type: "snapshot-applied",
              requestId: msg.requestId,
              revision: snapshot.revision,
            });
          if (transport.status === "ready" && matchContent(snapshot) === matchContent(createSnapshot())) {
            // A duplicate of the Match already restored: acknowledge, never pause again.
            void acknowledge();
            return;
          }
          joinHandshake();
          restoreSnapshot(snapshot);
          acknowledge().then(
              () => resume(),
              () => transport.fail("Could not acknowledge the host's Match Snapshot."),
            );
          return;
        }
        case "snapshot-applied": {
          if (transport.role !== "host" || !pendingSnapshotIdsRef.current.has(msg.requestId)) return;
          pendingSnapshotIdsRef.current.clear();
          if (msg.revision !== revisionRef.current) {
            transport.fail("The guest acknowledged a different Match revision.");
            return;
          }
          resume();
          return;
        }
        default:
          return;
      }
    });
  }, [transport, startMatch, clearWinnerOverlay]);

  // Online: when the Room has both sessions back after an interruption, start the
  // snapshot handshake unless one is already under way for this resynchronization.
  const transportStatus = transport?.status;
  useEffect(() => {
    // Read the live status: a handshake may have started since this render.
    if (transport?.status !== "resynchronizing") {
      // Ready, or waiting for a session: any earlier handshake is over.
      handshakeRef.current = false;
      if (transport?.status === "interrupted") pendingSnapshotIdsRef.current.clear();
      return;
    }
    if (!handshakeRef.current) beginHandshakeRef.current?.();
  }, [transport, transportStatus]);

  // Pause the game clock during the countdown and while an online Match is paused
  useEffect(() => {
    game.setPaused(countdown > 0 || onlinePaused);
  }, [countdown, onlinePaused]);

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
  }, [game.winner, matchId, onGameEnd, soundEnabled]);

  // Clear winner display when the game resets
  useEffect(() => {
    if (!game.winner) {
      lastWinnerColor.current = null;
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

  /** Broadcast a locally applied action at the next revision. */
  const broadcastAction = useCallback(
    (action: { type: "drop"; col: number } | { type: "blast"; row: number; col: number }) => {
      if (!transport) return;
      revisionRef.current += 1;
      void transport.send({ protocolVersion: PROTOCOL_VERSION, ...action, revision: revisionRef.current });
    },
    [transport],
  );

  const drop = useCallback((col: number) => {
    if (onlinePaused || (gameMode === "online" && !isMyTurn)) return;
    // A rejected Drop neither advances the revision nor reaches the wire.
    if (!game.dropPiece(col)) return;
    broadcastAction({ type: "drop", col });
  }, [game.dropPiece, gameMode, isMyTurn, onlinePaused, broadcastAction]);

  const blast = useCallback((row: number, col: number) => {
    if (onlinePaused || (gameMode === "online" && !isMyTurn)) return;
    if (!game.blastPiece(row, col)) return;
    broadcastAction({ type: "blast", row, col });
  }, [game.blastPiece, gameMode, isMyTurn, onlinePaused, broadcastAction]);

  // Find the best target and blast it in one action (camera fist gesture)
  const autoBlast = useCallback(() => {
    if (game.winner || !game.hasBlastToken) return;
    if (onlinePaused || (gameMode === "online" && !isMyTurn)) return;

    const bestPos = findBestBlastTarget(game.board, game.currentPlayer);
    if (bestPos && game.blastPiece(bestPos[0], bestPos[1])) {
      broadcastAction({ type: "blast", row: bestPos[0], col: bestPos[1] });
    }
  }, [game.winner, game.hasBlastToken, game.board, game.currentPlayer, game.blastPiece, gameMode, isMyTurn, onlinePaused, broadcastAction]);

  const reset = useCallback(() => {
    if (onlinePaused) return;
    const starter = lastWinnerColor.current || undefined;
    game.resetGame(starter);
    setBlastMode(false);
    clearWinnerOverlay();
    setCountdown(4);
    if (soundEnabled) playReset();
    // A rematch is a fresh Match identity with its revision reset.
    const id = newId("match");
    startMatch(id);
    if (transport) {
      void transport.send({
        protocolVersion: PROTOCOL_VERSION,
        type: "rematch",
        matchId: id,
      });
    }
  }, [game.resetGame, soundEnabled, transport, onlinePaused, clearWinnerOverlay, startMatch]);

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
