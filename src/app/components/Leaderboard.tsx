import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Medal, Crown } from "lucide-react";
import { UserIcon } from "../../imports/user-icon";
import type { PlayerStats } from "./api";
import { type TokenConfig, getTokenVisuals, resolve as resolveToken } from "./tokens";
import { MiniToken } from "./MiniToken";
import { g } from "./ThemeContext";

interface LeaderboardProps {
  players: PlayerStats[];
  loading?: boolean;
  currentPlayerData?: { player: PlayerStats; rank: number } | null;
  tokenConfigs?: Record<string, any>;
}

const RANK_STYLES = [
  { icon: Crown, color: g.yellow, bg: "rgba(255,191,0,0.08)", border: "rgba(255,191,0,0.2)" },
  { icon: Medal, color: "#C0C0C0", bg: "rgba(192,192,192,0.06)", border: "rgba(192,192,192,0.15)" },
  { icon: Medal, color: "#CD7F32", bg: "rgba(205,127,50,0.06)", border: "rgba(205,127,50,0.15)" },
];

/** Enlarged token hover preview */
function TokenPreview({
  config,
  playerName,
  anchorRect,
}: {
  config: TokenConfig;
  playerName: string;
  anchorRect: DOMRect;
}) {
  const tv = getTokenVisuals(config, "red");
  // Position above the token, centered
  const top = anchorRect.top - 110;
  const left = anchorRect.left + anchorRect.width / 2 - 48;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.7, y: 8 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="fixed z-[9999] pointer-events-none flex flex-col items-center"
      style={{ top: Math.max(8, top), left: Math.max(8, left) }}
    >
      {/* Enlarged token */}
      <div
        className="rounded-full relative overflow-hidden"
        style={{
          width: 80,
          height: 80,
          background: tv.bg,
          border: `3px solid ${tv.highlight}`,
          boxShadow: `0 8px 32px ${g.shadowMd}, 0 0 20px ${tv.glow}40, inset 0 2px 5px rgba(255,255,255,0.4), inset 0 -3px 6px ${tv.dark}`,
        }}
      >
        {tv.imageUrl && (
          <img
            src={tv.imageUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover rounded-full"
          />
        )}
        {tv.emoji && (
          <span
            className="absolute inset-0 flex items-center justify-center"
            style={{
              fontSize: 36,
              lineHeight: 1,
              textShadow: tv.imageUrl ? "0 2px 6px rgba(0,0,0,0.7)" : "none",
            }}
          >
            {tv.emoji}
          </span>
        )}
      </div>
      {/* Player name label */}
      <div
        className="mt-2 px-3 py-1 rounded-lg"
        style={{
          background: g.tooltipBg,
          border: `1px solid ${g.borderHover}`,
          backdropFilter: "blur(8px)",
        }}
      >
        <span className="text-xs font-medium" style={{ color: g.textBright }}>
          {playerName}
        </span>
      </div>
      {/* Arrow pointing down */}
      <div
        style={{
          width: 0,
          height: 0,
          borderLeft: "6px solid transparent",
          borderRight: "6px solid transparent",
          borderTop: `6px solid ${g.tooltipBg}`,
          marginTop: "-1px",
        }}
      />
    </motion.div>
  );
}

