import { Board, CellValue, hasConnect4 } from "./useConnect4";
import { blastTargets, applyBlast } from "./blast";

const ROWS = 6;
const COLS = 7;

function getValidColumns(board: Board): number[] {
  const valid: number[] = [];
  for (let c = 0; c < COLS; c++) {
    if (board[0][c] === null) valid.push(c);
  }
  return valid;
}

function dropInColumn(board: Board, col: number, player: CellValue): [Board, number] | null {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r][col] === null) {
      const newBoard = board.map((row) => [...row]);
      newBoard[r][col] = player;
      return [newBoard, r];
    }
  }
  return null;
}

function countWindow(window: CellValue[], player: CellValue, opponent: CellValue): number {
  const playerCount = window.filter((c) => c === player).length;
  const opponentCount = window.filter((c) => c === opponent).length;
  const emptyCount = window.filter((c) => c === null).length;

  if (playerCount === 4) return 100000;
  if (opponentCount === 4) return -100000;
  if (playerCount === 3 && emptyCount === 1) return 50;
  if (playerCount === 2 && emptyCount === 2) return 5;
  if (opponentCount === 3 && emptyCount === 1) return -80;
  if (opponentCount === 2 && emptyCount === 2) return -3;
  return 0;
}

function evaluateBoard(board: Board, player: CellValue, opponent: CellValue): number {
  let score = 0;

  // Center column preference
  const centerCol = Math.floor(COLS / 2);
  const centerCount = board.filter((row) => row[centerCol] === player).length;
  score += centerCount * 6;

  // Horizontal
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      const window = [board[r][c], board[r][c + 1], board[r][c + 2], board[r][c + 3]];
      score += countWindow(window, player, opponent);
    }
  }

  // Vertical
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 0; c < COLS; c++) {
      const window = [board[r][c], board[r + 1][c], board[r + 2][c], board[r + 3][c]];
      score += countWindow(window, player, opponent);
    }
  }

  // Diagonal down-right
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      const window = [board[r][c], board[r + 1][c + 1], board[r + 2][c + 2], board[r + 3][c + 3]];
      score += countWindow(window, player, opponent);
    }
  }

  // Diagonal down-left
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 3; c < COLS; c++) {
      const window = [board[r][c], board[r + 1][c - 1], board[r + 2][c - 2], board[r + 3][c - 3]];
      score += countWindow(window, player, opponent);
    }
  }

  return score;
}

function isTerminal(board: Board): boolean {
  if (board[0].every((c) => c !== null)) return true;
  return hasConnect4(board, "red") || hasConnect4(board, "yellow");
}

