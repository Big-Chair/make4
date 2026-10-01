/**
 * leaderboardQuery.ts — the one owner of what the Leaderboard shows.
 *
 * It owns the level tabs, the selected level, the viewing player, load and
 * refresh, and token resolution. The start-screen `Leaderboard` and the in-game
 * `LeaderboardDrawer` are render layers over `useLeaderboard`.
 *
 * The selected level lives here, outside React, so every view shares it and a
 * remount keeps it.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fetchLeaderboard, type PlayerStats } from "./api";
import { resolve as resolveToken, type TokenConfig } from "./tokens";

export const LEVEL_TABS = [
  { key: "", label: "All", sub: "" },
  { key: "40", label: "Easy", sub: "40s" },
  { key: "35", label: "Medium", sub: "35s" },
  { key: "30", label: "Hard", sub: "30s" },
] as const;

/** A timer length in seconds, or "" for all timed modes. */
export type LeaderboardLevel = (typeof LEVEL_TABS)[number]["key"];

export const LEADERBOARD_LIMIT = 20;

// ─── Selected level (shared, outlives every view) ───

let selectedLevel: LeaderboardLevel = "";
const levelListeners = new Set<() => void>();

function subscribeLevel(listener: () => void) {
  levelListeners.add(listener);
  return () => {
    levelListeners.delete(listener);
  };
}

function selectLevel(level: LeaderboardLevel) {
  if (level === selectedLevel) return;
  selectedLevel = level;
  for (const listener of levelListeners) listener();
}

const getLevel = () => selectedLevel;

// ─── Query ───

export interface RankedPlayer {
  player: PlayerStats;
  rank: number;
}

interface Board {
  players: PlayerStats[];
  currentPlayer: RankedPlayer | null;
  tokenConfigs: Record<string, unknown>;
}

const EMPTY_BOARD: Board = { players: [], currentPlayer: null, tokenConfigs: {} };

const sameName = (a: string, b: string) => a.toLowerCase().trim() === b.toLowerCase().trim();

export interface LeaderboardQuery {
  tabs: typeof LEVEL_TABS;
  level: LeaderboardLevel;
  selectLevel: (level: LeaderboardLevel) => void;
  /** Reload the selected level. Takes no arguments, so it is safe as an onClick. */
  refresh: () => void;
  loading: boolean;
  players: PlayerStats[];
  /** The viewing player's row and rank, when they have played. */
  currentPlayer: RankedPlayer | null;
  /** True when the viewing player has a rank but is not in `players`. */
  currentPlayerOutsideList: boolean;
  isCurrentPlayer: (name: string) => boolean;
  tokenFor: (name: string) => TokenConfig;
}

export function useLeaderboard({
  playerName,
  active = true,
}: {
  /** The player viewing the board; their row is highlighted. */
  playerName?: string;
  /** Load only while the board is on screen. */
  active?: boolean;
}): LeaderboardQuery {
  const level = useSyncExternalStore(subscribeLevel, getLevel, getLevel);
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [loading, setLoading] = useState(true);
  const latestRequest = useRef(0);

  const load = useCallback(
    async (forLevel: LeaderboardLevel) => {
      const request = ++latestRequest.current;
      setLoading(true);
      const res = await fetchLeaderboard(playerName || undefined, LEADERBOARD_LIMIT, forLevel || undefined);
      // A newer load (level change, refresh, new player) owns the board now.
      if (request !== latestRequest.current) return;
      setBoard(
        res.ok
          ? {
              players: res.data.players,
              currentPlayer:
                res.data.currentPlayer && res.data.currentPlayerRank
                  ? { player: res.data.currentPlayer, rank: res.data.currentPlayerRank }
                  : null,
              tokenConfigs: res.data.tokenConfigs ?? {},
            }
          : EMPTY_BOARD,
      );
      setLoading(false);
    },
    [playerName],
  );

  useEffect(() => {
    if (active) void load(level);
  }, [active, level, load]);

  // Drop any in-flight response once the view is gone.
  useEffect(() => () => void ++latestRequest.current, []);

  const refresh = useCallback(() => void load(getLevel()), [load]);

  const { players, currentPlayer, tokenConfigs } = board;
  const isCurrentPlayer = useCallback(
    (name: string) => currentPlayer != null && sameName(name, currentPlayer.player.name),
    [currentPlayer],
  );
  const tokenFor = useCallback((name: string) => resolveToken(name, tokenConfigs), [tokenConfigs]);

  return {
    tabs: LEVEL_TABS,
    level,
    selectLevel,
    refresh,
    loading,
    players,
    currentPlayer,
    currentPlayerOutsideList: currentPlayer != null && !players.some((p) => isCurrentPlayer(p.name)),
    isCurrentPlayer,
    tokenFor,
  };
}
