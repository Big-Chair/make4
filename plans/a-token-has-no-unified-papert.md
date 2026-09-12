# Give TokenConfig an owning module (`tokens.ts`)

## Context

`TokenConfig` (a player's board-piece appearance) has no owning module. Its three
responsibilities — **persistence**, **resolution**, and **rendering** — are smeared
across ~9 files, producing duplicated logic and a real user-visible bug:

- **Persistence** has three write paths with inconsistent name-casing: per-name
  localStorage (`make4_token_${name.trim().toLowerCase()}`), per-slot localStorage
  (`make4_p1Token`/`make4_p2Token`), and the server (`saveTokenConfig`). `App.tsx`
  writes to the server with the **raw** player name; `StartScreen.tsx` writes with a
  **lowercased** name.
- **Resolution** ("which token wins?") is implemented differently in two places:
  - `Leaderboard.tsx` resolves `server || localStorage`, but reads the server map by
    **raw** `player.name` (`:299`, `:337`) while its localStorage fallback normalizes
    to lowercase — a casing mismatch.
  - `LeaderboardDrawer.tsx` resolves **localStorage-only** and never consults the
    server map at all.
  → **The two leaderboards display different tokens for the same player.**
- **Rendering** is the one shared piece (`getTokenVisuals`), but the default red/yellow
  palette it returns is copy-pasted in ~5 more spots.

**Outcome:** one module owns the token seam. Callers get two verbs — `save()` and
`resolve()` — plus the existing pure `getTokenVisuals`. The leaderboard divergence and
the casing bug disappear by construction, and the default palette has a single source.

## Approach

Create `src/app/components/tokens.ts` as a **plain (non-React) module** and move the
leaf data + pure functions *down* into it. `TokenCustomizer.tsx` then depends *up* on
`tokens.ts` and re-exports the moved symbols for back-compat, so the ~14 existing
`from "./TokenCustomizer"` importers keep compiling unchanged. This direction is the
one that avoids a cycle: `tokens.ts` imports `saveTokenConfig` from `api.ts` (which has
no cycle back), and `tokens.ts` must **not** import `TokenCustomizer`.

### Module interface (`tokens.ts`)

Moved in from `TokenCustomizer.tsx` (and re-exported there):
- `interface TokenConfig`, `DEFAULT_TOKEN_RED`, `DEFAULT_TOKEN_YELLOW`
- `getTokenVisuals(config, color)` — unchanged behavior
- `getStoredTokenConfig(name): TokenConfig | null`

New:
- `DEFAULT_PALETTE` — single source for the red/yellow `{ bg, highlight, border, dark, glow }`
  values currently duplicated in `getTokenVisuals`, `GameBoard.tsx:46-47`,
  `GameUI.tsx:101-109` & `:614-615`, `GameScreen.tsx:386/431`, and TokenCustomizer's
  `defaultColors`. `getTokenVisuals` reads from it.
- `normalizeName(name): string` — the single `.trim().toLowerCase()` rule.
- `save(name, config, opts?: { slot?: "p1" | "p2"; toServer?: boolean }): void`
  — fans out to per-name localStorage, optional per-slot localStorage, and (when
  `toServer !== false`) the server via `saveTokenConfig`, all keyed through
  `normalizeName`.
- `resolve(name, serverConfigs?: Record<string, unknown>, fallbackColor?: "red" | "yellow"): TokenConfig`
  — single precedence: `serverConfigs[normalized] → localStorage[normalized] → default`,
  looking up the server map case-insensitively.

### Files to change (representative)

1. **`tokens.ts`** (new) — as above.
2. **`TokenCustomizer.tsx`** — remove the moved definitions; `import` + re-export them
   from `tokens.ts`; point its modal `defaultColors` at `DEFAULT_PALETTE`.
3. **`App.tsx:141-149`** — `handleP1/P2TokenChange` call `save(name, config)` (fixes the
   raw-name server-casing bug); drop the direct `saveTokenConfig` import.
4. **`Leaderboard.tsx`** (`:126`, `:299`, `:337`) — replace the `server || getStored`
   logic with `resolve(player.name, tokenConfigs, "red")`.
5. **`LeaderboardDrawer.tsx`** — capture `tokenConfigs` from its own `fetchLeaderboard`
   result (it already calls it, `:4`), thread it into `DrawerPlayerRow`, and replace
   `getStoredTokenConfig(player.name)` (`:40`) with `resolve(player.name, tokenConfigs)`.
   This is what unifies the two leaderboards.
6. **`StartScreen.tsx`** (`:120-124`, `:945-954`) and **`OnlineLobby.tsx`** (`:764-766`)
   — replace the hand-written localStorage/server writes with `save(...)`. OnlineLobby
   passes `{ toServer: false }` to preserve today's local-only lobby behavior.
7. **Palette de-dup** (last, zero visual risk — identical values): point the direct-read
   render sites (`GameBoard.tsx:46-47`, `GameUI.tsx:101-109`/`:614-615`,
   `GameScreen.tsx:386/431`) at `DEFAULT_PALETTE`.

### Migration order

Each step compiles standalone: (1) create `tokens.ts`; (2) re-export from
`TokenCustomizer`; (3) fix `App.tsx` casing; (4) route both leaderboards through
`resolve`; (5) migrate `StartScreen`/`OnlineLobby` writes to `save`; (6) de-dupe the
palette; (7) optional: repoint importers directly at `tokens.ts`.

## Decisions

- **OnlineLobby stays local-only** (`save(..., { toServer: false })`) — preserves
  current behavior.
- **Palette de-dup is included** in this change.

## Verification

No test suite exists (`package.json` has only `build`). After each step:

- `pnpm build` (i.e. `vite build`) / `tsc --noEmit` must pass.

Manual smoke test end-to-end:
1. **Board render** — set a custom gradient/emoji/image token; confirm pieces render it.
2. **Persistence round-trip** — set a token, reload; token survives (localStorage) and
   appears on the leaderboard (server).
3. **Cross-leaderboard parity** — the StartScreen leaderboard and the LeaderboardDrawer
   now show the *same* token for the same player, including mixed-case names.
4. **Online** — `token_sync` still shows the opponent's token in a live room.
5. **Default fallback** — a player with no stored/server config shows the default
   red/yellow token.


-A token has no owning module — Strong. Persistence, resolution, and rendering of TokenConfig are smeared across ~9 files, with three write paths and — the real bite — Leaderboard and LeaderboardDrawer resolve tokens differently (latent bug). A tokens.ts module (save/resolve/getVisuals) concentrates it. Done.

-StartScreen is a shallow god-component — Strong. 959 lines, four concerns, mostly-passthrough props; extract the name-entry modal, leaderboard panel, ticker.

-The bot decision is pure but the bug hides in the caller — Worth exploring. A fat useEffect (9-dep array + latch + randomized timeout) is where stale-closure/double-move races live; extract a pure decideBotMove(). Best testability win.

-View-extraction hygiene for GameScreen / GameUI — Worth exploring.

-useLeaderboard() hook to collapse App prop-drilling — Speculative (fold into #1).

-useOnlineGame minor smells — Speculative.
