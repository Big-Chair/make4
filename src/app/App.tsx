import { useState, useCallback, useEffect, startTransition } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./routes";
import { StartScreen, GameMode } from "./components/StartScreen";
import { GameScreen } from "./components/GameScreen";
import { Difficulty } from "./components/connect4AI";
import { recordGame, fetchLeaderboard, fetchStats, recordVisit, type PlayerStats, type SiteStats } from "./components/api";
import { save as saveToken, type TokenConfig } from "./components/tokens";
import { OnlineLobby } from "./components/OnlineLobby";
import { useOnlineGame } from "./components/useOnlineGame";
import { ThemeProvider } from "./components/ThemeContext";

export interface Scoreboard {
  red: number;
  yellow: number;
  draws: number;
}

export default function App() {
  return <RouterProvider router={router} future={{ v7_startTransition: true }} />;
}

export function GameApp() {
  // ── State ──
  const [screen, setScreen] = useState<"start" | "lobby" | "game">("start");
  const [gameMode, setGameMode] = useState<GameMode>("local");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [score, setScore] = useState<Scoreboard>({ red: 0, yellow: 0, draws: 0 });
  const [player1Name, setPlayer1Name] = useState("");
  const [player2Name, setPlayer2Name] = useState("");
  const [timerDuration, setTimerDuration] = useState(40);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [leaderboard, setLeaderboard] = useState<PlayerStats[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [lastPlayerName, setLastPlayerName] = useState("");
  const [currentPlayerData, setCurrentPlayerData] = useState<{ player: PlayerStats; rank: number } | null>(null);
  const [p1Token, setP1Token] = useState<TokenConfig>({ type: "default" });
  const [p2Token, setP2Token] = useState<TokenConfig>({ type: "default" });
  const [initialRoomCode, setInitialRoomCode] = useState<string | null>(null);
  const [siteStats, setSiteStats] = useState<SiteStats | null>(null);
  const [leaderboardTokenConfigs, setLeaderboardTokenConfigs] = useState<Record<string, any>>({});
  const [leaderboardLevel, setLeaderboardLevel] = useState("");

  const online = useOnlineGame();

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

  // Fetch leaderboard on mount and when returning to start screen
  const loadLeaderboard = useCallback(async (level?: string) => {
    setLeaderboardLoading(true);
    const res = await fetchLeaderboard(lastPlayerName || undefined, 20, level || undefined);
    if (res.ok) {
      setLeaderboard(res.data.players);
      setLeaderboardTokenConfigs(res.data.tokenConfigs || {});
      if (res.data.currentPlayer && res.data.currentPlayerRank) {
        setCurrentPlayerData({ player: res.data.currentPlayer, rank: res.data.currentPlayerRank });
      } else {
        setCurrentPlayerData(null);
      }
    } else {
      setLeaderboard([]);
      setLeaderboardTokenConfigs({});
      setCurrentPlayerData(null);
    }
    setLeaderboardLoading(false);
  }, [lastPlayerName]);

  useEffect(() => {
    if (screen === "start") {
      loadLeaderboard(leaderboardLevel);
      loadStats();
    }
  }, [screen, loadLeaderboard, loadStats]);

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
    if (timer !== undefined) setTimerDuration(timer);
    if (sound !== undefined) setSoundEnabled(sound);
    if (p1Tok) setP1Token(p1Tok);
    if (p2Tok) setP2Token(p2Tok);
    startTransition(() => setScreen("game"));
  };

  const handleGameEnd = async (winner: "red" | "yellow" | "draw") => {
    setScore((prev) => ({
      ...prev,
      ...(winner === "draw" ? { draws: prev.draws + 1 } : { [winner]: prev[winner] + 1 }),
    }));

    // Persist to leaderboard if playing with a timer (any duration counts)
    if (timerDuration > 0) {
      const mappedWinner = winner === "red" ? "player1" : winner === "yellow" ? "player2" : "draw";
      await recordGame(player1Name, player2Name, mappedWinner, gameMode, timerDuration);
    }
  };

  // Save token configs to server when they change (for leaderboard persistence)
  const handleP1TokenChange = useCallback((config: TokenConfig) => {
    setP1Token(config);
    if (player1Name) saveToken(player1Name, config);
  }, [player1Name]);

  const handleP2TokenChange = useCallback((config: TokenConfig) => {
    setP2Token(config);
    if (player2Name) saveToken(player2Name, config);
  }, [player2Name]);

  return (
    <ThemeProvider>
    <div className="size-full">
      {screen === "start" ? (
        <StartScreen
          onStart={handleStart}
          score={score}
          onResetScore={() => setScore({ red: 0, yellow: 0, draws: 0 })}
          leaderboard={leaderboard}
          leaderboardLoading={leaderboardLoading}
          currentPlayerData={currentPlayerData}
          siteStats={siteStats}
          leaderboardTokenConfigs={leaderboardTokenConfigs}
          onLeaderboardLevelChange={(level) => {
            setLeaderboardLevel(level);
            loadLeaderboard(level);
          }}
        />
      ) : screen === "lobby" ? (
        <OnlineLobby
          online={online}
          initialRoomCode={initialRoomCode}
          siteStats={siteStats}
          onGameReady={(p1, p2, timer, sound, p1Tok, p2Tok) => {
            setGameMode("online");
            setPlayer1Name(p1);
            setPlayer2Name(p2);
            setLastPlayerName(p1);
            setTimerDuration(timer);
            setSoundEnabled(sound);
            setP1Token(p1Tok);
            setP2Token(p2Tok);
            setInitialRoomCode(null);
            startTransition(() => setScreen("game"));
          }}
          onBack={() => { setInitialRoomCode(null); setScreen("start"); }}
        />
      ) : (
        <GameScreen
          onExit={() => { online.disconnect(); setScreen("start"); }}
          gameMode={gameMode}
          difficulty={difficulty}
          score={score}
          onGameEnd={handleGameEnd}
          player1Name={player1Name}
          player2Name={player2Name}
          spotifyToken={null}
          timerDuration={timerDuration}
          soundEnabled={soundEnabled}
          onSoundToggle={() => setSoundEnabled((s) => !s)}
          onDifficultyChange={(d) => {
            setDifficulty(d);
            setPlayer2Name(`Bot (${d})`);
            // Adjust timer per difficulty: Hard=30s, Medium=35s, Easy=40s
            const DIFFICULTY_TIMER: Record<string, number> = { easy: 40, medium: 35, hard: 30 };
            if (timerDuration > 0) setTimerDuration(DIFFICULTY_TIMER[d] ?? 40);
          }}
          p1Token={p1Token}
          p2Token={p2Token}
          online={gameMode === "online" ? online : undefined}
          onP1TokenChange={handleP1TokenChange}
          onP2TokenChange={handleP2TokenChange}
        />
      )}
    </div>
    </ThemeProvider>
  );
}
