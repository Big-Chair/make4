import { motion, AnimatePresence } from "motion/react";
import { Timer, Zap, Bot, RotateCcw, TimerOff, ChevronDown, Wifi, Activity, AlertTriangle } from "lucide-react";
import { ArrowRightIcon, type ArrowRightIconHandle } from "../../imports/arrow-right-icon";
import { PencilIcon, type PencilIconHandle } from "../../imports/pencil-icon";
import { FigmaLogo, FigmaCursor, GridDots, DiamondShape, CrossShape } from "./FigmaDecorations";
import { useState, useRef } from "react";
import { Difficulty } from "./connect4AI";
import type { Scoreboard } from "../App";
import type { PlayerStats } from "./api";
import type { SiteStats } from "./api";
import { Leaderboard } from "./Leaderboard";
import Make4Logo from "../../imports/Make4Logo";
import { TrophyIcon } from "../../imports/trophy-icon";
import { HandRaisedIcon, type HandRaisedIconHandle } from "../../imports/hand-raised-icon";
import { UserIcon, type UserIconHandle } from "../../imports/user-icon";
import { UsersIcon, type UsersIconHandle } from "../../imports/users-icon";
import { SpeakerWaveIcon, type SpeakerWaveIconHandle } from "../../imports/speaker-wave-icon";
import { SpeakerXMarkIcon, type SpeakerXMarkIconHandle } from "../../imports/speaker-x-mark-icon";
import { TokenCustomizer } from "./TokenCustomizer";
import { type TokenConfig, DEFAULT_TOKEN_RED, DEFAULT_TOKEN_YELLOW, getTokenVisuals, getSlotToken, save as saveToken } from "./tokens";
import { g } from "./ThemeContext";

export type GameMode = "local" | "bot" | "online";

interface StartScreenProps {
  onStart: (mode: GameMode, difficulty?: Difficulty, player1?: string, player2?: string, timerDuration?: number, soundEnabled?: boolean, p1Token?: TokenConfig, p2Token?: TokenConfig) => void;
  score: Scoreboard;
  onResetScore: () => void;
  leaderboard: PlayerStats[];
  leaderboardLoading: boolean;
  currentPlayerData?: { player: PlayerStats; rank: number } | null;
  siteStats?: SiteStats | null;
  leaderboardTokenConfigs?: Record<string, any>;
  onLeaderboardLevelChange?: (level: string) => void;
}

