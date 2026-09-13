/**
 * matchSnapshot.ts — the Match Snapshot.
 *
 * A complete, host-authoritative picture of one Match at one revision. The Match
 * owns creating and restoring it; the Room carries it over the wire opaquely.
 * Decoding happens here, on the Match side, so a malformed snapshot never becomes
 * Board state.
 */
import { PROTOCOL_VERSION } from "./room";
import { COLS, ROWS, type Board, type CellValue } from "./useConnect4";

export interface MatchSnapshot {
  protocolVersion: typeof PROTOCOL_VERSION;
  matchId: string;
  revision: number;
  board: Board;
  currentPlayer: "red" | "yellow";
  winner: "red" | "yellow" | "draw" | null;
  winningCells: number[][] | null;
  redBlastToken: boolean;
  yellowBlastToken: boolean;
  timer: number;
  countdown: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isColor(value: unknown): value is "red" | "yellow" {
  return value === "red" || value === "yellow";
}

function isCell(value: unknown): value is CellValue {
  return value === null || isColor(value);
}

function isBoard(value: unknown): value is Board {
  return (
    Array.isArray(value) &&
    value.length === ROWS &&
    value.every((row) => Array.isArray(row) && row.length === COLS && row.every(isCell))
  );
}

function isWinningCells(value: unknown): value is number[][] | null {
  if (value === null) return true;
  return (
    Array.isArray(value) &&
    value.every(
      (cell) =>
        Array.isArray(cell) &&
        cell.length === 2 &&
        isCount(cell[0]) &&
        cell[0] < ROWS &&
        isCount(cell[1]) &&
        cell[1] < COLS,
    )
  );
}

export function decodeMatchSnapshot(value: unknown): MatchSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.protocolVersion !== PROTOCOL_VERSION) return null;
  if (typeof value.matchId !== "string" || !value.matchId) return null;
  if (!isCount(value.revision)) return null;
  if (!isBoard(value.board)) return null;
  if (!isColor(value.currentPlayer)) return null;
  if (!(value.winner === null || value.winner === "draw" || isColor(value.winner))) return null;
  if (!isWinningCells(value.winningCells)) return null;
  if (typeof value.redBlastToken !== "boolean" || typeof value.yellowBlastToken !== "boolean") return null;
  if (!isCount(value.timer) || !isCount(value.countdown)) return null;
  return {
    protocolVersion: PROTOCOL_VERSION,
    matchId: value.matchId,
    revision: value.revision,
    board: value.board.map((row) => [...row]),
    currentPlayer: value.currentPlayer,
    winner: value.winner,
    winningCells: value.winningCells ? value.winningCells.map((cell) => [...cell]) : null,
    redBlastToken: value.redBlastToken,
    yellowBlastToken: value.yellowBlastToken,
    timer: value.timer,
    countdown: value.countdown,
  };
}
