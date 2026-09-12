# Make 4 — domain vocabulary

Shared nouns for the game. Use these names in code and discussion.

## Board & pieces
- **Board** — 6×7 grid of `CellValue` (`null | "red" | "yellow"`). Owned by the rules engine (`useConnect4`).
- **Drop** — placing a piece in a column; it falls to the lowest empty row.
- **Blast** — spending a one-per-player **Blast Token** to remove a target cell and its orthogonal neighbours, then re-settling the board with gravity.

## Match
- **Match** — one playable game session across any mode (local, bot, online), from the pre-game **countdown** through to a decided **winner**. The **move pipeline** that turns a player's intent into a board change.
- Implemented by `useMatch` (`src/app/components/useMatch.ts`) — a deep module over the rules engine (`useConnect4`), the AI (`connect4AI`), and the online transport (`useOnlineGame`).
- Interface: four verbs — `drop(col)`, `blast(row, col)`, `autoBlast()`, `reset()` — plus read-only board/turn/countdown/winner state for rendering.
- Invariants the Match owns so callers don't re-derive them:
  - turn legality (`isMyTurn`) — verbs are no-ops on the opponent's turn online;
  - broadcasting moves when an online transport is present;
  - replying as the bot;
  - applying the opponent's broadcast;
  - recording the winner exactly once (`onGameEnd`).
- `GameScreen` is the **render layer** over a Match: it holds only presentation state (Spotify, hand-tracking, leaderboard, token editor, SFX volume).

## Modes & roles
- **GameMode** — `"local" | "bot" | "online"`.
- **Role** — online players are `host` (red) or `guest` (yellow); `myColor` derives from role.
- **Room** — an online match's broadcast channel, created/joined via the Supabase edge function and synced over Realtime broadcast.
