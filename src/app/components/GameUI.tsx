import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { RotateCcw, X, Bomb, Pencil, Home, Loader2 } from "lucide-react";
import type { CellValue } from "./useConnect4";
import { getTokenVisuals, type TokenConfig, defaultTokenFor, DEFAULT_PALETTE } from "./tokens";
import { SpeakerWaveIcon, type SpeakerWaveIconHandle } from "../../imports/speaker-wave-icon";
import { SpeakerXMarkIcon, type SpeakerXMarkIconHandle } from "../../imports/speaker-x-mark-icon";
import { HandRaisedIcon, type HandRaisedIconHandle } from "../../imports/hand-raised-icon";
import { TrophyIcon, type TrophyIconHandle } from "../../imports/trophy-icon";
import Make4Logo from "../../imports/Make4Logo";
import { FigmaLogo } from "./FigmaDecorations";
import { g } from "./ThemeContext";

interface PlayerCardProps {
  color: "red" | "yellow";
  isActive: boolean;
  hasBlastToken: boolean;
  label: string;
  winner: CellValue | "draw";
  wins?: number;
  timer?: number;
  timerDuration?: number;
  timerEnabled?: boolean;
  tokenConfig?: TokenConfig;
  onEditToken?: () => void;
  onToggleBlast?: () => void;
  blastMode?: boolean;
}

