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
import type { Role } from "./room";
import { resolve as resolveToken, type TokenConfig } from "./tokens";

const LEVEL_TABS = [
  { key: "", label: "All", sub: "" },
  { key: "40", label: "Easy", sub: "40s" },
  { key: "35", label: "Medium", sub: "35s" },
  { key: "30", label: "Hard", sub: "30s" },
] as const;

/** A timer length in seconds, or "" for all timed modes. */
export type LeaderboardLevel = (typeof LEVEL_TABS)[number]["key"];

const LEADERBOARD_LIMIT = 20;

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

interface LeaderboardSnapshot {
  players: PlayerStats[];
  viewingPlayer: RankedPlayer | null;
  tokenConfigs: Record<string, unknown>;
}

const EMPTY_SNAPSHOT: LeaderboardSnapshot = { players: [], viewingPlayer: null, tokenConfigs: {} };

const sameName = ({ name, other }: { name: string; other: string }) =>
  name.toLowerCase().trim() === other.toLowerCase().trim();

/** Whose row the in-game drawer highlights: the guest sees their own name online, everyone else player 1. */
export function viewingPlayerName({
  role,
  player1Name,
  player2Name,
}: {
  role?: Role;
  player1Name: string;
  player2Name: string;
}) {
  return role === "guest" ? player2Name : player1Name;
}

export interface LeaderboardQuery {
  tabs: typeof LEVEL_TABS;
  level: LeaderboardLevel;
  selectLevel: (level: LeaderboardLevel) => void;
  /** Reload the selected level. Takes no arguments, so it is safe as an onClick. */
  refresh: () => void;
  loading: boolean;
  players: PlayerStats[];
  /** The viewing player's row and rank, when they have played. */
  viewingPlayer: RankedPlayer | null;
  /** The viewing player, when ranked but not in `players` (shown below the list). */
  viewingPlayerBelowList: RankedPlayer | null;
  isViewingPlayer: (name: string) => boolean;
  tokenFor: (name: string) => TokenConfig;
}

export function useLeaderboard({
  viewingPlayerName,
  active = true,
}: {
  /** The player viewing the board; their row is highlighted. */
  viewingPlayerName?: string;
  /** Load only while the board is on screen. */
  active?: boolean;
}): LeaderboardQuery {
  const level = useSyncExternalStore(subscribeLevel, getLevel, getLevel);
  const [snapshot, setSnapshot] = useState<LeaderboardSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(active);
  const latestRequest = useRef(0);

  const load = useCallback(
    async (forLevel: LeaderboardLevel) => {
      const request = ++latestRequest.current;
      setLoading(true);
      const res = await fetchLeaderboard(viewingPlayerName || undefined, LEADERBOARD_LIMIT, forLevel || undefined);
      // A newer load (level change, refresh, new player) owns the snapshot now.
      if (request !== latestRequest.current) return;
      setSnapshot(
        res.ok
          ? {
              players: res.data.players,
              viewingPlayer:
                res.data.currentPlayer && res.data.currentPlayerRank
                  ? { player: res.data.currentPlayer, rank: res.data.currentPlayerRank }
                  : null,
              tokenConfigs: res.data.tokenConfigs ?? {},
            }
          : EMPTY_SNAPSHOT,
      );
      setLoading(false);
    },
    [viewingPlayerName],
  );

  useEffect(() => {
    if (active) void load(level);
  }, [active, level, load]);

  // Drop any in-flight response once the view is gone.
  useEffect(() => () => void ++latestRequest.current, []);

  const refresh = useCallback(() => void load(getLevel()), [load]);

  const { players, viewingPlayer, tokenConfigs } = snapshot;
  const isViewingPlayer = useCallback(
    (name: string) => viewingPlayer != null && sameName({ name, other: viewingPlayer.player.name }),
    [viewingPlayer],
  );
  const tokenFor = useCallback((name: string) => resolveToken(name, tokenConfigs), [tokenConfigs]);

  return {
    tabs: LEVEL_TABS,
    level,
    selectLevel,
    refresh,
    loading,
    players,
    viewingPlayer,
    viewingPlayerBelowList: players.some((p) => isViewingPlayer(p.name)) ? null : viewingPlayer,
    isViewingPlayer,
    tokenFor,
  };
}