function minimax(
  board: Board,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizing: boolean,
  aiPlayer: CellValue,
  humanPlayer: CellValue
): number {
  if (depth === 0 || isTerminal(board)) {
    return evaluateBoard(board, aiPlayer, humanPlayer);
  }

  const validCols = getValidColumns(board);

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const col of validCols) {
      const result = dropInColumn(board, col, aiPlayer);
      if (!result) continue;
      const [newBoard] = result;
      const evalScore = minimax(newBoard, depth - 1, alpha, beta, false, aiPlayer, humanPlayer);
      maxEval = Math.max(maxEval, evalScore);
      alpha = Math.max(alpha, evalScore);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const col of validCols) {
      const result = dropInColumn(board, col, humanPlayer);
      if (!result) continue;
      const [newBoard] = result;
      const evalScore = minimax(newBoard, depth - 1, alpha, beta, true, aiPlayer, humanPlayer);
      minEval = Math.min(minEval, evalScore);
      beta = Math.min(beta, evalScore);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

export type Difficulty = "easy" | "medium" | "hard";

const DEPTH_MAP: Record<Difficulty, number> = {
  easy: 1,
  medium: 3,
  hard: 6,
};

export function getBestMove(board: Board, aiPlayer: CellValue, humanPlayer: CellValue, difficulty: Difficulty = "medium"): number {
  const depth = DEPTH_MAP[difficulty];
  const validCols = getValidColumns(board);

  if (validCols.length === 0) return -1;

  // Easy mode: 60% chance of random move — feels like a casual player
  if (difficulty === "easy" && Math.random() < 0.6) {
    return validCols[Math.floor(Math.random() * validCols.length)];
  }

  // Medium mode: 20% chance of random move — decent but makes mistakes
  if (difficulty === "medium" && Math.random() < 0.2) {
    return validCols[Math.floor(Math.random() * validCols.length)];
  }

  let bestScore = -Infinity;
  let bestCol = validCols[0];

  // Check center column first for better pruning
  const ordered = [...validCols].sort((a, b) => Math.abs(a - 3) - Math.abs(b - 3));

  for (const col of ordered) {
    const result = dropInColumn(board, col, aiPlayer);
    if (!result) continue;
    const [newBoard] = result;

    // Immediate win check
    const score = evaluateBoard(newBoard, aiPlayer, humanPlayer);
    if (score >= 100000) return col;

    const evalScore = minimax(newBoard, depth - 1, -Infinity, Infinity, false, aiPlayer, humanPlayer);
    if (evalScore > bestScore) {
      bestScore = evalScore;
      bestCol = col;
    }
  }

  return bestCol;
}

/* ── Blast AI ───────────────────────────────────────────────────────── */

export interface BlastDecision {
  shouldBlast: boolean;
  row: number;
  col: number;
}

/**
 * Evaluate whether the bot should use its blast token this turn.
 * Returns the best blast target if blasting is strategically superior to dropping.
 */
export function getBestBlastMove(
  board: Board,
  aiPlayer: CellValue,
  humanPlayer: CellValue,
  difficulty: Difficulty = "medium"
): BlastDecision | null {
  const depth = DEPTH_MAP[difficulty];
  
  // First, get the score of the best normal drop move for comparison
  const validCols = getValidColumns(board);
  let bestDropScore = -Infinity;
  for (const col of validCols) {
    const result = dropInColumn(board, col, aiPlayer);
    if (!result) continue;
    const [newBoard] = result;
    const evalScore = minimax(newBoard, Math.min(depth - 1, 3), -Infinity, Infinity, false, aiPlayer, humanPlayer);
    bestDropScore = Math.max(bestDropScore, evalScore);
  }

  let bestBlastScore = -Infinity;
  let bestBlastRow = -1;
  let bestBlastCol = -1;

  // Evaluate every cell with a piece as a potential blast target
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] === null) continue;

      const blasted = applyBlast(board, r, c);

      // Priority 1: Does blasting create a win for the bot?
      if (hasConnect4(blasted, aiPlayer)) {
        return { shouldBlast: true, row: r, col: c };
      }

      // Priority 2: Does blasting prevent an imminent opponent win?
      // Check if opponent can win on their next move without the blast
      let opponentCanWinSoon = false;
      for (const col of getValidColumns(board)) {
        const result = dropInColumn(board, col, humanPlayer);
        if (!result) continue;
        if (hasConnect4(result[0], humanPlayer)) {
          opponentCanWinSoon = true;
          break;
        }
      }

      // Evaluate the blasted board position
      const blastScore = evaluateBoard(blasted, aiPlayer, humanPlayer);
      
      // Add bonus if this disrupts an opponent threat
      const currentScore = evaluateBoard(board, aiPlayer, humanPlayer);
      const improvement = blastScore - currentScore;
      
      // Weight: higher if it removes opponent pieces near threats
      const targetsRemoved = blastTargets(board, r, c);
      const opponentPiecesRemoved = targetsRemoved.filter(([tr, tc]) => board[tr][tc] === humanPlayer).length;
      const aiPiecesRemoved = targetsRemoved.filter(([tr, tc]) => board[tr][tc] === aiPlayer).length;
      
      // Prefer blasting opponent pieces, penalize blasting own pieces
      const adjustedScore = blastScore + opponentPiecesRemoved * 20 - aiPiecesRemoved * 15;
      
      // If opponent can win soon and this blast removes their winning path, big bonus
      if (opponentCanWinSoon) {
        const opponentCanStillWin = getValidColumns(blasted).some((col) => {
          const result = dropInColumn(blasted, col, humanPlayer);
          return result && hasConnect4(result[0], humanPlayer);
        });
        if (!opponentCanStillWin && adjustedScore > bestBlastScore) {
          bestBlastScore = adjustedScore + 500; // Big defensive bonus
          bestBlastRow = r;
          bestBlastCol = c;
          continue;
        }
      }

      if (adjustedScore > bestBlastScore) {
        bestBlastScore = adjustedScore;
        bestBlastRow = r;
        bestBlastCol = c;
      }
    }
  }

  if (bestBlastRow < 0) return null;

  // Easy mode: bot never uses blast token to keep difficulty low
  if (difficulty === "easy") return null;

  // Only blast if it's significantly better than the best drop, or if it's defensive
  const threshold = difficulty === "medium" ? 40 : 20;
  const shouldBlast = bestBlastScore > bestDropScore + threshold;

  return shouldBlast ? { shouldBlast: true, row: bestBlastRow, col: bestBlastCol } : null;
}