export function PlayerCard({ color, isActive, hasBlastToken, label, winner, wins = 0, timer = 0, timerDuration = 40, timerEnabled = false, tokenConfig, onEditToken, onToggleBlast, blastMode }: PlayerCardProps) {
  const isWinner = winner === color;
  const tv = getTokenVisuals(tokenConfig ?? defaultTokenFor(color), color);
  const colors = {
    red: { accent: "#F24E1E", bg: "rgba(242,78,30,0.08)", border: "rgba(242,78,30,0.25)", glow: "rgba(242,78,30,0.15)" },
    yellow: { accent: "#FFBF00", bg: "rgba(255,191,0,0.08)", border: "rgba(255,191,0,0.25)", glow: "rgba(255,191,0,0.15)" },
  };
  const c = colors[color];

  // Progress as 0..1 (1 = full time remaining, 0 = expired)
  const progress = timerEnabled && timerDuration > 0 ? timer / timerDuration : 1;
  const showTimerBorder = isActive && timerEnabled && !winner;
  const isLow = timer <= 10;
  const isUrgent = timer <= 5;

  // Conic gradient for animated border: sweeps clockwise from top
  const progressDeg = progress * 360;
  const borderColor = isUrgent ? "#F24E1E" : isLow ? "#FF8C42" : c.accent;
  const conicBg = showTimerBorder
    ? `conic-gradient(from 0deg at 50% 50%, ${borderColor} 0deg, ${borderColor} ${progressDeg}deg, rgba(255,255,255,0.06) ${progressDeg}deg, rgba(255,255,255,0.06) 360deg)`
    : undefined;

  return (
    <div className="relative min-w-[180px]">
      {/* Animated border layer — sits BEHIND the card, slightly larger to peek out as a border */}
      {showTimerBorder && (
        <motion.div
          className="absolute -inset-[3px] rounded-[19px]"
          animate={isUrgent ? { opacity: [1, 0.4, 1] } : { opacity: 1 }}
          transition={isUrgent ? { repeat: Infinity, duration: 0.5 } : {}}
          style={{
            background: conicBg,
            transition: "background 0.3s linear",
          }}
        />
      )}
      {/* Static border for non-timer states — also behind, slightly larger */}
      {!showTimerBorder && (
        <div
          className="absolute -inset-[2px] rounded-[18px] transition-[background] duration-300"
          style={{ background: isActive ? c.accent : g.borderLight }}
        />
      )}

      {/* Content card — solid fill so the gradient border only shows at edges */}
      <motion.div
        className="rounded-2xl p-4 relative overflow-hidden transition-[background,box-shadow] duration-300"
        style={{
          background: isActive
            ? color === "red" ? "var(--g-card-red)" : "var(--g-card-yellow)"
            : "var(--g-card-inactive)",
          boxShadow: isActive
            ? showTimerBorder && isUrgent
              ? `0 0 30px rgba(242,78,30,0.25), 0 0 60px rgba(242,78,30,0.1)`
              : `0 0 30px ${c.glow}`
            : "none",
        }}
      >
        {/* Active top indicator (non-timer) */}
        {isActive && !showTimerBorder && (
          <motion.div
            className="absolute top-0 left-0 right-0 h-[2px]"
            style={{ background: c.accent }}
            layoutId="active-indicator"
          />
        )}

        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-full flex-shrink-0 relative overflow-hidden group/token cursor-pointer"
            style={{
              background: tv.bg,
              border: `3px solid ${tv.highlight}`,
              outline: `3px solid ${tv.border}`,
              outlineOffset: '-1px',
              boxShadow: isActive
                ? `0 0 16px ${c.glow}, inset 0 2px 5px rgba(255,255,255,0.4), inset 0 -3px 6px ${tv.dark}`
                : `0 2px 8px rgba(0,0,0,0.3), inset 0 2px 5px rgba(255,255,255,0.4), inset 0 -3px 6px ${tv.dark}`,
            }}
            onClick={onEditToken}
          >
            {tokenConfig?.imageUrl && tokenConfig.type === "image" && (
              <img src={tokenConfig.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover rounded-full" />
            )}
            {tokenConfig?.emoji && (
              <span className="absolute inset-0 flex items-center justify-center pointer-events-none text-lg" style={{ textShadow: tokenConfig.type === "image" ? "0 1px 4px rgba(0,0,0,0.7)" : "none" }}>{tokenConfig.emoji}</span>
            )}
            {/* Edit overlay on hover */}
            {onEditToken && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover/token:opacity-100 transition-opacity">
                <Pencil size={14} color="white" />
              </div>
            )}
          </div>
          <div className="flex-1">
            <div className="text-g-text-muted label-caps-sm" style={{ letterSpacing: "2px" }}>
              {label}
            </div>
            <div className="text-base" style={{ color: isActive ? c.accent : g.textSecondary }}>
              {color === "red" ? "Red" : "Yellow"}
              {isWinner && " \u{1F3C6}"}
            </div>
          </div>
          {/* Win count badge */}
          <div
            className="flex flex-col items-center justify-center rounded-lg px-2.5 py-1 min-w-[42px]"
            style={{
              background: wins > 0 ? `${c.accent}15` : g.surfaceSubtle,
              border: `1px solid ${wins > 0 ? `${c.accent}30` : g.borderSubtle}`,
            }}
          >
            <span className="score-num" style={{ color: wins > 0 ? c.accent : g.textDim }}>
              {wins}
            </span>
            <span className="label-caps-sm" style={{ fontSize: "var(--text-2xs)" }}>
              wins
            </span>
          </div>
        </div>

        {/* Timer seconds display when active */}
        {showTimerBorder && (
          <div
            className="flex items-center justify-between rounded-lg px-3 py-1.5 mb-2"
            style={{
              background: isUrgent ? "rgba(242,78,30,0.08)" : g.surfaceSubtle,
              border: `1px solid ${isUrgent ? "rgba(242,78,30,0.2)" : g.borderSubtle}`,
            }}
          >
            <span className="label-caps-sm" style={{ color: g.textFaint, letterSpacing: "1px" }}>
              Time
            </span>
            <motion.span
              animate={isUrgent ? { scale: [1, 1.15, 1] } : {}}
              transition={isUrgent ? { repeat: Infinity, duration: 0.5 } : {}}
              className="text-base font-semibold tabular-nums"
              style={{ color: isUrgent ? "#F24E1E" : isLow ? "#FF8C42" : c.accent }}
            >
              {timer}s
            </motion.span>
          </div>
        )}

        {/* Blast token status */}
        <motion.button
          whileHover={hasBlastToken ? { scale: 1.02 } : {}}
          whileTap={hasBlastToken ? { scale: 0.97 } : {}}
          onClick={hasBlastToken && onToggleBlast ? onToggleBlast : undefined}
          disabled={!hasBlastToken}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 w-full transition-all duration-200 ${hasBlastToken && onToggleBlast ? "cursor-pointer" : "cursor-default"}`}
          style={{
            background: blastMode && hasBlastToken
              ? "rgba(162,89,255,0.15)"
              : hasBlastToken ? "rgba(162,89,255,0.06)" : g.surfaceSubtle,
            border: `1px solid ${blastMode && hasBlastToken
              ? "rgba(162,89,255,0.4)"
              : hasBlastToken ? "rgba(162,89,255,0.15)" : g.borderSubtle}`,
            boxShadow: blastMode && hasBlastToken ? "0 0 12px rgba(162,89,255,0.15)" : "none",
          }}
        >
          <Bomb size={14} color={blastMode && hasBlastToken ? "#A259FF" : hasBlastToken ? "#A259FF" : g.textGhost} />
          <span className="text-xs" style={{ color: blastMode && hasBlastToken ? "#A259FF" : hasBlastToken ? g.textSecondary : g.textDim }}>
            {blastMode && hasBlastToken ? "Pick a target \u2726" : hasBlastToken ? "Blast token ready" : "Token used"}
          </span>
        </motion.button>
      </motion.div>
    </div>
  );
}

interface TimerDisplayProps {
  timer: number;
  timerDuration: number;
  currentPlayer: "red" | "yellow";
  timerEnabled: boolean;
}

export function TimerDisplay({ timer, timerDuration, currentPlayer, timerEnabled }: TimerDisplayProps) {
  if (!timerEnabled) {
    return (
      <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-g-surface-faint border border-g-border-light">
        <span className="text-xs text-g-text-dim">No timer</span>
      </div>
    );
  }

  const isLow = timer <= 10;
  const accent = currentPlayer === "red" ? "#F24E1E" : g.yellow;
  const circumference = 2 * Math.PI * 19; // ~119.38

  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        {/* Compact timer on mobile — just the number */}
        <div className="sm:hidden flex items-center justify-center w-8 h-8 rounded-lg" style={{
          background: isLow ? "rgba(242,78,30,0.1)" : g.surfaceSubtle,
          border: isLow ? "1px solid rgba(242,78,30,0.25)" : `1px solid ${g.borderLight}`,
        }}>
          <motion.span
            animate={isLow ? { scale: [1, 1.1, 1] } : {}}
            transition={isLow ? { repeat: Infinity, duration: 0.5 } : {}}
            className="text-sm font-semibold tabular-nums"
            style={{ color: isLow ? "#F24E1E" : g.textSecondary }}
          >
            {timer}
          </motion.span>
        </div>
        {/* Full ring timer on desktop */}
        <svg className="hidden sm:block" width="44" height="44" viewBox="0 0 44 44">
          <circle cx="22" cy="22" r="19" fill="none" stroke={g.borderSubtle} strokeWidth="3" />
          <motion.circle
            cx="22"
            cy="22"
            r="19"
            fill="none"
            stroke={isLow ? "#F24E1E" : accent}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: 0 }}
            animate={{ strokeDashoffset: circumference - (timer / timerDuration) * circumference }}
            transition={{ duration: 0.5 }}
            transform="rotate(-90 22 22)"
          />
        </svg>
        <motion.div
          className="absolute inset-0 hidden sm:flex items-center justify-center"
          animate={isLow ? { scale: [1, 1.1, 1] } : {}}
          transition={isLow ? { repeat: Infinity, duration: 0.5 } : {}}
        >
          <span className="text-sm tabular-nums" style={{ color: isLow ? "#F24E1E" : g.textBright }}>
            {timer}
          </span>
        </motion.div>
      </div>
    </div>
  );
}

interface TopBarProps {
  onReset: () => void;
  onClose: () => void;
  timer: number;
  timerDuration: number;
  timerEnabled: boolean;
  currentPlayer: "red" | "yellow";
  blastMode: boolean;
  hasBlastToken: boolean;
  onToggleBlast: () => void;
  soundEnabled: boolean;
  onSoundToggle: () => void;
  cameraTracking?: boolean;
  cameraLoading?: boolean;
  cameraError?: string | null;
  onCameraToggle?: () => void;
  onLeaderboardToggle?: () => void;
  leaderboardOpen?: boolean;
  sfxVolume?: number;
  onSfxVolumeChange?: (v: number) => void;
}

export function TopBar({ onReset, onClose, timer, timerDuration, timerEnabled, currentPlayer, blastMode, hasBlastToken, onToggleBlast, soundEnabled, onSoundToggle, cameraTracking, cameraLoading, cameraError, onCameraToggle, onLeaderboardToggle, leaderboardOpen, sfxVolume = 80, onSfxVolumeChange }: TopBarProps) {
  // Refs for animated icons (so parent button hover triggers the animation)
  const soundWaveRef = useRef<SpeakerWaveIconHandle>(null);
  const soundXRef = useRef<SpeakerXMarkIconHandle>(null);
  const handIconRef = useRef<HandRaisedIconHandle>(null);
  const trophyRef = useRef<TrophyIconHandle>(null);
  const [showVolume, setShowVolume] = useState(false);
  const volumeRef = useRef<HTMLDivElement>(null);
  const volumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // SFX Volume change handler
  const handleVolumeChange = useCallback((newVol: number) => {
    onSfxVolumeChange?.(newVol);
  }, [onSfxVolumeChange]);

  // Close volume popover when clicking outside
  useEffect(() => {
    if (!showVolume) return;
    const handleClick = (e: MouseEvent) => {
      if (volumeRef.current && !volumeRef.current.contains(e.target as Node)) {
        setShowVolume(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showVolume]);

  const handleVolumeMouseEnter = () => {
    if (volumeTimeoutRef.current) clearTimeout(volumeTimeoutRef.current);
    setShowVolume(true);
  };
  const handleVolumeMouseLeave = () => {
    volumeTimeoutRef.current = setTimeout(() => setShowVolume(false), 300);
  };

  return (
    <div className="flex items-center justify-between w-full px-3 sm:px-6 py-2 sm:py-3">
      {/* Left: SVG Logo */}
      <div className="flex items-center flex-shrink-0">
        <div className="hidden sm:block w-[clamp(80px,14vw,130px)] aspect-[208.586/48.7687]">
          <Make4Logo />
        </div>
        {/* Compact logo on mobile */}
        <div className="sm:hidden w-[70px] aspect-[208.586/48.7687]">
          <Make4Logo />
        </div>
      </div>

      {/* Center: Timer + Blast Token */}
      <div className="flex items-center gap-2 sm:gap-3">
        <TimerDisplay timer={timer} timerDuration={timerDuration} currentPlayer={currentPlayer} timerEnabled={timerEnabled} />

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onToggleBlast}
          disabled={!hasBlastToken}
          className="px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-xl flex items-center gap-1.5 sm:gap-2 cursor-pointer disabled:cursor-not-allowed"
          style={{
            background: blastMode
              ? "rgba(162,89,255,0.2)"
              : hasBlastToken
              ? g.surfaceSubtle
              : g.surfaceFaint,
            border: blastMode
              ? "2px solid #A259FF"
              : hasBlastToken
              ? `2px solid ${g.border}`
              : `2px solid ${g.borderSubtle}`,
            boxShadow: blastMode ? "0 0 20px rgba(162,89,255,0.2)" : "none",
          }}
        >
          <Bomb size={16} color={blastMode ? "#A259FF" : hasBlastToken ? g.textMuted : g.textGhost} />
          <span className="hidden sm:inline text-sm" style={{
            color: blastMode ? "#A259FF" : hasBlastToken ? g.textMuted : g.textGhost
          }}>
            {blastMode ? "Pick target" : "Blast"}
          </span>
        </motion.button>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Sound toggle + Volume slider */}
        <div
          className="relative"
          ref={volumeRef}
          onMouseEnter={handleVolumeMouseEnter}
          onMouseLeave={handleVolumeMouseLeave}
        >
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onSoundToggle}
            onMouseEnter={() => {
              soundWaveRef.current?.startAnimation();
              soundXRef.current?.startAnimation();
            }}
            onMouseLeave={() => {
              soundWaveRef.current?.stopAnimation();
              soundXRef.current?.stopAnimation();
            }}
            className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center cursor-pointer"
            style={{
              background: soundEnabled ? "rgba(10,207,131,0.08)" : g.surfaceSubtle,
              border: soundEnabled ? "1px solid rgba(10,207,131,0.2)" : `1px solid ${g.border}`,
            }}
          >
            {soundEnabled ? (
              <SpeakerWaveIcon ref={soundWaveRef} size={16} strokeWidth={2} color="#0ACF83" />
            ) : (
              <SpeakerXMarkIcon ref={soundXRef} size={16} strokeWidth={2} color={g.textMuted} />
            )}
          </motion.button>

          {/* Volume popover on hover */}
          <AnimatePresence>
            {showVolume && onSfxVolumeChange && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full left-1/2 -translate-x-1/2 mt-2 rounded-xl z-50 backdrop-blur-[12px] bg-g-surface border border-g-border"
                style={{ boxShadow: `0 8px 32px ${g.shadowLg}` }}
              >
                <div className="flex flex-col items-center gap-2 px-3 py-3 min-w-[160px]">
                  <span className="label-caps-sm text-2xs" style={{ color: g.textMuted }}>
                    Sound FX
                  </span>

                  {/* Slider row */}
                  <div className="flex items-center gap-2 w-full">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleVolumeChange(0); }}
                      className="flex-shrink-0 cursor-pointer bg-transparent border-none p-0"
                    >
                      <SpeakerXMarkIcon size={12} color={g.textDim} />
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={sfxVolume}
                      onChange={(e) => { e.stopPropagation(); handleVolumeChange(parseInt(e.target.value)); }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer outline-none border-none"
                      style={{
                        accentColor: "#0ACF83",
                        background: `linear-gradient(to right, #0ACF83 ${sfxVolume}%, ${g.borderLight} ${sfxVolume}%)`,
                      }}
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleVolumeChange(100); }}
                      className="flex-shrink-0 cursor-pointer bg-transparent border-none p-0"
                    >
                      <SpeakerWaveIcon size={12} color={g.textDim} />
                    </button>
                  </div>

                  {/* Volume percentage */}
                  <span className="text-g-text-dim text-xs tabular-nums">
                    {sfxVolume}%
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={onReset}
          className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center cursor-pointer icon-btn"
        >
          <RotateCcw size={15} className="sm:hidden" color={g.textMuted} />
          <RotateCcw size={18} className="hidden sm:block" color={g.textMuted} />
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={onClose}
          className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center cursor-pointer icon-btn"
        >
          <Home size={15} className="sm:hidden" color={g.textMuted} />
          <Home size={18} className="hidden sm:block" color={g.textMuted} />
        </motion.button>

        {/* Hand tracking toggle — hidden on small mobile to save space */}
        {onCameraToggle && (
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onCameraToggle}
            onMouseEnter={() => handIconRef.current?.startAnimation()}
            onMouseLeave={() => handIconRef.current?.stopAnimation()}
            className="flex w-8 h-8 sm:w-10 sm:h-10 rounded-xl items-center justify-center cursor-pointer"
            style={{
              background: cameraTracking ? "rgba(10,207,131,0.08)" : g.surfaceSubtle,
              border: cameraTracking ? "1px solid rgba(10,207,131,0.2)" : `1px solid ${g.border}`,
            }}
            title={cameraError || (cameraTracking ? "Hand tracking active" : "Enable hand tracking")}
          >
            {cameraLoading ? (
              <Loader2 size={16} color="#0ACF83" className="animate-spin" />
            ) : (
              <HandRaisedIcon
                ref={handIconRef}
                size={16}
                strokeWidth={2}
                color={cameraTracking ? "#0ACF83" : g.textMuted}
              />
            )}
          </motion.button>
        )}

        {/* Leaderboard toggle — hidden on small mobile to save space */}
        {onLeaderboardToggle && (
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onLeaderboardToggle}
            onMouseEnter={() => trophyRef.current?.startAnimation()}
            onMouseLeave={() => trophyRef.current?.stopAnimation()}
            className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center cursor-pointer"
            style={{
              background: leaderboardOpen ? "rgba(255,191,0,0.1)" : g.surfaceSubtle,
              border: leaderboardOpen ? "1px solid rgba(255,191,0,0.25)" : `1px solid ${g.border}`,
            }}
          >
            <TrophyIcon ref={trophyRef} size={16} strokeWidth={2} color={leaderboardOpen ? g.yellow : g.textMuted} />
          </motion.button>
        )}
      </div>
    </div>
  );
}

