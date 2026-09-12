import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, RefreshCw, Crown, Medal } from "lucide-react";
import { fetchLeaderboard, type PlayerStats } from "./api";
import { TrophyIcon } from "../../imports/trophy-icon";
import { UserIcon } from "../../imports/user-icon";
import { resolve as resolveToken } from "./tokens";
import { MiniToken } from "./MiniToken";
import { g } from "./ThemeContext";

interface LeaderboardDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentPlayerName?: string;
}

const RANK_STYLES = [
  { icon: Crown, color: "#FFBF00", bg: "rgba(255,191,0,0.08)", border: "rgba(255,191,0,0.2)" },
  { icon: Medal, color: "#C0C0C0", bg: "rgba(192,192,192,0.06)", border: "rgba(192,192,192,0.15)" },
  { icon: Medal, color: "#CD7F32", bg: "rgba(205,127,50,0.06)", border: "rgba(205,127,50,0.15)" },
];

function DrawerPlayerRow({
  player,
  rank,
  isCurrentUser,
  index,
  tokenConfigs,
}: {
  player: PlayerStats;
  rank: number;
  isCurrentUser: boolean;
  index: number;
  tokenConfigs?: Record<string, any>;
}) {
  const rankIndex = rank - 1;
  const rankStyle = RANK_STYLES[rankIndex] || null;
  const winRate = player.gamesPlayed > 0 ? Math.round((player.wins / player.gamesPlayed) * 100) : 0;
  const RankIcon = rankStyle?.icon || null;

  // Single resolution: server (case-insensitive) → localStorage → default
  const tokenConfig = resolveToken(player.name, tokenConfigs);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.05 + index * 0.025, duration: 0.25 }}
      className="flex items-center gap-2.5 rounded-xl px-3 py-2 relative"
      style={{
        background: isCurrentUser
          ? "rgba(162,89,255,0.12)"
          : rankStyle?.bg || "rgba(255,255,255,0.02)",
        border: `1px solid ${
          isCurrentUser
            ? "rgba(162,89,255,0.3)"
            : rankStyle?.border || "rgba(255,255,255,0.05)"
        }`,
      }}
    >
      {isCurrentUser && (
        <div
          className="absolute -top-1.5 right-3 px-1.5 py-px rounded-full text-2xs uppercase tracking-[1px] font-semibold text-white"
          style={{
            background: "linear-gradient(135deg, #A259FF, #7C3AED)",
          }}
        >
          You
        </div>
      )}

      {/* Rank */}
      <div
        className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{
          background: rankStyle ? `${rankStyle.color}15` : "rgba(255,255,255,0.04)",
          border: `1px solid ${rankStyle?.color || "rgba(255,255,255,0.08)"}30`,
        }}
      >
        {RankIcon ? (
          <RankIcon size={12} color={rankStyle!.color} />
        ) : (
          <span
            className="text-2xs tabular-nums"
            style={{
              color: isCurrentUser ? "#A259FF" : "rgba(255,255,255,0.35)",
              fontWeight: isCurrentUser ? 600 : 400,
            }}
          >
            {rank}
          </span>
        )}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {tokenConfig && tokenConfig.type !== "default" ? (
          <MiniToken config={tokenConfig} size={20} />
        ) : null}
        <div className="min-w-0">
          <div
            className="truncate text-sm"
            style={{
              color: isCurrentUser
                ? "#A259FF"
                : rankStyle?.color || "rgba(255,255,255,0.7)",
              fontWeight: isCurrentUser ? 600 : 400,
            }}
          >
            {player.name}
          </div>
          <div className="text-2xs" style={{ color: "rgba(255,255,255,0.3)" }}>
            {player.gamesPlayed}G · {winRate}%
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="flex flex-col items-center">
          <span className="text-sm tabular-nums leading-none" style={{ color: "#0ACF83" }}>
            {player.wins}
          </span>
          <span className="text-2xs tracking-[0.5px]" style={{ color: "rgba(255,255,255,0.2)" }}>W</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-sm tabular-nums leading-none" style={{ color: "#F24E1E" }}>
            {player.losses}
          </span>
          <span className="text-2xs tracking-[0.5px]" style={{ color: "rgba(255,255,255,0.2)" }}>L</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-sm tabular-nums leading-none" style={{ color: "rgba(255,255,255,0.35)" }}>
            {player.draws}
          </span>
          <span className="text-2xs tracking-[0.5px]" style={{ color: "rgba(255,255,255,0.2)" }}>D</span>
        </div>
      </div>
    </motion.div>
  );
}

