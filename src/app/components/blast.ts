import type { Board, CellValue } from "./useConnect4";

// The Blast mechanic — the single home for what a blast does to the board.
// Pure and in-process: no state, no I/O. The rules engine, the AI, and the
// board UI all cross this interface, so gravity and the blast radius live in
// exactly one place.

const ROWS = 6;
const COLS = 7;

function createEmptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

/** targets — cells a blast at (row, col) destroys: the center plus orthogonal neighbours holding a piece. */
export function blastTargets(board: Board, row: number, col: number): number[][] {
  if (board[row][col] === null) return [];

  const targets: number[][] = [[row, col]];
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // up, down, left, right

  for (const [dr, dc] of directions) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && board[nr][nc] !== null) {
      targets.push([nr, nc]);
    }
  }

  return targets;
}

/** Apply gravity: pieces fall down to fill gaps in each column. Internal to the blast mechanic. */
function applyGravity(board: Board): Board {
  const newBoard = createEmptyBoard();
  for (let c = 0; c < COLS; c++) {
    // Collect non-null pieces from bottom to top
    const pieces: CellValue[] = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[r][c] !== null) {
        pieces.push(board[r][c]);
      }
    }
    // Place them at the bottom
    for (let i = 0; i < pieces.length; i++) {
      newBoard[ROWS - 1 - i][c] = pieces[i];
    }
  }
  return newBoard;
}

/** apply — remove the blast targets at (row, col), then settle. Pure: returns a new board. */
export function applyBlast(board: Board, row: number, col: number): Board {
  const next = board.map((r) => [...r]);
  for (const [tr, tc] of blastTargets(board, row, col)) {
    next[tr][tc] = null;
  }
  return applyGravity(next);
}

/** score — heuristic pick of the most threatening opponent cell to blast (cursor suggestion + auto-blast). */
export function findBestBlastTarget(board: Board, currentPlayer: "red" | "yellow"): [number, number] | null {
  const opponent = currentPlayer === "red" ? "yellow" : "red";
  const rows = board.length;
  const cols = board[0].length;

  let bestScore = -1;
  let bestPos: [number, number] | null = null;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c] !== opponent) continue;

      let score = 0;
      const directions = [
        [0, 1], [1, 0], [1, 1], [1, -1],
      ];

      for (const [dr, dc] of directions) {
        let count = 1;
        for (let step = 1; step < 4; step++) {
          const nr = r + dr * step;
          const nc = c + dc * step;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc] === opponent) count++;
          else break;
        }
        for (let step = 1; step < 4; step++) {
          const nr = r - dr * step;
          const nc = c - dc * step;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc] === opponent) count++;
          else break;
        }
        if (count >= 3) score += 100;
        else if (count >= 2) score += 10;
        else score += 1;
      }

      // Prefer center columns slightly
      score += (3 - Math.abs(c - 3)) * 2;

      // Bonus: blasting this cell removes more opponent neighbors
      const targets = blastTargets(board, r, c);
      const opponentNeighbors = targets.filter(([tr, tc]) => board[tr][tc] === opponent).length;
      score += opponentNeighbors * 15;

      if (score > bestScore) {
        bestScore = score;
        bestPos = [r, c];
      }
    }
  }

  return bestPos;
}
