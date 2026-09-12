# Plan — Candidate 3: consolidate the Blast mechanic into one module

## Context

The Blast mechanic is spread across two files with a duplicated board transform. Today:

- `useConnect4.ts` exports `getBlastTargets`, `applyGravity`, `findBestBlastTarget`, and the `blastPiece` hook callback inlines "remove targets → settle".
- `connect4AI.ts` has a **private `simulateBlast`** that re-implements the exact same "remove targets → `applyGravity`" composition, plus the AI decision `getBestBlastMove`.

So three callers (the rules engine, the AI, the board UI) each know how a blast reshapes the grid, and the settle-after-blast logic exists twice. There is no single home for "what a blast does."

**Outcome:** one in-process `blast` module owning the board mechanics — `blastTargets` / `applyBlast` / `findBestBlastTarget` — with `applyGravity` hidden inside it. Gravity stops being shared knowledge; `simulateBlast` is deleted; the rules engine, AI, and UI all cross the same interface. This is a pure, behavior-preserving refactor (in-process; no I/O, no state moved).

The AI's strategic decision `getBestBlastMove` (and `BlastDecision`) **stays in `connect4AI.ts`** — it is minimax-coupled (`evaluateBoard`, `minimax`, `DEPTH_MAP`), and moving it would create a circular dependency with the AI internals. It simply consumes the new blast interface.

## New file: `src/app/components/blast.ts`

Type-only import of `Board`/`CellValue` from `useConnect4` (erased at runtime → no import cycle). Defines `ROWS`/`COLS` locally, matching the existing per-file pattern.

```ts
import type { Board, CellValue } from "./useConnect4";

// targets — cells a blast at (row,col) destroys: center + orthogonal neighbours holding a piece
export function blastTargets(board: Board, row: number, col: number): number[][]   // = today's getBlastTargets

// apply — remove targets, then settle. Pure: returns a new board. Replaces simulateBlast + blastPiece's inline body.
export function applyBlast(board: Board, row: number, col: number): Board {
  const next = board.map((r) => [...r]);
  for (const [tr, tc] of blastTargets(board, row, col)) next[tr][tc] = null;
  return applyGravity(next);
}

// score — heuristic pick of the most threatening cell to blast (cursor suggestion + auto-blast)
export function findBestBlastTarget(board: Board, currentPlayer: "red" | "yellow"): [number, number] | null  // moved verbatim; internal getBlastTargets call → blastTargets

// internal — gravity is now private to the blast mechanic
function applyGravity(board: Board): Board   // moved verbatim from useConnect4
```

Bodies of `blastTargets`, `applyGravity`, `findBestBlastTarget` move **verbatim** from `useConnect4.ts` (lines 130–145, 148–164, 167–219).

## Edits to existing files

- **`useConnect4.ts`** — delete the three exports (`getBlastTargets`, `applyGravity`, `findBestBlastTarget`) and add `import { applyBlast } from "./blast";`. In `blastPiece` (lines ~300–311) replace the `getBlastTargets` + manual-removal + `applyGravity` block with `const settledBoard = applyBlast(board, row, col);`. Keep the existing `if (board[row][col] === null) return false;` guard (preserves "don't spend the token on an empty cell") and the win-after-blast `checkWin` logic — win detection stays in the rules engine.

- **`connect4AI.ts`** — change `import { Board, CellValue, getBlastTargets, hasConnect4, applyGravity } from "./useConnect4";` to `import { Board, CellValue, hasConnect4 } from "./useConnect4";` + `import { blastTargets, applyBlast } from "./blast";`. Delete `simulateBlast` (lines 181–188); at line 228 use `applyBlast(board, r, c)`; at line 255 use `blastTargets(board, r, c)`. `getBestBlastMove`/`BlastDecision` otherwise unchanged.

- **`GameBoard.tsx`** — line 5: `import { blastTargets, findBestBlastTarget } from "./blast";` (was from `./useConnect4`; the `type { Board, CellValue }` import on line 4 stays). Line ~195: `getBlastTargets(...)` → `blastTargets(...)`.

- **`useMatch.ts`** — drop `findBestBlastTarget` from the `./useConnect4` import block (keep `useConnect4`, `type Board`, `type CellValue`) and add `import { findBestBlastTarget } from "./blast";`. Call site at line ~276 unchanged.

Rename note: `getBlastTargets` → `blastTargets` to match the `targets / apply / score` trio; the two external call sites (GameBoard, connect4AI) are updated above.

## Verification (manual — no test runner / tsc in this Vite/esbuild env)

1. Dev server is already running; use the preview surface.
2. **Blast still works:** local game → earn/keep a Blast Token, enter blast mode (`0` / button), target a piece; confirm the center + orthogonal neighbours clear, remaining pieces fall (gravity), and the token is consumed once. Confirm a blast that completes four-in-a-row registers a win (win-after-blast path).
3. **Cursor/auto-blast heuristic:** keyboard blast-cursor still initializes on the most threatening cell; camera fist auto-blast (desktop) picks a sensible target — both exercise `findBestBlastTarget` via the new module.
4. **AI blast:** play vs bot (medium/hard) and confirm it still occasionally blasts (exercises `getBestBlastMove` → `applyBlast`/`blastTargets`); easy never blasts.
5. **Grep sanity:** no remaining references to `getBlastTargets`, `applyGravity`, or `simulateBlast` outside `blast.ts`; `useConnect4` no longer exports them.

## Files
- Create: `src/app/components/blast.ts`
- Modify: `src/app/components/useConnect4.ts`, `src/app/components/connect4AI.ts`, `src/app/components/GameBoard.tsx`, `src/app/components/useMatch.ts`
