/**
 * matchResult.ts — who may persist a finished Match to the leaderboard.
 *
 * Only a timed Match counts. Online, only the host of a live Room persists, so a
 * result is written once; both peers still update their local display score. A
 * failed Room is a no contest and never persists anything.
 */
import type { RoomMatchInput } from "./room";
import type { GameMode } from "./StartScreen";

/** Whether a Match with this turn timer is ranked on the leaderboard (0 = no timer, casual). */
export function countsTowardLeaderboard(timerDuration: number): boolean {
  return timerDuration > 0;
}

export function persistsMatchResult(opts: {
  gameMode: GameMode;
  timerDuration: number;
  room: Pick<RoomMatchInput, "live" | "role"> | null;
}): boolean {
  if (!countsTowardLeaderboard(opts.timerDuration)) return false;
  if (opts.gameMode !== "online") return true;
  const { room } = opts;
  return !!room && room.live && room.role === "host";
}
