# Make 4 — domain vocabulary

Shared nouns for the game. Use these names in code and discussion.

## Board & pieces
- **Board** — 6×7 grid of `CellValue` (`null | "red" | "yellow"`). Owned by the rules engine (`useConnect4`).
- **Drop** — placing a piece in a column; it falls to the lowest empty row.
- **Blast** — spending a one-per-player **Blast Token** to remove a target cell and its orthogonal neighbours, then re-settling the board with gravity.

## Match
- **Match** — one playable game session across any mode (local, bot, online), from the pre-game **countdown** through to a decided **winner**. The **move pipeline** that turns a player's intent into a board change.
- Implemented by `useMatch` (`src/app/components/useMatch.ts`) — a deep module over the rules engine (`useConnect4`), the AI (`connect4AI`), and the online transport (`OnlineMatchTransport`).
- Interface: four verbs — `drop(col)`, `blast(row, col)`, `autoBlast()`, `reset()` — plus read-only board/turn/countdown/winner state for rendering.
- Invariants the Match owns so callers don't re-derive them:
  - turn legality (`isMyTurn`) — verbs are no-ops on the opponent's turn online;
  - broadcasting moves when an online transport is present;
  - replying as the bot;
  - applying the opponent's broadcast;
  - recording the winner at most once per Match identity (`onGameEnd`).
- `GameScreen` is the **render layer** over a Match: it holds only presentation state (Spotify, hand-tracking, leaderboard, token editor, SFX volume).

## Modes & roles
- **GameMode** — `"local" | "bot" | "online"`.
- **Role** — online players are `host` (red) or `guest` (yellow); `myColor` derives from role.
- **Room** — an online Match's channel, created/joined via the Supabase edge function and synced over Realtime. Owned by the **Room Module** (`useRoom`), whose seam and protocol live in `room.ts` and whose Supabase implementation is `roomSupabaseAdapter.ts`.

## Room
- **Room Module** — `useRoom` owns create/join orchestration, subscription state, Presence-derived liveness, participant projection, Player Token synchronization, cleanup, and readiness. Render Modules consume its discriminated `RoomState` (`idle | creating | joining | waiting | synchronizing | ready | interrupted | failed`); nothing else assembles Match inputs.
- **Ready Room** — the only shape an online Match may start from. It exists only when (1) the persisted Room is `playing`, (2) the local Realtime channel is `SUBSCRIBED`, (3) the local Role is known, (4) persisted host and guest names and timer are known, and (5) Presence confirms both host and guest liveness. Readiness is emitted once per Room generation.
- Persisted Room data is **authoritative** for status, Role projection, player names, timer, and Blast-token configuration. **Presence proves liveness only** — it never overrides persisted participant identity.
- **Player Token** — a player's cosmetic board-piece appearance (`TokenConfig`). Live Room state, never part of readiness: a missing token renders the Role's colour default, and a later one updates the active projection without restarting the Match. Broadcast (`token-sync`) gives the peer an immediate update; Presence carries the latest token for reconciliation after subscription or reconnect.
- **Room protocol** — every Presence and Broadcast payload carries `protocolVersion: 1` and is decoded at the Room seam (`room.ts`). Malformed or unknown payloads are ignored and logged; application code never casts a raw payload.
- **Match transport** (`OnlineMatchTransport`) — the only Room seam the Match sees: `role`, a live `status` (`ready | interrupted | resynchronizing`), `send`, `subscribe`, plus `interrupt`, `resume`, and `fail` so the Match can report divergence and snapshot acknowledgement. Its identity is stable for one Room generation. The Match never receives Room creation, joining, Player Token, invitation, or Supabase state.
- **Match revision** — online, each successfully applied Drop or Blast advances the revision and is broadcast with it; rejected local actions do neither. An incoming action applies only at exactly revision + 1; anything else **interrupts** the Room (`interrupted`, reason `revision-gap`) and pauses Match input and its timer.
- **Match Snapshot** (`matchSnapshot.ts`) — the host-authoritative Match at one revision: identity, revision, Board, current player, winner, winning cells, both Blast Tokens, timer, countdown. The Match creates, decodes, and restores it; the Room carries it opaquely. The guest requests it (the host pushes it when the host saw the gap), restores it atomically, and acknowledges the revision; neither peer resumes before that acknowledgement. A decode failure or a missed 20-second resynchronization deadline is a `resync-failed` Room failure.
- **Match identity** — both peers start a Room's first Match as the same identity; a rematch mints a fresh one and resets the revision to zero. A winner is recorded at most once per Match identity, so restoring a decided snapshot never records it again.
- **Room failure** — failures are values (`create-failed`, `join-failed`, `subscription-failed`, `room-unavailable`, `peer-timeout`, `resync-failed`), not inferred strings.
- Only the **host** persists an online Match result; both peers update their local display score.