interface WinnerOverlayProps {
  winner: CellValue | "draw";
  onPlayAgain: () => void;
  onExit?: () => void;
  onClose?: () => void;
  onLeaderboard?: () => void;
  score?: { red: number; yellow: number; draws: number };
  p1Label?: string;
  p2Label?: string;
  gameMode?: "local" | "bot";
  difficulty?: "easy" | "medium" | "hard";
  onDifficultyChange?: (d: "easy" | "medium" | "hard") => void;
}

export function WinnerOverlay({ winner, onPlayAgain, onExit, onClose, onLeaderboard, score, p1Label = "Red", p2Label = "Yellow", gameMode, difficulty, onDifficultyChange }: WinnerOverlayProps) {
  const accentColor = winner === "red" ? "#F24E1E" : winner === "yellow" ? g.yellow : "#A259FF";

  return (
    <AnimatePresence>
      {winner && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-g-overlay backdrop-blur-[12px]"
        >
          <motion.div
            initial={{ scale: 0.8, y: 30 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20, opacity: 0 }}
            transition={{ type: "spring", damping: 20, stiffness: 200 }}
            className="rounded-3xl p-6 sm:p-10 text-center relative overflow-hidden mx-4 sm:mx-0 w-full max-w-[420px] min-w-[min(360px,calc(100vw-32px))]"
            style={{
              background: `linear-gradient(180deg, ${g.winnerBgStart} 0%, ${g.winnerBgEnd} 100%)`,
              border: `2px solid ${winner === "draw" ? "rgba(162,89,255,0.3)" : winner === "red" ? "rgba(242,78,30,0.3)" : "rgba(255,191,0,0.3)"}`,
              boxShadow: `0 0 80px ${accentColor}20, 0 30px 80px ${g.shadowLg}`,
            }}
          >
            {/* Glow effect top */}
            <div
              className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 blur-3xl opacity-15"
              style={{ background: accentColor }}
            />

            {/* Close button */}
            {onClose && (
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={onClose}
                className="absolute top-4 right-4 w-8 h-8 rounded-xl flex items-center justify-center cursor-pointer z-10 icon-btn"
              >
                <X size={14} color={g.textMuted} />
              </motion.button>
            )}

            <div className="relative">
              <motion.div
                animate={{ y: [0, -8, 0] }}
                transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
              >
                <TrophyIcon size={52} className="mx-auto mb-4" color={accentColor} />
              </motion.div>

              {winner === "draw" ? (
                <>
                  <h2 className="text-3xl text-g-text tracking-tight">It's a Draw!</h2>
                  <p className="mt-2 text-g-text-muted text-sm">
                    Great match — no one connected four.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-3xl text-g-text tracking-tight">
                    {winner === "red" ? "Red" : "Yellow"} Wins!
                  </h2>
                  <div className="flex items-center justify-center gap-3 mt-3">
                    <div
                      className="w-8 h-8 rounded-full"
                      style={{
                        background: DEFAULT_PALETTE[winner === "red" ? "red" : "yellow"].bg,
                        border: `3px solid ${DEFAULT_PALETTE[winner === "red" ? "red" : "yellow"].highlight}`,
                        outline: `3px solid ${DEFAULT_PALETTE[winner === "red" ? "red" : "yellow"].border}`,
                        outlineOffset: '-1px',
                        boxShadow: `0 0 20px ${accentColor}40, inset 0 2px 5px rgba(255,255,255,0.4), inset 0 -3px 6px ${DEFAULT_PALETTE[winner === "red" ? "red" : "yellow"].dark}`,
                      }}
                    />
                    <span className="text-g-text-muted text-sm">
                      Connected four in a row
                    </span>
                  </div>
                </>
              )}

              {/* Difficulty Picker (bot mode only) */}
              {gameMode === "bot" && difficulty && onDifficultyChange && (
                <div className="mt-6">
                  <p className="label-caps-sm mb-2" style={{ color: g.textFaint, letterSpacing: "2px" }}>
                    Difficulty
                  </p>
                  <div className="flex items-center justify-center rounded-xl overflow-hidden bg-g-surface-subtle border border-g-border">
                    {([
                      { label: "Easy", value: "easy" as const, color: "#0ACF83", desc: "Casual" },
                      { label: "Medium", value: "medium" as const, color: "#1ABCFE", desc: "Balanced" },
                      { label: "Hard", value: "hard" as const, color: "#F24E1E", desc: "Ruthless" },
                    ]).map((d, i) => {
                      const isSelected = difficulty === d.value;
                      return (
                        <button
                          key={d.value}
                          onClick={() => onDifficultyChange(d.value)}
                          className="flex-1 flex flex-col items-center gap-0.5 py-2.5 cursor-pointer relative transition-all duration-200"
                          style={{
                            background: isSelected ? `${d.color}15` : "transparent",
                            borderBottom: isSelected ? `2px solid ${d.color}` : "2px solid transparent",
                            borderRight: i < 2 ? `1px solid ${g.divider}` : "none",
                          }}
                        >
                          <span className="text-sm transition-colors duration-200" style={{ color: isSelected ? d.color : g.textMuted, fontWeight: isSelected ? 600 : 400 }}>
                            {d.label}
                          </span>
                          <span className="text-xs transition-colors duration-200" style={{ color: isSelected ? `${d.color}99` : g.textDim }}>
                            {d.desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={onPlayAgain}
                className="mt-8 px-8 py-3 rounded-xl cursor-pointer flex items-center justify-center gap-2 mx-auto text-base tracking-[0.5px] border-none"
                style={{
                  background: accentColor,
                  color: winner === "yellow" ? "#1E1E1E" : "white",
                  boxShadow: `0 4px 20px ${accentColor}40`,
                }}
              >
                <RotateCcw size={16} />
                Rematch
              </motion.button>

              {/* Secondary actions row */}
              <div className="mt-3 flex items-center justify-center gap-2">
                {onLeaderboard && (
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={onLeaderboard}
                    className="px-4 py-2.5 rounded-xl cursor-pointer flex items-center justify-center gap-2 text-sm bg-figma-yellow/[0.08] text-figma-yellow border border-figma-yellow/20"
                  >
                    <TrophyIcon size={14} color="#FFBF00" />
                    Leaderboard
                  </motion.button>
                )}
                {onExit && (
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={onExit}
                    className="px-4 py-2.5 rounded-xl cursor-pointer flex items-center justify-center gap-2 text-sm bg-g-surface text-g-text-muted border border-g-border"
                  >
                    <Home size={14} />
                    Main Menu
                  </motion.button>
                )}
              </div>

              {/* Session Score */}
              {score && (score.red > 0 || score.yellow > 0 || score.draws > 0) && (
                <div className="mt-5 flex items-center justify-center gap-4 py-2.5 px-5 rounded-xl mx-auto bg-g-surface-faint border border-g-divider">
                  <div className="flex flex-col items-center">
                    <span className="score-num text-figma-red">{score.red}</span>
                    <span className="label-caps-sm text-2xs" style={{ color: g.textFaint }}>{p1Label}</span>
                  </div>
                  <div className="divider-v h-7" />
                  <div className="flex flex-col items-center">
                    <span className="score-num text-g-text-faint">{score.draws}</span>
                    <span className="label-caps-sm text-2xs" style={{ color: g.textFaint }}>Draws</span>
                  </div>
                  <div className="divider-v h-7" />
                  <div className="flex flex-col items-center">
                    <span className="score-num text-g-yellow">{score.yellow}</span>
                    <span className="label-caps-sm text-2xs" style={{ color: g.textFaint }}>{p2Label}</span>
                  </div>
                </div>
              )}

              <div className="mt-4 flex items-center justify-center gap-1">
                <FigmaLogo size={10} />
                <span className="text-g-text-dim text-xs ml-1">made by Figma Make</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}