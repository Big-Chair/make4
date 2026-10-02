import { useState, useCallback, useEffect, startTransition } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./routes";
import { StartScreen, GameMode } from "./components/StartScreen";
import { GameScreen } from "./components/GameScreen";
import { Difficulty } from "./components/connect4AI";
import { recordGame, fetchStats, recordVisit, type SiteStats } from "./components/api";
import { save as saveToken, type TokenConfig } from "./components/tokens";
import { OnlineLobby } from "./components/OnlineLobby";
import { useRoom } from "./components/useRoom";
import { persistsMatchResult } from "./components/matchResult";
import { ThemeProvider } from "./components/ThemeContext";

export interface Scoreboard {
  red: number;
  yellow: number;
  draws: number;
}

export default function App() {
  return <RouterProvider router={router} />;
}

export function GameApp() {
  // ── State ──
  const [screen, setScreen] = useState<"start" | "lobby" | "game">("start");
  const [gameMode, setGameMode] = useState<GameMode>("local");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [score, setScore] = useState<Scoreboard>({ red: 0, yellow: 0, draws: 0 });
  const [player1Name, setPlayer1Name] = useState("");
  const [player2Name, setPlayer2Name] = useState("");
  /** Local and bot only; an online Match takes its timer from the Room. */
  const [localTimerDuration, setLocalTimerDuration] = useState(40);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastPlayerName, setLastPlayerName] = useState("");
  const [p1Token, setP1Token] = useState<TokenConfig>({ type: "default" });
  const [p2Token, setP2Token] = useState<TokenConfig>({ type: "default" });
  const [initialRoomCode, setInitialRoomCode] = useState<string | null>(null);
  const [siteStats, setSiteStats] = useState<SiteStats | null>(null);

  // The owning Room Module. An online Match starts from its Match input and
  // nothing else: Role, participants, timer, and Blast-token setting.
  const room = useRoom();
  const onlineMatch = gameMode === "online" ? room.match : null;
  const timerDuration = onlineMatch ? onlineMatch.timerDuration : localTimerDuration;
  const blastTokens = onlineMatch ? onlineMatch.blastTokens : true;

  // Start the online Match the moment the Room is ready — no fixed delay, no
  // Role-to-player assembly in the lobby.
  const readyMatch = room.match?.live ? room.match : null;
  useEffect(() => {
    if (!readyMatch || screen !== "lobby") return;
    const { role, participants } = readyMatch;
    setGameMode("online");
    setLastPlayerName(role === "host" ? participants.red.name : participants.yellow.name);
    setInitialRoomCode(null);
    startTransition(() => setScreen("game"));
  }, [readyMatch, screen]);

  // A Room Module that starts failed has refused to recover a Match from before a
  // page reload; show that refusal in the lobby instead of silently starting over.
  useEffect(() => {
    if (room.lobby.error === null) return;
    setGameMode("online");
    setScreen("lobby");
    // Mount only: a later failure belongs to the screen it happens on.
  }, []);

  // Record visit once per session
  useEffect(() => {
    const visited = sessionStorage.getItem("make4_visited");
    if (!visited) {
      recordVisit().then(() => sessionStorage.setItem("make4_visited", "1"));
    }
  }, []);

  // Fetch site stats on mount and when returning to start screen
  const loadStats = useCallback(async () => {
    const res = await fetchStats();
    if (res.ok) setSiteStats(res.data);
  }, []);

  // Check for ?room= URL parameter on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get("room");
    if (roomCode) {
      setInitialRoomCode(roomCode.toUpperCase().trim());
      setGameMode("online");
      setScreen("lobby");
      // Clean the URL
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Fetch site stats when returning to the start screen (its Leaderboard loads itself)
  useEffect(() => {
    if (screen === "start") {
      loadStats();
    }
  }, [screen, loadStats]);

  const handleStart = (
    mode: GameMode,
    diff?: Difficulty,
    p1?: string,
    p2?: string,
    timer?: number,
    sound?: boolean,
    p1Tok?: TokenConfig,
    p2Tok?: TokenConfig,
  ) => {
    if (mode === "online") {
      setGameMode("online");
      setScreen("lobby");
      return;
    }
    setGameMode(mode);
    if (diff) setDifficulty(diff);
    setPlayer1Name(p1 || "Player 1");
    setPlayer2Name(mode === "bot" ? `Bot (${diff || "medium"})` : (p2 || "Player 2"));
    setLastPlayerName(p1 || "Player 1");
    if (timer !== undefined) setLocalTimerDuration(timer);
    if (sound !== undefined) setSoundEnabled(sound);
    if (p1Tok) setP1Token(p1Tok);
    if (p2Tok) setP2Token(p2Tok);
    startTransition(() => setScreen("game"));
  };

  // Online participants come from the Room's Match input, so a Player Token
  // that arrives (or changes) after the Match starts updates live.
  const p1Name = onlineMatch ? onlineMatch.participants.red.name : player1Name;
  const p2Name = onlineMatch ? onlineMatch.participants.yellow.name : player2Name;
  const p1TokenEffective = onlineMatch ? onlineMatch.participants.red.token : p1Token;
  const p2TokenEffective = onlineMatch ? onlineMatch.participants.yellow.token : p2Token;

  const handleGameEnd = async (winner: "red" | "yellow" | "draw") => {
    setScore((prev) => ({
      ...prev,
      ...(winner === "draw" ? { draws: prev.draws + 1 } : { [winner]: prev[winner] + 1 }),
    }));

    // Both peers keep local score; only a timed Match persists, and online only
    // the host of a live Room — a no-contest Room never records a result.
    if (persistsMatchResult({ gameMode, timerDuration, room: onlineMatch })) {
      const mappedWinner = winner === "red" ? "player1" : winner === "yellow" ? "player2" : "draw";
      await recordGame(p1Name, p2Name, mappedWinner, gameMode, timerDuration);
    }
  };

  // Save token configs to server when they change (for leaderboard persistence).
  // Online, the local player's token also goes through the Room so the peer sees it.
  const handleP1TokenChange = useCallback((config: TokenConfig) => {
    setP1Token(config);
    if (p1Name) saveToken(p1Name, config);
    if (onlineMatch?.role === "host") room.updateLocalToken(config);
  }, [p1Name, onlineMatch, room]);

  const handleP2TokenChange = useCallback((config: TokenConfig) => {
    setP2Token(config);
    if (p2Name) saveToken(p2Name, config);
    if (onlineMatch?.role === "guest") room.updateLocalToken(config);
  }, [p2Name, onlineMatch, room]);

  return (
    <ThemeProvider>
    <div className="size-full">
      {screen === "start" ? (
        <StartScreen
          onStart={handleStart}
          score={score}
          onResetScore={() => setScore({ red: 0, yellow: 0, draws: 0 })}
          leaderboardPlayerName={lastPlayerName || undefined}
          siteStats={siteStats}
        />
      ) : screen === "lobby" ? (
        <OnlineLobby
          lobby={room.lobby}
          onCreate={room.create}
          onJoin={room.join}
          onLeave={room.leave}
          onTokenChange={room.updateLocalToken}
          initialRoomCode={initialRoomCode}
          siteStats={siteStats}
          onBack={() => { setInitialRoomCode(null); setScreen("start"); }}
        />
      ) : (
        <GameScreen
          onExit={() => { void room.leave(); setScreen("start"); }}
          gameMode={gameMode}
          difficulty={difficulty}
          score={score}
          onGameEnd={handleGameEnd}
          player1Name={p1Name}
          player2Name={p2Name}
          timerDuration={timerDuration}
          blastTokens={blastTokens}
          soundEnabled={soundEnabled}
          onSoundToggle={() => setSoundEnabled((s) => !s)}
          onDifficultyChange={(d) => {
            setDifficulty(d);
            setPlayer2Name(`Bot (${d})`);
            // Adjust timer per difficulty: Hard=30s, Medium=35s, Easy=40s
            const DIFFICULTY_TIMER: Record<string, number> = { easy: 40, medium: 35, hard: 30 };
            if (localTimerDuration > 0) setLocalTimerDuration(DIFFICULTY_TIMER[d] ?? 40);
          }}
          p1Token={p1TokenEffective}
          p2Token={p2TokenEffective}
          transport={onlineMatch?.transport ?? undefined}
          role={onlineMatch?.role}
          roomNotice={onlineMatch?.notice ?? null}
          onP1TokenChange={handleP1TokenChange}
          onP2TokenChange={handleP2TokenChange}
        />
      )}
    </div>
    </ThemeProvider>
  );
}