export function LeaderboardDrawer({ isOpen, onClose, currentPlayerName }: LeaderboardDrawerProps) {
  const [players, setPlayers] = useState<PlayerStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPlayerData, setCurrentPlayerData] = useState<{ player: PlayerStats; rank: number } | null>(null);
  const [tokenConfigs, setTokenConfigs] = useState<Record<string, any>>({});
  const [activeLevel, setActiveLevel] = useState<string>("");

  const LEVEL_TABS = [
    { key: "", label: "All", sub: "" },
    { key: "40", label: "Easy", sub: "40s" },
    { key: "35", label: "Medium", sub: "35s" },
    { key: "30", label: "Hard", sub: "30s" },
  ];

  const loadLeaderboard = useCallback(async (level?: string) => {
    setLoading(true);
    const res = await fetchLeaderboard(currentPlayerName, 20, level || undefined);
    if (res.ok) {
      setPlayers(res.data.players);
      setTokenConfigs(res.data.tokenConfigs || {});
      if (res.data.currentPlayer && res.data.currentPlayerRank) {
        setCurrentPlayerData({ player: res.data.currentPlayer, rank: res.data.currentPlayerRank });
      } else {
        setCurrentPlayerData(null);
      }
    } else {
      setPlayers([]);
      setTokenConfigs({});
      setCurrentPlayerData(null);
    }
    setLoading(false);
  }, [currentPlayerName]);

  // Fetch when opened
  useEffect(() => {
    if (isOpen) {
      loadLeaderboard(activeLevel);
    }
  }, [isOpen, loadLeaderboard, activeLevel]);

  const handleLevelChange = (level: string) => {
    setActiveLevel(level);
    loadLeaderboard(level);
  };

  // Check if the current player is already in the top 20
  const currentPlayerInList =
    currentPlayerData &&
    players.some(
      (p) => p.name.toLowerCase().trim() === currentPlayerData.player.name.toLowerCase().trim()
    );
  const showCurrentPlayerBelow = currentPlayerData && !currentPlayerInList;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40"
            style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(3px)" }}
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="fixed top-0 right-0 h-full z-50 flex flex-col"
            style={{
              width: "min(380px, calc(100vw - 48px))",
              background: "linear-gradient(180deg, #252525 0%, #1A1A1A 100%)",
              borderLeft: "1px solid rgba(255,255,255,0.08)",
              boxShadow: `-10px 0 40px ${g.shadowLg}`,
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4 flex-shrink-0"
              style={{
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{
                    background: "rgba(255,191,0,0.1)",
                    border: "1px solid rgba(255,191,0,0.2)",
                  }}
                >
                  <TrophyIcon size={16} color="#FFBF00" />
                </div>
                <div>
                  <h3 className="text-base font-semibold leading-tight text-white">
                    Leaderboard
                  </h3>
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                    Top 20 players
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={loadLeaderboard}
                  disabled={loading}
                  className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <motion.div
                    animate={loading ? { rotate: 360 } : {}}
                    transition={loading ? { repeat: Infinity, duration: 0.8, ease: "linear" } : {}}
                  >
                    <RefreshCw size={14} color="rgba(255,255,255,0.4)" />
                  </motion.div>
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={onClose}
                  className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <X size={14} color="rgba(255,255,255,0.4)" />
                </motion.button>
              </div>
            </div>

            {/* Difficulty filter tabs */}
            <div
              className="flex items-center gap-1.5 px-5 py-2.5 flex-shrink-0"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
            >
              {LEVEL_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => handleLevelChange(tab.key)}
                  className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-lg cursor-pointer transition-colors"
                  style={{
                    background: activeLevel === tab.key ? "rgba(162,89,255,0.12)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${activeLevel === tab.key ? "rgba(162,89,255,0.3)" : "rgba(255,255,255,0.06)"}`,
                  }}
                >
                  <span
                    className="text-xs font-medium leading-tight"
                    style={{ color: activeLevel === tab.key ? "#A259FF" : "rgba(255,255,255,0.5)" }}
                  >
                    {tab.label}
                  </span>
                  {tab.sub && (
                    <span className="text-2xs" style={{ color: activeLevel === tab.key ? "rgba(162,89,255,0.6)" : "rgba(255,255,255,0.2)" }}>
                      {tab.sub}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-4 py-3" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}>
              {loading && players.length === 0 ? (
                <div className="flex items-center justify-center py-16">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                    className="w-7 h-7 rounded-full border-2 border-t-transparent"
                    style={{ borderColor: "rgba(162,89,255,0.3)", borderTopColor: "transparent" }}
                  />
                </div>
              ) : players.length === 0 ? (
                <div className="text-center py-12">
                  <UserIcon size={32} className="mx-auto mb-3" color="rgba(255,255,255,0.12)" />
                  <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
                    No games recorded yet.
                  </p>
                  <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.2)" }}>
                    Play a match to get on the board!
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {players.map((player, index) => {
                    const isCurrentUser =
                      currentPlayerData != null &&
                      player.name.toLowerCase().trim() === currentPlayerData.player.name.toLowerCase().trim();

                    return (
                      <DrawerPlayerRow
                        key={player.name}
                        player={player}
                        rank={index + 1}
                        isCurrentUser={isCurrentUser}
                        index={index}
                        tokenConfigs={tokenConfigs}
                      />
                    );
                  })}

                  {/* Separator + current player if outside top 20 */}
                  {showCurrentPlayerBelow && (
                    <>
                      <div className="flex items-center justify-center gap-1.5 py-2">
                        <div className="w-1 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
                        <div className="w-1 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }} />
                        <div className="w-1 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }} />
                      </div>
                      <DrawerPlayerRow
                        player={currentPlayerData!.player}
                        rank={currentPlayerData!.rank}
                        isCurrentUser
                        index={players.length}
                        tokenConfigs={tokenConfigs}
                      />
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div
              className="flex-shrink-0 px-5 py-3 text-center"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <span className="text-xs tracking-[0.5px]" style={{ color: "rgba(255,255,255,0.15)" }}>
                {activeLevel ? `${LEVEL_TABS.find(t => t.key === activeLevel)?.label} mode (${activeLevel}s timer)` : "All timed modes"} · Top 20
              </span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}