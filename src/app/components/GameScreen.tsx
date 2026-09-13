import { useState, useEffect, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "motion/react";
import { RotateCcw } from "lucide-react";
import { GameBoard } from "./GameBoard";
import { PlayerCard, TopBar, WinnerOverlay } from "./GameUI";
import { GridDots, DiamondShape, CrossShape, FigmaLogo } from "./FigmaDecorations";
import { SpotifyPlayer } from "./SpotifyPlayer";
import { Difficulty } from "./connect4AI";
import { GameMode } from "./StartScreen";
import type { Scoreboard } from "../App";
import type { HandTrackingState } from "./useHandTracking";
import { LeaderboardDrawer } from "./LeaderboardDrawer";
import { TokenCustomizer } from "./TokenCustomizer";
import { type TokenConfig, DEFAULT_PALETTE } from "./tokens";
import type { OnlineMatchTransport } from "./room";
import { RoomStatusOverlay, type RoomNotice } from "./RoomStatusOverlay";
import { useMatch } from "./useMatch";
import { setSfxVolume } from "./useSoundEffects";
import { useIsMobile } from "./useIsMobile";
import { g } from "./ThemeContext";
import { useSpotifySDK } from "./useSpotifySDK";

// ─── Lazy-load desktop-only hand-tracking + camera control ───
// HMR cache-bust
const LazyDesktopHandTracking = lazy(() => import("./DesktopHandTracking"));

const NOOP_HAND_TRACKING: HandTrackingState = {
  isTracking: false,
  isLoading: false,
  error: null,
  selectedCol: null,
  blastCursor: null,
  gesture: undefined,
  start: () => {},
  stop: () => {},
};

interface GameScreenProps {
  onExit: () => void;
  gameMode: GameMode;
  difficulty: Difficulty;
  score: Scoreboard;
  onGameEnd: (winner: "red" | "yellow" | "draw") => void;
  player1Name: string;
  player2Name: string;
  spotifyToken: string | null;
  timerDuration: number;
  soundEnabled: boolean;
  onSoundToggle: () => void;
  onDifficultyChange?: (d: Difficulty) => void;
  p1Token?: TokenConfig;
  p2Token?: TokenConfig;
  /** The Room's Match seam when this Match is online. */
  transport?: OnlineMatchTransport;
  /** Why an online Match is paused or has ended as no contest; null while ready. */
  roomNotice?: RoomNotice | null;
  onP1TokenChange?: (config: TokenConfig) => void;
  onP2TokenChange?: (config: TokenConfig) => void;
}

export function GameScreen({ onExit, gameMode, difficulty, score, onGameEnd, player1Name, player2Name, spotifyToken, timerDuration, soundEnabled, onSoundToggle, onDifficultyChange, p1Token, p2Token, transport, roomNotice = null, onP1TokenChange, onP2TokenChange }: GameScreenProps) {
  const isMobile = useIsMobile();

  // The deep move pipeline: board state, turn legality, AI, online sync, countdown,
  // winner recording — all behind four verbs (drop / blast / autoBlast / reset).
  const match = useMatch({ gameMode, difficulty, timerDuration, soundEnabled, transport, onGameEnd });

  // Hand tracking state — synced from the lazy-loaded DesktopHandTracking child on desktop,
  // or stays as the no-op stub on mobile.
  const [handTracking, setHandTracking] = useState<HandTrackingState>(NOOP_HAND_TRACKING);

  // Leaderboard drawer state
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);

  // SFX volume state (persisted to localStorage)
  const [sfxVolume, setSfxVolumeState] = useState(() => {
    const saved = localStorage.getItem("make4-sfx-volume");
    return saved ? parseInt(saved) : 80;
  });
  const handleSfxVolumeChange = (v: number) => {
    setSfxVolumeState(v);
    setSfxVolume(v); // update the global Web Audio master volume
    localStorage.setItem("make4-sfx-volume", String(v));
  };

  // Initialize SFX volume on mount
  useEffect(() => {
    setSfxVolume(sfxVolume);
  }, []);

  // Spotify volume state (persisted to localStorage)
  const [spotifyVolume, setSpotifyVolume] = useState(() => {
    const saved = localStorage.getItem("make4-spotify-volume");
    return saved ? parseInt(saved) : 80;
  });
  const handleVolumeChange = (v: number) => {
    setSpotifyVolume(v);
    localStorage.setItem("make4-spotify-volume", String(v));
  };

  // Spotify Web Playback SDK — only on desktop with a token
  const spotifySDK = useSpotifySDK(isMobile ? null : spotifyToken, spotifyVolume);

  // Token customizer state
  const [tokenEditPlayer, setTokenEditPlayer] = useState<"red" | "yellow" | null>(null);

  return (
    <div
      className="h-screen w-full relative overflow-hidden flex flex-col"
      style={{ background: "var(--g-bg)" }}
    >
      {/* Background grid — desktop only */}
      {!isMobile && (
        <div
          className="absolute inset-0"
          style={{
            opacity: "var(--g-grid-opacity)",
            backgroundImage: `linear-gradient(var(--g-grid-dot) 1px, transparent 1px),
                              linear-gradient(90deg, var(--g-grid-dot) 1px, transparent 1px)`,
            backgroundSize: "40px 40px",
          }}
        />
      )}

      {/* Ambient glow effects — desktop only */}
      {/* removed — glow now lives behind the game board */}

      {/* Floating decorations — desktop only (already hidden via xl:block) */}
      <motion.div
        animate={{ y: [0, -10, 0] }}
        transition={{ repeat: Infinity, duration: 6 }}
        className="absolute top-[15%] left-[2%] hidden xl:block"
      >
        <GridDots />
      </motion.div>
      <motion.div
        animate={{ y: [0, 8, 0] }}
        transition={{ repeat: Infinity, duration: 5 }}
        className="absolute bottom-[20%] right-[3%] hidden xl:block"
      >
        <GridDots />
      </motion.div>
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ repeat: Infinity, duration: 4, delay: 1 }}
        className="absolute top-[40%] left-[4%] hidden xl:block"
      >
        <DiamondShape color="#0ACF83" />
      </motion.div>
      <motion.div
        animate={{ rotate: [0, 90, 0] }}
        transition={{ repeat: Infinity, duration: 8 }}
        className="absolute top-[60%] right-[4%] hidden xl:block"
      >
        <CrossShape />
      </motion.div>

      {/* Top Bar */}
      <div className="relative z-20 flex-shrink-0">
        <TopBar
          onReset={match.reset}
          onClose={onExit}
          timer={match.timer}
          timerDuration={match.timerDuration}
          timerEnabled={match.timerEnabled}
          currentPlayer={match.currentPlayer}
          blastMode={match.blastMode}
          hasBlastToken={match.hasBlastToken}
          onToggleBlast={match.toggleBlast}
          soundEnabled={soundEnabled}
          onSoundToggle={onSoundToggle}
          cameraTracking={handTracking.isTracking}
          cameraLoading={handTracking.isLoading}
          cameraError={handTracking.error}
          onCameraToggle={isMobile ? undefined : () => {
            if (handTracking.isTracking) {
              handTracking.stop();
            } else {
              handTracking.start();
            }
          }}
          onLeaderboardToggle={() => setLeaderboardOpen((o) => !o)}
          leaderboardOpen={leaderboardOpen}
          sfxVolume={sfxVolume}
          onSfxVolumeChange={handleSfxVolumeChange}
        />
      </div>

      {/* Main game area — fills all remaining space; on mobile, push board higher */}
      <div
        className={isMobile
          ? "relative z-10 flex-1 flex items-center justify-center px-1 pb-1 -mt-6"
          : "relative z-10 flex-1 flex items-center justify-center px-1 sm:px-4 pb-1 sm:pb-3"
        }
        style={isMobile ? { alignItems: "flex-start", paddingTop: "8px" } : undefined}
      >
        <div className="flex items-center gap-4 lg:gap-6 xl:gap-8 max-w-full">
          {/* Left Player Card — desktop */}
          <div className="hidden lg:block flex-shrink-0">
            <PlayerCard
              color="red"
              isActive={match.currentPlayer === "red" && !match.winner}
              hasBlastToken={match.redBlastToken}
              label={player1Name}
              winner={match.winner}
              wins={score.red}
              timer={match.timer}
              timerDuration={match.timerDuration}
              timerEnabled={match.timerEnabled}
              tokenConfig={p1Token}
              onEditToken={gameMode !== "online" || match.myColor === "red" ? () => setTokenEditPlayer("red") : undefined}
              onToggleBlast={match.currentPlayer === "red" && !match.winner ? match.toggleBlast : undefined}
              blastMode={match.blastMode && match.currentPlayer === "red"}
            />
          </div>

          {/* Board + Countdown */}
          <div className="flex flex-col items-center relative">
            {/* Blast mode banner */}
            {match.blastMode && match.countdown <= 0 && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-1 sm:mb-2 px-3 sm:px-4 py-1 sm:py-1.5 rounded-full"
                style={{
                  background: "rgba(162,89,255,0.12)",
                  border: "1px solid rgba(162,89,255,0.3)",
                }}
              >
                <span className="hidden sm:inline text-sm" style={{ color: "#A259FF" }}>
                  Click any piece to blast it and its neighbors
                </span>
                <span className="sm:hidden text-xs" style={{ color: "#A259FF" }}>
                  Tap a piece to blast
                </span>
              </motion.div>
            )}

            <div className="relative">
              <GameBoard
                board={match.board}
                currentPlayer={match.currentPlayer}
                winner={match.winner}
                winningCells={match.winningCells}
                onDrop={match.drop}
                onBlast={match.blast}
                hasBlastToken={match.hasBlastToken}
                blastMode={match.blastMode}
                setBlastMode={match.setBlastMode}
                disabled={match.inputDisabled}
                soundEnabled={soundEnabled}
                onToggleBlast={match.toggleBlast}
                handSelectedCol={handTracking.isTracking ? handTracking.selectedCol : null}
                handBlastCursor={handTracking.isTracking ? handTracking.blastCursor : null}
                handGesture={handTracking.isTracking ? handTracking.gesture : undefined}
                p1Token={p1Token}
                p2Token={p2Token}
                reducedMotion={isMobile}
              />

              {/* Countdown Overlay */}
              <AnimatePresence>
                {match.countdown > 0 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="absolute inset-0 z-30 flex items-center justify-center rounded-3xl"
                    style={{
                      background: "rgba(0,0,0,0.65)",
                      backdropFilter: "blur(6px)",
                    }}
                  >
                    {/* Ring + centered content wrapper — smaller on mobile */}
                    <div className="relative flex items-center justify-center w-[140px] h-[140px] sm:w-[240px] sm:h-[240px]">
                      {/* Countdown ring */}
                      <svg
                        className="absolute inset-0 w-full h-full"
                        viewBox="0 0 240 240"
                        style={{ opacity: 0.35 }}
                      >
                        <circle
                          cx="120"
                          cy="120"
                          r="110"
                          fill="none"
                          stroke="rgba(255,255,255,0.1)"
                          strokeWidth="4"
                        />
                        <motion.circle
                          cx="120"
                          cy="120"
                          r="110"
                          fill="none"
                          stroke="#A259FF"
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeDasharray={2 * Math.PI * 110}
                          animate={{
                            strokeDashoffset: [0, 2 * Math.PI * 110],
                          }}
                          transition={{
                            duration: 4,
                            ease: "linear",
                          }}
                          transform="rotate(-90 120 120)"
                        />
                      </svg>

                      {/* Number + text centered inside ring */}
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={match.countdown}
                          initial={{ scale: 0.3, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 2, opacity: 0 }}
                          transition={{
                            enter: {
                              type: "spring",
                              damping: 12,
                              stiffness: 200,
                            },
                            exit: {
                              duration: 0.35,
                              ease: "easeOut",
                            },
                          }}
                          className="flex flex-col items-center justify-center"
                        >
                          <motion.span
                            className="text-[40px] sm:text-[80px]"
                            style={{
                              fontSize: match.countdown === 1 ? undefined : undefined,
                              fontWeight: 700,
                              lineHeight: 1,
                              letterSpacing: "-2px",
                              background: match.countdown === 1
                                ? "linear-gradient(135deg, #0ACF83, #1ABCFE)"
                                : "linear-gradient(135deg, #A259FF, #F24E1E)",
                              WebkitBackgroundClip: "text",
                              WebkitTextFillColor: "transparent",
                              filter: "drop-shadow(0 0 40px rgba(162,89,255,0.4))",
                            }}
                          >
                            {match.countdownLabel}
                          </motion.span>
                          {match.countdown > 1 && (
                            <motion.span
                              initial={{ opacity: 0, y: 3 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: 0.1 }}
                              className="text-2xs sm:text-sm"
                              style={{
                                color: "rgba(255,255,255,0.4)",
                                letterSpacing: "3px",
                                textTransform: "uppercase",
                                marginTop: "4px",
                              }}
                            >
                              Get ready
                            </motion.span>
                          )}
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Mobile player info — compact strip */}
            <div className="lg:hidden mt-2 sm:mt-4 flex items-center justify-center gap-2 sm:gap-4">
              {/* Player 1 (Red) */}
              <div
                className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl"
                style={{
                  background: match.currentPlayer === "red" && !match.winner
                    ? "rgba(242,78,30,0.1)"
                    : g.surfaceSubtle,
                  border: match.currentPlayer === "red" && !match.winner
                    ? "1px solid rgba(242,78,30,0.3)"
                    : `1px solid ${g.borderSubtle}`,
                  transition: "all 0.3s",
                }}
              >
                <div
                  className="w-5 h-5 sm:w-6 sm:h-6 rounded-full flex-shrink-0"
                  style={{
                    background: DEFAULT_PALETTE.red.bg,
                    border: `2px solid ${DEFAULT_PALETTE.red.highlight}`,
                    outline: `2px solid ${DEFAULT_PALETTE.red.border}`,
                    outlineOffset: '-1px',
                    boxShadow: match.currentPlayer === "red" && !match.winner
                      ? "0 0 10px rgba(242,78,30,0.3), inset 0 1px 3px rgba(255,255,255,0.4)"
                      : "inset 0 1px 3px rgba(255,255,255,0.4)",
                  }}
                />
                <span className="hidden sm:inline" style={{
                  color: match.currentPlayer === "red" && !match.winner ? "#F24E1E" : g.textFaint,
                  fontSize: "var(--text-sm)",
                  maxWidth: "80px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {player1Name}
                </span>
                <span className="text-sm font-semibold tabular-nums" style={{ color: "#F24E1E" }}>
                  {score.red}
                </span>
              </div>

              {/* Score divider + draws */}
              <div className="flex items-center gap-2 text-sm text-g-text-dim">
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{score.draws}</span>
              </div>

              {/* Player 2 (Yellow) */}
              <div
                className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl"
                style={{
                  background: match.currentPlayer === "yellow" && !match.winner
                    ? "rgba(255,191,0,0.1)"
                    : g.surfaceSubtle,
                  border: match.currentPlayer === "yellow" && !match.winner
                    ? "1px solid rgba(255,191,0,0.3)"
                    : `1px solid ${g.borderSubtle}`,
                  transition: "all 0.3s",
                }}
              >
                <div
                  className="w-5 h-5 sm:w-6 sm:h-6 rounded-full flex-shrink-0"
                  style={{
                    background: DEFAULT_PALETTE.yellow.bg,
                    border: `2px solid ${DEFAULT_PALETTE.yellow.highlight}`,
                    outline: `2px solid ${DEFAULT_PALETTE.yellow.border}`,
                    outlineOffset: '-1px',
                    boxShadow: match.currentPlayer === "yellow" && !match.winner
                      ? "0 0 10px rgba(255,191,0,0.3), inset 0 1px 3px rgba(255,255,255,0.4)"
                      : "inset 0 1px 3px rgba(255,255,255,0.4)",
                  }}
                />
                <span className="hidden sm:inline" style={{
                  color: match.currentPlayer === "yellow" && !match.winner ? g.yellow : g.textFaint,
                  fontSize: "var(--text-sm)",
                  maxWidth: "80px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {player2Name}
                </span>
                <span className="text-base tabular-nums" style={{ color: g.yellow }}>{score.yellow}</span>
              </div>
            </div>
          </div>

          {/* Right Player Card — desktop */}
          <div className="hidden lg:block flex-shrink-0">
            <PlayerCard
              color="yellow"
              isActive={match.currentPlayer === "yellow" && !match.winner}
              hasBlastToken={match.yellowBlastToken}
              label={player2Name}
              winner={match.winner}
              wins={score.yellow}
              timer={match.timer}
              timerDuration={match.timerDuration}
              timerEnabled={match.timerEnabled}
              tokenConfig={p2Token}
              onEditToken={gameMode !== "online" || match.myColor === "yellow" ? () => setTokenEditPlayer("yellow") : undefined}
              onToggleBlast={match.currentPlayer === "yellow" && !match.winner ? match.toggleBlast : undefined}
              blastMode={match.blastMode && match.currentPlayer === "yellow"}
            />
          </div>
        </div>
      </div>

      {/* Footer — hidden on very small screens */}
      <div className="relative z-10 flex-shrink-0 hidden sm:flex items-center justify-center px-3 sm:px-6 pb-2 sm:pb-3">
        {/* Powered by Figma Make */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="hidden sm:inline text-xs" style={{ color: g.textGhost, letterSpacing: "0.3px" }}>
            Powered by
          </span>
          <FigmaLogo size={13} />
          <span className="text-xs font-semibold" style={{ color: g.textDim, letterSpacing: "0.3px" }}>
            Figma Make
          </span>
        </div>
      </div>

      {/* Rematch bar — visible when game is over but winner overlay is dismissed */}
      <AnimatePresence>
        {match.winner && !match.showWinnerOverlay && match.countdown <= 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ type: "spring", damping: 20, stiffness: 200, delay: 0.5 }}
            className="fixed bottom-16 sm:bottom-14 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3"
          >
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={match.reset}
              className="px-6 py-3 rounded-2xl cursor-pointer flex items-center gap-2 text-base font-semibold tracking-[0.5px] border-none"
              style={{
                background: match.winner === "red" ? "#F24E1E" : match.winner === "yellow" ? "#FFBF00" : "#A259FF",
                color: match.winner === "yellow" ? "#1E1E1E" : "white",
                boxShadow: `0 4px 24px ${match.winner === "red" ? "rgba(242,78,30,0.4)" : match.winner === "yellow" ? "rgba(255,191,0,0.4)" : "rgba(162,89,255,0.4)"}, 0 8px 32px ${g.shadowMd}`,
              }}
            >
              <RotateCcw size={16} />
              Rematch
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => match.setShowWinnerOverlay(true)}
              className="px-4 py-3 rounded-2xl cursor-pointer flex items-center gap-2 text-sm"
              style={{
                background: g.surfaceHover,
                color: g.textSecondary,
                border: `1px solid ${g.borderStrong}`,
                boxShadow: `0 8px 32px ${g.shadowMd}`,
              }}
            >
              Results
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Winner Overlay — delayed so players can see the connect-4 line */}
      <WinnerOverlay
        winner={match.showWinnerOverlay ? match.winner : null}
        onPlayAgain={match.reset}
        onExit={onExit}
        onClose={() => match.setShowWinnerOverlay(false)}
        onLeaderboard={() => { match.setShowWinnerOverlay(false); setLeaderboardOpen(true); }}
        score={score}
        p1Label={player1Name}
        p2Label={player2Name}
        gameMode={gameMode}
        difficulty={difficulty}
        onDifficultyChange={onDifficultyChange}
      />

      {/* Online Room interruption / no contest — above everything, input is paused */}
      <RoomStatusOverlay notice={roomNotice} onExit={onExit} />

      {/* Spotify Player — hidden on mobile for performance */}
      {!isMobile && (
        <SpotifyPlayer
          spotifyToken={spotifyToken}
          sdk={spotifySDK}
          volume={spotifyVolume}
          onVolumeChange={handleVolumeChange}
        />
      )}

      {/* Desktop hand-tracking + camera control — lazy-loaded so mobile never
          downloads useHandTracking.ts, CameraControl.tsx, or MediaPipe. */}
      {!isMobile && (
        <Suspense fallback={null}>
          <LazyDesktopHandTracking
            onStateSync={setHandTracking}
            blastMode={match.blastMode}
            currentPlayer={match.currentPlayer}
            soundEnabled={soundEnabled}
            onDrop={match.drop}
            onAutoBlast={match.autoBlast}
            onRematch={match.reset}
            disabled={match.inputDisabled}
            winner={match.winner}
            board={match.board}
            hasBlastToken={match.hasBlastToken}
          />
        </Suspense>
      )}

      {/* Leaderboard Drawer */}
      <LeaderboardDrawer
        isOpen={leaderboardOpen}
        onClose={() => setLeaderboardOpen(false)}
        currentPlayerName={player1Name}
      />

      {/* Token Customizer */}
      {tokenEditPlayer && (
        <TokenCustomizer
          isOpen={true}
          onClose={() => setTokenEditPlayer(null)}
          playerColor={tokenEditPlayer}
          playerName={tokenEditPlayer === "red" ? player1Name : player2Name}
          currentConfig={(tokenEditPlayer === "red" ? p1Token : p2Token) || { type: "default" }}
          onSave={(config) => {
            if (tokenEditPlayer === "red" && onP1TokenChange) {
              onP1TokenChange(config);
            } else if (tokenEditPlayer === "yellow" && onP2TokenChange) {
              onP2TokenChange(config);
            }
            setTokenEditPlayer(null);
          }}
        />
      )}
    </div>
  );
}
