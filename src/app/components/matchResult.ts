/**
 * matchResult.ts — who may persist a finished Match to the leaderboard.
 *
 * Only a timed Match counts. Online, only the host of a live Room persists, so a
 * result is written once; both peers still update their local display score. A
 * failed Room is a no contest and never persists anything.
 */
import type { RoomState } from "./room";
import type { GameMode } from "./StartScreen";

export function persistsMatchResult(opts: { gameMode: GameMode; timerDuration: number; room: RoomState }): boolean {
  if (opts.timerDuration <= 0) return false;
  if (opts.gameMode !== "online") return true;
  const { room } = opts;
  return (room.phase === "ready" || room.phase === "interrupted") && room.room.role === "host";
}