function PlayerRow({
  player,
  rank,
  isCurrentUser,
  animDelay,
  tokenConfigs,
}: {
  player: PlayerStats;
  rank: number;
  isCurrentUser: boolean;
  animDelay: number;
  tokenConfigs?: Record<string, any>;
}) {
  const rankIndex = rank - 1;
  const rankStyle = RANK_STYLES[rankIndex] || null;
  const winRate = player.gamesPlayed > 0 ? Math.round((player.wins / player.gamesPlayed) * 100) : 0;
  const RankIcon = rankStyle?.icon || null;

  // Single resolution: server (case-insensitive) → localStorage → default
  const tokenConfig = resolveToken(player.name, tokenConfigs);
  const hasToken = tokenConfig && tokenConfig.type !== "default";

  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!hasToken) return;
    setHoverRect(e.currentTarget.getBoundingClientRect());
  };
  const handleMouseLeave = () => setHoverRect(null);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: animDelay }}
        className="flex items-center gap-3 rounded-xl px-3 py-2.5 relative"
        style={{
          background: isCurrentUser
            ? "rgba(162,89,255,0.1)"
            : rankStyle?.bg || g.surfaceFaint,
          border: `1px solid ${
            isCurrentUser
              ? "rgba(162,89,255,0.3)"
              : rankStyle?.border || g.borderSubtle
          }`,
        }}
      >
        {/* "You" badge */}
        {isCurrentUser && (
          <div
            className="absolute -top-2 right-3 px-2 py-0.5 rounded-full text-2xs uppercase tracking-[1px] font-semibold text-white"
            style={{
              background: "linear-gradient(135deg, #A259FF, #7C3AED)",
            }}
          >
            You
          </div>
        )}

        {/* Rank */}
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: rankStyle ? `${rankStyle.color}15` : g.surfaceFaint,
            border: `1px solid ${rankStyle?.color || g.borderLight}30`,
          }}
        >
          {RankIcon ? (
            <RankIcon size={14} color={rankStyle!.color} />
          ) : (
            <span
              className="text-xs tabular-nums"
              style={{
                color: isCurrentUser ? "#A259FF" : g.textFaint,
                fontWeight: isCurrentUser ? 600 : 400,
              }}
            >
              {rank}
            </span>
          )}
        </div>

        {/* Token + Name */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {hasToken ? (
            <div
              className="cursor-pointer transition-transform hover:scale-110"
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <MiniToken config={tokenConfig!} size={22} />
            </div>
          ) : null}
          <div className="min-w-0">
            <div
              className="truncate"
              style={{
                color: g.textBright,
                fontWeight: isCurrentUser ? 600 : 400,
                textTransform: "capitalize",
              }}
            >
              {player.name}
            </div>
            <div className="text-xs" style={{ color: g.textDim }}>
              {player.gamesPlayed} game{player.gamesPlayed !== 1 ? "s" : ""} · {winRate}% win rate
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex flex-col items-center">
            <span className="text-base tabular-nums leading-none" style={{ color: "#0ACF83" }}>
              {player.wins}
            </span>
            <span className="text-2xs tracking-[0.5px]" style={{ color: g.textDim }}>W</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-base tabular-nums leading-none" style={{ color: "#F24E1E" }}>
              {player.losses}
            </span>
            <span className="text-2xs tracking-[0.5px]" style={{ color: g.textDim }}>L</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-base tabular-nums leading-none" style={{ color: g.textFaint }}>
              {player.draws}
            </span>
            <span className="text-2xs tracking-[0.5px]" style={{ color: g.textDim }}>D</span>
          </div>
        </div>
      </motion.div>

      {/* Hover preview portal */}
      <AnimatePresence>
        {hoverRect && hasToken && (
          <TokenPreview
            config={tokenConfig!}
            playerName={player.name}
            anchorRect={hoverRect}
          />
        )}
      </AnimatePresence>
    </>
  );
}

export function Leaderboard({ players, loading, currentPlayerData, tokenConfigs }: LeaderboardProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="w-6 h-6 rounded-full border-2 border-t-transparent"
          style={{ borderColor: "rgba(162,89,255,0.3)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  if (players.length === 0) {
    return (
      <div className="text-center py-6">
        <UserIcon size={28} className="mx-auto mb-2" color={g.textGhost} />
        <p className="text-sm" style={{ color: g.textDim }}>
          No games recorded yet. Play a match to get on the board!
        </p>
      </div>
    );
  }

  // Check if the current player is already in the top list
  const currentPlayerInTop =
    currentPlayerData &&
    players.some(
      (p) => p.name.toLowerCase().trim() === currentPlayerData.player.name.toLowerCase().trim()
    );

  // Show the "your position" row only if they exist and are NOT in the top list
  const showCurrentPlayerBelow = currentPlayerData && !currentPlayerInTop;

  return (
    <div className="flex flex-col gap-1.5 max-h-[420px] overflow-y-auto pr-1 custom-scrollbar">
      {/* Top 20 */}
      {players.map((player, index) => {
        const isCurrentUser =
          currentPlayerData != null &&
          player.name.toLowerCase().trim() === currentPlayerData.player.name.toLowerCase().trim();

        return (
          <PlayerRow
            key={player.name}
            player={player}
            rank={index + 1}
            isCurrentUser={isCurrentUser}
            animDelay={index * 0.05}
            tokenConfigs={tokenConfigs}
          />
        );
      })}

      {/* Separator + current player if outside top list */}
      {showCurrentPlayerBelow && (
        <>
          {/* Ellipsis separator */}
          <div className="flex items-center justify-center gap-1.5 py-2">
            <div
              className="w-1 h-1 rounded-full"
              style={{ background: g.textGhost }}
            />
            <div
              className="w-1 h-1 rounded-full"
              style={{ background: g.border }}
            />
            <div
              className="w-1 h-1 rounded-full"
              style={{ background: g.borderSubtle }}
            />
          </div>

          <PlayerRow
            player={currentPlayerData!.player}
            rank={currentPlayerData!.rank}
            isCurrentUser
            animDelay={players.length * 0.05 + 0.1}
            tokenConfigs={tokenConfigs}
          />
        </>
      )}
    </div>
  );
}