export function StartScreen({ onStart, score, onResetScore, leaderboard, leaderboardLoading, currentPlayerData, siteStats, leaderboardTokenConfigs, onLeaderboardLevelChange }: StartScreenProps) {
  const [showNameEntry, setShowNameEntry] = useState<"local" | "bot" | null>(null);
  const [pendingDifficulty, setPendingDifficulty] = useState<Difficulty>("easy");
  const [p1Name, setP1Name] = useState(() => {
    try { return localStorage.getItem("make4_p1Name") || ""; } catch { return ""; }
  });
  const [p2Name, setP2Name] = useState(() => {
    try { return localStorage.getItem("make4_p2Name") || ""; } catch { return ""; }
  });
  const [timerMode, setTimerMode] = useState<0 | 40>(40); // 0 = no timer, 40 = 40s
  const [soundOn, setSoundOn] = useState(true);
  const [showControls, setShowControls] = useState(false);
  const hasScore = score.red > 0 || score.yellow > 0 || score.draws > 0;

  // Token customization state
  const [p1Token, setP1Token] = useState<TokenConfig>(() => getSlotToken("p1") ?? DEFAULT_TOKEN_RED);
  const [p2Token, setP2Token] = useState<TokenConfig>(() => getSlotToken("p2") ?? DEFAULT_TOKEN_YELLOW);
  const [customizingToken, setCustomizingToken] = useState<"p1" | "p2" | null>(null);

  // Leaderboard level filter
  const [leaderboardLevel, setLeaderboardLevel] = useState("");
  const LEVEL_TABS = [
    { key: "", label: "All" },
    { key: "40", label: "Easy", sub: "40s" },
    { key: "35", label: "Medium", sub: "35s" },
    { key: "30", label: "Hard", sub: "30s" },
  ];

  // Refs for animated icons (so parent button hover triggers the animation)
  const howToPlayIconRef = useRef<HandRaisedIconHandle>(null);
  const soundWaveRef = useRef<SpeakerWaveIconHandle>(null);
  const soundXRef = useRef<SpeakerXMarkIconHandle>(null);
  const arrowRightRef = useRef<ArrowRightIconHandle>(null);
  const userIconRef = useRef<UserIconHandle>(null);
  const usersIconRef = useRef<UsersIconHandle>(null);
  const p1PencilRef = useRef<PencilIconHandle>(null);
  const p2PencilRef = useRef<PencilIconHandle>(null);

  const handleModeClick = (mode: "local") => {
    setShowNameEntry(mode);
  };

  const handleBotDifficultyClick = (diff: Difficulty) => {
    setPendingDifficulty(diff);
    setShowNameEntry("bot");
  };

  const handlePlay = () => {
    const name1 = p1Name.trim() || "Player 1";
    const name2 = showNameEntry === "bot" ? `Bot (${pendingDifficulty})` : (p2Name.trim() || "Player 2");
    // Per-difficulty timer: Hard=30s, Medium=35s, Easy/Local=40s
    const DIFFICULTY_TIMER: Record<string, number> = { easy: 40, medium: 35, hard: 30 };
    const effectiveTimer = timerMode === 0
      ? 0
      : showNameEntry === "bot"
        ? (DIFFICULTY_TIMER[pendingDifficulty] ?? 40)
        : 40;
    onStart(
      showNameEntry === "bot" ? "bot" : "local",
      showNameEntry === "bot" ? pendingDifficulty : undefined,
      name1,
      name2,
      effectiveTimer,
      soundOn,
      p1Token,
      p2Token
    );
    setShowNameEntry(null);
    localStorage.setItem("make4_p1Name", name1);
    // Only persist the human-typed name — don't save bot labels like "Bot (easy)"
    if (showNameEntry !== "bot") {
      localStorage.setItem("make4_p2Name", p2Name.trim());
    }
    // Persist per-slot + per-name locally (server sync happens on customizer save)
    saveToken(name1, p1Token, { slot: "p1", toServer: false });
    saveToken(name2, p2Token, { slot: "p2", toServer: false });
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center relative overflow-hidden py-6 sm:py-8 bg-g-bg">
      {/* Background grid */}
      <div
        className="absolute inset-0"
        style={{
          opacity: "var(--g-grid-opacity)",
          backgroundImage: `linear-gradient(var(--g-grid-dot) 1px, transparent 1px),
                            linear-gradient(90deg, var(--g-grid-dot) 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
        }}
      />

      {/* Floating decorations */}
      <motion.div
        animate={{ y: [0, -15, 0], rotate: [0, 5, 0] }}
        transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
        className="absolute top-[10%] left-[8%] hidden md:block"
      >
        <GridDots />
      </motion.div>
      <motion.div
        animate={{ y: [0, 10, 0] }}
        transition={{ repeat: Infinity, duration: 5, delay: 1 }}
        className="absolute top-[20%] right-[10%] hidden md:block"
      >
        <DiamondShape color="#F24E1E" />
      </motion.div>
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ repeat: Infinity, duration: 4, delay: 0.5 }}
        className="absolute bottom-[15%] left-[12%] hidden md:block"
      >
        <DiamondShape color="#1ABCFE" />
      </motion.div>
      <motion.div
        animate={{ rotate: [0, 360] }}
        transition={{ repeat: Infinity, duration: 20, ease: "linear" }}
        className="absolute bottom-[25%] right-[8%] hidden md:block"
      >
        <CrossShape />
      </motion.div>
      <motion.div
        animate={{ y: [0, 12, 0], x: [0, -5, 0] }}
        transition={{ repeat: Infinity, duration: 7 }}
        className="absolute top-[55%] left-[5%] hidden md:block"
      >
        <GridDots />
      </motion.div>

      {/* Figma Cursors */}
      <motion.div
        animate={{ x: [0, 20, 0], y: [0, -10, 0] }}
        transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
        className="absolute top-[30%] left-[20%] hidden lg:block"
      >
        <FigmaCursor color="#F24E1E" />
      </motion.div>
      <motion.div
        animate={{ x: [0, -15, 0], y: [0, 12, 0] }}
        transition={{ repeat: Infinity, duration: 5, delay: 1.5, ease: "easeInOut" }}
        className="absolute top-[40%] right-[18%] hidden lg:block"
      >
        <FigmaCursor color="#FFBF00" />
      </motion.div>

      {/* Glow effects */}
      <div
        className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(31,30,31,1) 0%, rgba(31,30,31,0) 100%)" }}
      />
      <div
        className="absolute bottom-1/4 left-1/3 w-[300px] h-[300px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(31,30,31,1) 0%, rgba(31,30,31,0) 100%)" }}
      />

      {/* Main Content */}
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="relative z-10 text-center px-6 max-w-lg w-full"
      >
        {/* Game pieces animation */}
        <div className="flex items-center justify-center gap-4 mb-8">
          {[
            { player: "red" as const, delay: 0 },
            { player: "yellow" as const, delay: 0.15 },
            { player: "red" as const, delay: 0.3 },
            { player: "yellow" as const, delay: 0.45 },
          ].map((piece, i) => {
            const tokenCfg = piece.player === "red" ? p1Token : p2Token;
            const tv = getTokenVisuals(tokenCfg, piece.player);
            return (
            <motion.div
              key={i}
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: "spring", damping: 10, delay: 0.5 + piece.delay }}
            >
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ repeat: Infinity, duration: 2, delay: piece.delay, ease: "easeInOut" }}
                className="w-12 h-12 sm:w-14 sm:h-14 rounded-full relative overflow-hidden"
                style={{
                  background: tv.bg,
                  border: `3px solid ${tv.highlight}`,
                  outline: `3px solid ${tv.border}`,
                  outlineOffset: '-1px',
                  boxShadow: `0 4px 20px ${tv.glow}40, inset 0 2px 5px rgba(255,255,255,0.4), inset 0 -3px 6px ${tv.dark}`,
                }}
              >
                {tv.imageUrl && (
                  <img src={tv.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover rounded-full pointer-events-none" />
                )}
                {tv.emoji && (
                  <span className="absolute inset-0 flex items-center justify-center pointer-events-none text-xl leading-none" style={{ textShadow: tv.imageUrl ? "0 1px 4px rgba(0,0,0,0.7)" : "none" }}>
                    {tv.emoji}
                  </span>
                )}
              </motion.div>
            </motion.div>
            );
          })}
        </div>

        {/* Make 4 Logo */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="flex justify-center mb-3"
        >
          <div className="w-[clamp(180px,45vw,280px)] aspect-[208.586/48.7687]">
            <Make4Logo />
          </div>
        </motion.div>

        {/* Subtitle: Connect (strikethrough) Make 4 */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-1 mb-6 flex items-center justify-center gap-2 text-sm text-g-text-faint tracking-[3px] uppercase"
        >
          A Spatial Evolution of Connect 4
        </motion.p>

        {/* ─── Section Divider: Hero → About ─── */}
        <motion.div
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ delay: 0.55, duration: 0.5 }}
          className="mx-auto mb-8 divider-fade"
        />

        {/* ─── About Section ─── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mb-10 text-g-text-muted leading-[1.7] text-base"
        >
          <p>
            Drop pieces to connect four in a row — win with Make 4! Each player gets one
            <span className="text-figma-purple"> Blast Token </span>
            — click any piece to destroy it!
          </p>

          {/* Collapsible Controls */}
          <button
            onClick={() => setShowControls(!showControls)}
            onMouseEnter={() => howToPlayIconRef.current?.startAnimation()}
            onMouseLeave={() => howToPlayIconRef.current?.stopAnimation()}
            className="mt-3 mx-auto flex items-center gap-2 cursor-pointer px-4 py-2 rounded-lg transition-all text-base font-medium text-g-text-secondary"
            style={{
              background: showControls ? g.surfaceHover : g.surface,
              border: `1px solid ${g.borderHover}`,
            }}
          >
            <HandRaisedIcon ref={howToPlayIconRef} size={15} color={g.textMuted} strokeWidth={2} />
            How to play
            <motion.div
              animate={{ rotate: showControls ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown size={15} color={g.textMuted} />
            </motion.div>
          </button>

          <AnimatePresence>
            {showControls && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div
                  className="mt-3 rounded-xl text-left flex flex-col gap-4 px-5 py-5 bg-g-surface border border-g-border-strong"
                >
                  {/* Mouse */}
                  <div className="flex items-start gap-3">
                    <span className="text-xl leading-[1.2]">🖱️</span>
                    <div>
                      <strong className="text-g-text-bright text-base">Mouse</strong>
                      <p className="text-g-text-muted text-sm mt-[3px] leading-[1.6]">
                        Click a column to drop a piece. In blast mode, click any piece to destroy it and its neighbors.
                      </p>
                    </div>
                  </div>

                  <div className="h-px bg-g-border" />

                  {/* Keyboard */}
                  <div className="flex items-start gap-3">
                    <span className="text-xl leading-[1.2]">⌨️</span>
                    <div>
                      <strong className="text-g-text-bright text-base">Keyboard</strong>
                      <p className="text-g-text-muted text-sm mt-[3px] leading-[1.6]">
                        Arrow keys or <kbd className="kbd-key">1</kbd>–<kbd className="kbd-key">7</kbd> to select column, <kbd className="kbd-key">Enter</kbd> to drop. Press <kbd className="kbd-key" style={{ background: "rgba(162,89,255,0.25)", color: "#B77DFF" }}>0</kbd> for blast mode, then <kbd className="kbd-key">WASD</kbd> to navigate and <kbd className="kbd-key">Enter</kbd> to fire.
                      </p>
                    </div>
                  </div>

                  <div className="h-px bg-g-border" />

                  {/* Camera */}
                  <div className="flex items-start gap-3">
                    <span className="text-xl leading-[1.2]">📷</span>
                    <div>
                      <strong className="text-g-text-bright text-base">Camera (Hand Gestures)</strong>
                      <p className="text-g-text-muted text-sm mt-[3px] leading-[1.6]">
                        ☝️ Point to select a column · Push down to drop · ✊ Closed fist to auto-blast the best target · 👍 Thumbs up to rematch
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ── Section Divider: About → Play ─── */}
        <motion.div
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ delay: 0.65, duration: 0.5 }}
          className="mx-auto mb-8 divider-fade"
        />

        {/* ─── Play Section ─── */}
        <p className="mb-4 label-caps">
          Choose Mode
        </p>

        {/* Name entry modal overlay */}
        <AnimatePresence>
          {showNameEntry && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="mb-6 rounded-2xl p-5 text-left bg-g-surface-faint border border-g-border backdrop-blur-[10px]"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="label-caps" style={{ letterSpacing: "1.5px", color: g.textMuted }}>
                  {showNameEntry === "bot" ? "Enter your name" : "Enter player names"}
                </span>
                <button
                  onClick={() => setShowNameEntry(null)}
                  className="cursor-pointer text-xs px-2 py-1 rounded-lg text-g-text-faint bg-g-surface-subtle"
                >
                  Cancel
                </button>
              </div>

              <div className="flex flex-col gap-3">
                {/* Player 1 input */}
                <div className="flex items-center gap-3">
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setCustomizingToken("p1")}
                    onMouseEnter={() => p1PencilRef.current?.startAnimation()}
                    onMouseLeave={() => p1PencilRef.current?.stopAnimation()}
                    className="w-8 h-8 rounded-full flex-shrink-0 relative overflow-hidden cursor-pointer group"
                    style={{
                      background: getTokenVisuals(p1Token, "red").bg,
                      border: `2px solid ${getTokenVisuals(p1Token, "red").highlight}`,
                    }}
                    title="Customize token"
                  >
                    {p1Token.type === "image" && p1Token.imageUrl && (
                      <img src={p1Token.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover rounded-full" />
                    )}
                    {p1Token.emoji && (
                      <span className="absolute inset-0 flex items-center justify-center text-sm" style={{ textShadow: p1Token.type === "image" ? "0 1px 3px rgba(0,0,0,0.7)" : "none" }}>{p1Token.emoji}</span>
                    )}
                    <div className="absolute inset-0 rounded-full flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-all">
                      <PencilIcon ref={p1PencilRef} size={10} color="white" strokeWidth={2} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </motion.button>
                  <input
                    type="text"
                    placeholder={showNameEntry === "bot" ? "Your name" : "Player 1 name"}
                    value={p1Name}
                    onChange={(e) => setP1Name(e.target.value)}
                    maxLength={20}
                    onKeyDown={(e) => e.key === "Enter" && handlePlay()}
                    className="flex-1 rounded-xl px-4 py-2.5 outline-none bg-g-input-bg text-g-input-text text-base border border-figma-red/25"
                  />
                </div>

                {/* Player 2 input (only in local mode) */}
                {showNameEntry === "local" && (
                  <div className="flex items-center gap-3">
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setCustomizingToken("p2")}
                      onMouseEnter={() => p2PencilRef.current?.startAnimation()}
                      onMouseLeave={() => p2PencilRef.current?.stopAnimation()}
                      className="w-8 h-8 rounded-full flex-shrink-0 relative overflow-hidden cursor-pointer group"
                      style={{
                        background: getTokenVisuals(p2Token, "yellow").bg,
                        border: `2px solid ${getTokenVisuals(p2Token, "yellow").highlight}`,
                      }}
                      title="Customize token"
                    >
                      {p2Token.type === "image" && p2Token.imageUrl && (
                        <img src={p2Token.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover rounded-full" />
                      )}
                      {p2Token.emoji && (
                        <span className="absolute inset-0 flex items-center justify-center text-sm" style={{ textShadow: p2Token.type === "image" ? "0 1px 3px rgba(0,0,0,0.7)" : "none" }}>{p2Token.emoji}</span>
                      )}
                      <div className="absolute inset-0 rounded-full flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-all">
                        <PencilIcon ref={p2PencilRef} size={10} color="white" strokeWidth={2} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </motion.button>
                    <input
                      type="text"
                      placeholder="Player 2 name"
                      value={p2Name}
                      onChange={(e) => setP2Name(e.target.value)}
                      maxLength={20}
                      onKeyDown={(e) => e.key === "Enter" && handlePlay()}
                      className="flex-1 rounded-xl px-4 py-2.5 outline-none bg-g-input-bg text-g-input-text text-base border border-figma-yellow/25"
                    />
                  </div>
                )}

                {showNameEntry === "bot" && (
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center bg-figma-green/15 border-2 border-figma-green/40">
                      <Bot size={14} className="text-figma-green" />
                    </div>
                    <div className="flex-1 rounded-xl overflow-hidden flex bg-g-surface-subtle border border-g-border-light">
                      {([
                        { label: "Easy", value: "easy" as Difficulty, color: "#0ACF83" },
                        { label: "Medium", value: "medium" as Difficulty, color: "#1ABCFE" },
                        { label: "Hard", value: "hard" as Difficulty, color: "#F24E1E" },
                      ]).map((d, i) => (
                        <button
                          key={d.value}
                          onClick={() => setPendingDifficulty(d.value)}
                          className="flex-1 py-2.5 cursor-pointer text-center transition-all relative text-sm"
                          style={{
                            background: pendingDifficulty === d.value ? `${d.color}18` : "transparent",
                            color: pendingDifficulty === d.value ? d.color : g.textFaint,
                            fontWeight: pendingDifficulty === d.value ? 600 : 400,
                            borderRight: i < 2 ? `1px solid ${g.borderSubtle}` : "none",
                            borderBottom: pendingDifficulty === d.value ? `2px solid ${d.color}` : "2px solid transparent",
                          }}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Timer & Sound Settings */}
                <div className="flex items-center gap-3 rounded-xl px-4 py-3 mt-1 bg-g-surface-subtle border border-g-border-light">
                  {/* Timer toggle */}
                  <div className="flex-1 flex items-center gap-2.5">
                    <Timer size={18} color={timerMode === 40 ? "#1ABCFE" : g.textDim} />
                    <span className="text-base font-medium transition-colors duration-200" style={{ color: timerMode === 40 ? g.textSecondary : g.textFaint }}>
                      {timerMode === 40
                        ? showNameEntry === "bot"
                          ? `${({ easy: 40, medium: 35, hard: 30 } as Record<string, number>)[pendingDifficulty] ?? 40}s Timer`
                          : "40s Timer"
                        : "No Timer"}
                    </span>
                    <button
                      onClick={() => setTimerMode(timerMode === 40 ? 0 : 40)}
                      className="ml-auto relative cursor-pointer flex items-center"
                      style={{
                        width: "44px",
                        height: "24px",
                        borderRadius: "12px",
                        background: timerMode === 40
                          ? "rgba(26,188,254,0.3)"
                          : g.surfaceHover,
                        border: timerMode === 40
                          ? "1px solid rgba(26,188,254,0.4)"
                          : `1px solid ${g.borderLight}`,
                        transition: "all 0.25s ease",
                        padding: 0,
                      }}
                      aria-label="Toggle timer"
                    >
                      <div
                        style={{
                          width: "18px",
                          height: "18px",
                          borderRadius: "50%",
                          background: timerMode === 40 ? "#1ABCFE" : g.textFaint,
                          boxShadow: timerMode === 40 ? "0 0 8px rgba(26,188,254,0.5)" : "none",
                          marginLeft: timerMode === 40 ? "23px" : "3px",
                          transition: "all 0.25s ease",
                        }}
                      />
                    </button>
                  </div>

                  {/* Divider */}
                  <div className="divider-v h-6" />

                  {/* Sound toggle */}
                  <button
                    onClick={() => setSoundOn(!soundOn)}
                    onMouseEnter={() => {
                      soundWaveRef.current?.startAnimation();
                      soundXRef.current?.startAnimation();
                    }}
                    onMouseLeave={() => {
                      soundWaveRef.current?.stopAnimation();
                      soundXRef.current?.stopAnimation();
                    }}
                    className="cursor-pointer flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all"
                    style={{
                      background: soundOn ? "rgba(10,207,131,0.1)" : g.surfaceFaint,
                      border: soundOn ? "1px solid rgba(10,207,131,0.25)" : `1px solid ${g.borderLight}`,
                    }}
                  >
                    {soundOn ? (
                      <SpeakerWaveIcon ref={soundWaveRef} size={14} color="#0ACF83" />
                    ) : (
                      <SpeakerXMarkIcon ref={soundXRef} size={14} color={g.textDim} />
                    )}
                    <span className="text-sm" style={{ color: soundOn ? "#0ACF83" : g.textFaint }}>
                      {soundOn ? "On" : "Off"}
                    </span>
                  </button>
                </div>

                {/* Leaderboard eligibility note */}
                {timerMode === 40 && (
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <TrophyIcon size={11} color={g.yellow} />
                    <span className="text-sm text-g-yellow-muted">
                      Wins count toward the leaderboard
                      {showNameEntry === "bot" && pendingDifficulty !== "easy" && (
                        <span className="text-g-text-faint">
                          {" "}· {pendingDifficulty === "hard" ? "30s" : "35s"} turn limit
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {timerMode === 0 && (
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <TimerOff size={11} color={g.textDim} />
                    <span className="text-sm text-g-text-dim">
                      Casual mode — not tracked on leaderboard
                    </span>
                  </div>
                )}

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handlePlay}
                  onMouseEnter={() => arrowRightRef.current?.startAnimation()}
                  onMouseLeave={() => arrowRightRef.current?.stopAnimation()}
                  className="mt-1 w-full py-3 rounded-xl cursor-pointer flex items-center justify-center gap-2 text-white text-base border-none"
                  style={{
                    background: showNameEntry === "bot"
                      ? "linear-gradient(135deg, #0ACF83, #07A868)"
                      : "linear-gradient(135deg, #A259FF, #7C3AED)",
                    boxShadow: showNameEntry === "bot"
                      ? "0 4px 20px rgba(10,207,131,0.3)"
                      : "0 4px 20px rgba(162,89,255,0.3)",
                  }}
                >
                  Start Game
                  <ArrowRightIcon ref={arrowRightRef} size={16} />
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mode buttons (hidden when name entry is showing) */}
        {!showNameEntry && (
          <>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-3"
            >
              {/* vs Bot — opens difficulty modal */}
              <motion.button
                whileHover={{ scale: 1.03, y: -2 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setShowNameEntry("bot")}
                onMouseEnter={() => userIconRef.current?.startAnimation()}
                onMouseLeave={() => userIconRef.current?.stopAnimation()}
                className="group px-8 py-4 rounded-2xl cursor-pointer flex items-center justify-center gap-3 w-full sm:w-56 text-base text-white tracking-[0.5px] border-none"
                style={{
                  background: "linear-gradient(135deg, #0ACF83, #07A868)",
                  boxShadow: "0 4px 30px rgba(10,207,131,0.3), 0 0 0 1px rgba(10,207,131,0.4)",
                }}
              >
                <UserIcon ref={userIconRef} size={18} strokeWidth={2} />
                Human vs Bot
              </motion.button>

              {/* 2 Players — secondary */}
              <motion.button
                whileHover={{ scale: 1.03, y: -2 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => handleModeClick("local")}
                onMouseEnter={() => usersIconRef.current?.startAnimation()}
                onMouseLeave={() => usersIconRef.current?.stopAnimation()}
                className="group px-8 py-4 rounded-2xl cursor-pointer flex items-center justify-center gap-3 w-full sm:w-56 text-base text-g-text tracking-[0.5px] border-none transition-[background,box-shadow] duration-200 bg-g-surface"
                style={{
                  boxShadow: `0 0 0 1px ${g.border}`,
                }}
              >
                <UsersIcon ref={usersIconRef} size={18} strokeWidth={2} />
                2 Players
              </motion.button>
            </motion.div>

            {/* Online Play button */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 }}
              className="flex flex-col items-center mt-3 gap-3"
            >
              {/* OR REMOTE DUEL divider */}
              <div className="flex items-center justify-center w-full sm:w-[calc(28rem+0.75rem)] mt-4 mb-2">
                <span className="label-caps whitespace-nowrap">
                  Or Remote Duel
                </span>
              </div>

              <motion.button
                whileHover={{ scale: 1.03, y: -2 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => onStart("online")}
                className="group px-8 py-4 rounded-2xl cursor-pointer flex items-center justify-center gap-3 w-full sm:w-[calc(28rem+0.75rem)] text-base text-g-text-muted tracking-[0.5px] border-none bg-transparent"
                style={{
                  boxShadow: `0 0 0 1px ${g.borderStrong}`,
                }}
              >
                <Wifi size={18} className="text-figma-blue" />
                Invite & Play
                <span className="text-xs text-figma-blue/70 bg-figma-blue/15 py-0.5 px-2 rounded-lg ml-1">
                  NEW
                </span>
              </motion.button>
            </motion.div>
          </>
        )}

        {/* ─── Section Divider: Play → Features ─── */}
        <motion.div
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ delay: 0.85, duration: 0.5 }}
          className="mx-auto mt-10 mb-8 divider-fade"
        />

        {/* ─── Game Features Section ─── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
        >
          <p className="mb-4 label-caps">
            Game Features
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {[
              { icon: Bot, label: "vs Bot AI", color: "#0ACF83" },
              { icon: UsersIcon, label: "2 Players", color: "#A259FF" },
              { icon: Timer, label: "40s Timer", color: "#1ABCFE" },
              { icon: Zap, label: "Blast Token", color: "#F24E1E" },
              { icon: TrophyIcon, label: "Leaderboard", color: g.yellow },
              { icon: HandRaisedIcon, label: "Hand Gestures", color: "#FF7262" },
              { icon: Wifi, label: "Invite & Play", color: "#1ABCFE" },
            ].map((feature) => (
              <div
                key={feature.label}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-g-surface-faint border border-g-border-light"
              >
                <feature.icon size={14} color={feature.color} />
                <span className="text-g-text-muted text-sm">{feature.label}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* ─── Section Divider: Features → Stats ─── */}
        <motion.div
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ delay: 0.95, duration: 0.5 }}
          className="mx-auto mt-10 mb-8 divider-fade"
        />

        {/* Session Scoreboard */}
        {hasScore && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1 }}
            className="mt-6"
          >
            <div className="rounded-2xl px-6 py-4 flex items-center gap-5 bg-g-surface-subtle border border-g-border-light">
              <span className="label-caps">
                Session
              </span>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-figma-red" />
                  <span className="text-figma-red text-base tabular-nums">{score.red}</span>
                </div>

                <div className="divider-v h-5" />

                <span className="text-g-text-faint text-sm tabular-nums">{score.draws}</span>

                <div className="divider-v h-5" />

                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-figma-yellow" />
                  <span className="text-g-yellow text-base tabular-nums">{score.yellow}</span>
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.1, rotate: -15 }}
                whileTap={{ scale: 0.9 }}
                onClick={onResetScore}
                className="ml-1 w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer bg-g-surface-subtle border border-g-border"
              >
                <RotateCcw size={12} color={g.textFaint} />
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* Leaderboard */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1 }}
          className="mt-6 relative"
        >
          {/* Glow behind leaderboard */}
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full pointer-events-none"
            style={{ background: "radial-gradient(circle, rgba(31,30,31,1) 0%, rgba(31,30,31,0) 100%)", zIndex: -1 }}
          />
          <div className="rounded-2xl p-4 text-left bg-g-surface-faint border border-g-border-subtle">
            <div className="flex items-center gap-2 mb-1 px-1">
              <TrophyIcon size={14} color={g.yellow} />
              <span className="label-caps" style={{ color: g.textMuted }}>
                Leaderboard
              </span>
            </div>
            {/* Difficulty filter tabs */}
            <div className="flex items-center gap-1 mb-3 px-1">
              {LEVEL_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setLeaderboardLevel(tab.key);
                    onLeaderboardLevelChange?.(tab.key);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg cursor-pointer transition-colors text-xs font-medium"
                  style={{
                    background: leaderboardLevel === tab.key ? "rgba(162,89,255,0.12)" : "transparent",
                    border: `1px solid ${leaderboardLevel === tab.key ? "rgba(162,89,255,0.3)" : g.borderSubtle}`,
                    color: leaderboardLevel === tab.key ? "#A259FF" : g.textDim,
                  }}
                >
                  {tab.label}
                  {tab.sub && (
                    <span className="text-2xs" style={{ color: leaderboardLevel === tab.key ? "rgba(162,89,255,0.6)" : g.textGhost }}>
                      {tab.sub}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <Leaderboard players={leaderboard} loading={leaderboardLoading} currentPlayerData={currentPlayerData} tokenConfigs={leaderboardTokenConfigs} />
          </div>
        </motion.div>

        {/* ─── Live Stats Ticker ─── */}
        {siteStats && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.2 }}
            className="mt-6"
          >
            <div className="rounded-2xl px-5 py-4 bg-g-surface-faint border border-g-border-subtle">
              <div className="flex items-center gap-2 mb-3">
                <Activity size={13} color={g.textFaint} />
                <span className="label-caps" style={{ color: g.textFaint }}>
                  Live Stats
                </span>
                <div className="w-1.5 h-1.5 rounded-full ml-1 animate-pulse bg-figma-green shadow-[0_0_6px_#0ACF83]" />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="flex flex-col items-center gap-1 py-2 rounded-xl bg-g-surface-subtle">
                  <span className="stat-value text-figma-blue">
                    {siteStats.totalVisits.toLocaleString()}
                  </span>
                  <span className="label-caps-sm">Visits</span>
                </div>
                <div className="flex flex-col items-center gap-1 py-2 rounded-xl bg-g-surface-subtle">
                  <span className="stat-value text-figma-purple">
                    {siteStats.totalGamesPlayed.toLocaleString()}
                  </span>
                  <span className="label-caps-sm">Games Played</span>
                </div>
                <div className="flex flex-col items-center gap-1 py-2 rounded-xl bg-g-surface-subtle">
                  <span className="stat-value text-figma-green">
                    {siteStats.totalPlayers.toLocaleString()}
                  </span>
                  <span className="label-caps-sm">Players</span>
                </div>
                <div className="flex flex-col items-center gap-1 py-2 rounded-xl bg-g-surface-subtle">
                  <span className="stat-value" style={{ color: siteStats.capacityPercent >= 80 ? "#F24E1E" : "#FFBF00" }}>
                    {siteStats.activeRooms}/{siteStats.maxRooms}
                  </span>
                  <span className="label-caps-sm">Active Rooms</span>
                </div>
              </div>

              {/* Capacity alert */}
              {siteStats.capacityPercent >= 80 && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg"
                  style={{
                    background: siteStats.capacityPercent >= 100 ? "rgba(242,78,30,0.1)" : "rgba(255,191,0,0.08)",
                    border: siteStats.capacityPercent >= 100 ? "1px solid rgba(242,78,30,0.3)" : "1px solid rgba(255,191,0,0.2)",
                  }}
                >
                  <AlertTriangle size={13} color={siteStats.capacityPercent >= 100 ? "#F24E1E" : "#FFBF00"} />
                  <span className="text-xs" style={{ color: siteStats.capacityPercent >= 100 ? "#F24E1E" : "#FFBF00" }}>
                    {siteStats.capacityPercent >= 100
                      ? "All rooms are full! Try again shortly — rooms expire after 30 minutes."
                      : "Server getting busy — room slots filling up. Jump in soon!"
                    }
                  </span>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* Powered by Figma Make — bottom footer */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.3, duration: 0.5 }}
        className="relative z-10 mt-10 mb-4 flex flex-col items-center gap-2"
      >
        <div className="divider-fade" style={{ width: "120px" }} />
        <div className="flex items-center gap-2.5 mt-2">
          <span className="text-g-text-dim text-sm tracking-[0.5px]">
            Powered by
          </span>
          <FigmaLogo size={16} />
          <span className="text-g-text-faint text-sm font-semibold tracking-[0.5px]">
            Figma Make
          </span>
        </div>
      </motion.div>

      {/* Token Customizer Modal */}
      <TokenCustomizer
        isOpen={customizingToken !== null}
        onClose={() => setCustomizingToken(null)}
        playerColor={customizingToken === "p2" ? "yellow" : "red"}
        playerName={customizingToken === "p2" ? (p2Name.trim() || "Player 2") : (p1Name.trim() || "Player 1")}
        currentConfig={customizingToken === "p2" ? p2Token : p1Token}
        onSave={(config) => {
          if (customizingToken === "p1") {
            setP1Token(config);
            saveToken(p1Name, config, { slot: "p1" });
          } else {
            setP2Token(config);
            saveToken(p2Name, config, { slot: "p2" });
          }
        }}
      />
    </div>
  );
}