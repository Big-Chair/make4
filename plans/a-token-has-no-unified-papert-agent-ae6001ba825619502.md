# Plan: Extract owning module `src/app/components/tokens.ts` for the TokenConfig subsystem

## Goal
Consolidate the TokenConfig subsystem (type, defaults, palette, visuals, 3 persistence
paths, resolution) into a single owning module `src/app/components/tokens.ts`, fix two
latent bugs (resolution divergence between the two leaderboards; save-casing
inconsistency in App.tsx), and de-duplicate the default red/yellow palette — all with
minimal churn to the ~14 import sites.

## Verified current state (exploration notes)
- `TokenCustomizer.tsx` is a NAMED export (no default). It owns: `TokenConfig` (:6-18),
  `DEFAULT_TOKEN_RED`/`DEFAULT_TOKEN_YELLOW` (:17-18), `getTokenVisuals` (:781-814),
  `getStoredTokenConfig` (:817-824). It imports `uploadTokenImage`, `getTokenImageUrl`
  from `./api`.
- Default red/yellow palette is duplicated in FIVE places, all byte-identical values
  (`bg`/`highlight`/`border`/`dark`/`glow`):
  - `TokenCustomizer.getTokenVisuals` :783-785
  - `TokenCustomizer.defaultColors` :290-292 (adds `accent` + `bg`)
  - `GameBoard.PLAYER_COLORS` :45-47
  - `GameUI` inline ternaries :101-109 and winner swatch :614-615
  - `GameScreen` inline swatches :386, :431
- Three persistence paths:
  - per-name LS key `make4_token_${name.trim().toLowerCase()}` — read canonically in
    `getStoredTokenConfig` (:819); written StartScreen :123-124, :947, :953,
    OnlineLobby :766.
  - per-slot LS keys `make4_p1Token`/`make4_p2Token` — read StartScreen :54,:60,
    OnlineLobby :44; written StartScreen :120-121,:945,:951, OnlineLobby :764.
  - server `saveTokenConfig(playerName, config)` (api.ts :146-154). Callers:
    App.tsx :143 & :148 pass RAW `player1Name`/`player2Name`; StartScreen :948,:954
    pass a lowercased `name`. => CASING INCONSISTENCY.
- Server read: `fetchLeaderboard` returns `tokenConfigs?: Record<string, any>`
  (api.ts :86-91, :112). Server keys are whatever casing was saved.
- Resolution divergence (the latent render bug):
  - `Leaderboard.tsx` :299 & :337-338 look up `tokenConfigs[player.name]` (RAW name)
    then `PlayerRow` (:126) falls back `serverTokenConfig || getStoredTokenConfig(name)`
    — and `getStoredTokenConfig` normalizes to lowercase. So the two halves of the
    fallback use different key casings.
  - `LeaderboardDrawer.tsx` :40 uses `getStoredTokenConfig(player.name)` ONLY — it
    never consults the server `tokenConfigs` map (the drawer doesn't even request/hold
    it). => The two leaderboards can show different tokens for the same player.
- Online sync: `useOnlineGame.sendTokenSync(config)` broadcasts
  `{type:"token_sync", tokenConfig}` (:165-172); received at :104-107; OnlineLobby
  wires it at :58, :65-66. This path is transport-only and does NOT touch persistence;
  leave it as-is (it already takes a `TokenConfig`).
- No cycle risk: `api.ts` imports only `../../../utils/supabase/info`. `tokens.ts` will
  import `api.ts` (one-way). `TokenCustomizer.tsx` will import from `tokens.ts`
  (one-way). tokens.ts must NOT import TokenCustomizer.
- No test suite. `package.json` has only `"build": "vite build"`. Verification = tsc/
  build via `pnpm build` + manual smoke test.
- 14 import sites reference `./TokenCustomizer` for token symbols (see step 5 list).

## Decision 1 — What physically moves vs. what is re-exported (Decision 2 answered)
RECOMMENDATION: physically MOVE `TokenConfig`, `DEFAULT_TOKEN_RED`,
`DEFAULT_TOKEN_YELLOW`, `getTokenVisuals`, `getStoredTokenConfig`, and a new
`DEFAULT_PALETTE` into `tokens.ts`. Then in `TokenCustomizer.tsx` re-export them for
back-compat:
```ts
export type { TokenConfig } from "./tokens";
export {
  DEFAULT_TOKEN_RED, DEFAULT_TOKEN_YELLOW,
  getTokenVisuals, getStoredTokenConfig, DEFAULT_PALETTE,
} from "./tokens";
```
Rationale:
- Avoids the circular import that the alternative (keep symbols in TokenCustomizer,
  add persistence layer in tokens.ts) would create: tokens.ts needs `TokenConfig` +
  defaults + `getTokenVisuals`, and TokenCustomizer needs the persistence verbs — a
  mutual dependency. Moving the leaf data/pure-functions DOWN into tokens.ts and having
  the component depend UP-the-graph on tokens.ts keeps the graph acyclic.
- Back-compat re-exports mean the ~14 existing `from "./TokenCustomizer"` importers keep
  compiling unchanged; we migrate them opportunistically, not in a big-bang.
- `getTokenVisuals`/`getStoredTokenConfig` are pure (no React, no component state), so
  they belong in a plain module, not a `.tsx` component file.

## Decision 2 — `tokens.ts` module interface (exact signatures)
```ts
// src/app/components/tokens.ts
import { saveTokenConfig as apiSaveTokenConfig } from "./api";

// ── Types ──
export interface TokenConfig {
  type: "default" | "gradient" | "emoji" | "image";
  gradient?: string;
  highlightColor?: string;
  borderColor?: string;
  darkColor?: string;
  glowColor?: string;
  emoji?: string;
  imageUrl?: string;
}

export type PlayerColor = "red" | "yellow";

// ── Defaults / palette (single source of truth) ──
export const DEFAULT_TOKEN_RED: TokenConfig = { type: "default" };
export const DEFAULT_TOKEN_YELLOW: TokenConfig = { type: "default" };

export interface PaletteEntry {
  bg: string; highlight: string; border: string; dark: string; glow: string;
}
// values copied verbatim from getTokenVisuals :783-785 / GameBoard PLAYER_COLORS
export const DEFAULT_PALETTE: Record<PlayerColor, PaletteEntry> = {
  red:    { bg: "radial-gradient(circle at 35% 35%, #FF7A7A, #F24E1E 60%, #D4401A)", highlight: "#FF7A7A", border: "#B8331A", dark: "#D4401A", glow: "#F24E1E" },
  yellow: { bg: "radial-gradient(circle at 35% 35%, #FFE082, #FFBF00 60%, #E6AC00)", highlight: "#FFE082", border: "#CC9900", dark: "#E6AC00", glow: "#FFBF00" },
};
export function defaultTokenFor(color: PlayerColor): TokenConfig {
  return color === "red" ? DEFAULT_TOKEN_RED : DEFAULT_TOKEN_YELLOW;
}

// ── Name normalization (the ONE canonical rule) ──
export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

// ── Rendering (moved verbatim from TokenCustomizer :781-814, using DEFAULT_PALETTE) ──
export function getTokenVisuals(config: TokenConfig, playerColor: PlayerColor): {
  bg: string; highlight: string; border: string; dark: string; glow: string;
  emoji: string | null; imageUrl: string | null;
};

// ── Persistence keys (internal) ──
// per-name: `make4_token_${normalizeName(name)}`
// per-slot: `make4_p1Token` | `make4_p2Token`

// ── Read: single precedence server[norm] -> localStorage[norm] -> default ──
export function getStoredTokenConfig(playerName: string): TokenConfig | null; // per-name LS only (back-compat, unchanged behavior)

export function resolve(
  name: string,
  serverConfigs?: Record<string, any> | null,
  fallbackColor?: PlayerColor,   // optional: return palette default token if nothing found
): TokenConfig {
  const key = normalizeName(name);
  // 1. server map — normalize BOTH the incoming keys and the lookup key so raw-cased
  //    server keys still match. Build a normalized view once:
  if (serverConfigs) {
    for (const k of Object.keys(serverConfigs)) {
      if (normalizeName(k) === key) return serverConfigs[k] as TokenConfig;
    }
  }
  // 2. localStorage per-name
  const local = getStoredTokenConfig(name);
  if (local) return local;
  // 3. default
  return fallbackColor ? defaultTokenFor(fallbackColor) : DEFAULT_TOKEN_RED;
}

// ── Write: fan out to per-name LS + server with ONE normalization ──
// slot is optional; when provided also writes the per-slot key for StartScreen/Lobby.
export function save(
  name: string,
  config: TokenConfig,
  opts?: { slot?: "p1" | "p2"; toServer?: boolean }, // toServer defaults true
): void {
  const key = normalizeName(name);
  try {
    if (opts?.slot) {
      localStorage.setItem(`make4_${opts.slot}Token`, JSON.stringify(config));
    }
    if (key) localStorage.setItem(`make4_token_${key}`, JSON.stringify(config));
  } catch { /* ignore quota/serialization */ }
  if (key && opts?.toServer !== false) apiSaveTokenConfig(key, config); // normalized
}

// ── Per-slot read helper for StartScreen/OnlineLobby initializers ──
export function getSlotToken(slot: "p1" | "p2"): TokenConfig | null; // reads make4_{slot}Token
```
Notes:
- `save` always writes the server with the NORMALIZED name, eliminating the App.tsx vs
  StartScreen casing split. Callers that only want local (OnlineLobby currently never
  hits the server) pass `{ toServer: false }` to preserve today's behavior, or we can
  choose to start syncing the lobby to the server (call out as a deliberate choice —
  recommend keeping `toServer:false` for OnlineLobby to avoid behavior change).
- `resolve` normalizes the server-map key comparison, which is the core fix for the
  Leaderboard casing mismatch.

## Decision 3 — Fix resolution divergence (route BOTH leaderboards through `resolve`)
- `Leaderboard.tsx`:
  - `PlayerRow` currently `serverTokenConfig || getStoredTokenConfig(player.name)`
    (:126). Change the parent (`Leaderboard` at :299/:337-338) to stop pre-indexing the
    raw-cased map; instead pass the whole `tokenConfigs` map down (or compute in the
    row) and resolve via `resolve(player.name, tokenConfigs)`. This makes the server
    lookup case-insensitive AND keeps the LS fallback, all in one precedence.
- `LeaderboardDrawer.tsx`:
  - It has no server map today. Thread `tokenConfigs` through: `LeaderboardDrawer`
    already calls `fetchLeaderboard` (:156) whose result includes `tokenConfigs`
    (api.ts :112) — capture it into state and pass to `DrawerPlayerRow`, which then
    calls `resolve(player.name, tokenConfigs)` instead of `getStoredTokenConfig`
    (:40). Now both leaderboards use identical precedence and the same data source.
- Net effect: identical token shown for a given player in both the inline leaderboard
  and the drawer, regardless of name casing.

## Decision 4 — Fix save-casing inconsistency (App.tsx)
- `App.handleP1TokenChange`/`handleP2TokenChange` (:141-149) call
  `saveTokenConfig(player1Name, config)` with the RAW name. Replace with
  `save(player1Name, config)` (and p2) which normalizes before hitting the server.
- Likewise migrate StartScreen `onSave` (:942-955) and its `onStart` persistence
  (:120-124) and OnlineLobby `onSave` (:762-767) to call `save(...)`, deleting the
  hand-rolled `localStorage.setItem` + `saveTokenConfig` blocks. Pass
  `{ slot: "p1" | "p2" }` where the per-slot key is needed; pass `{ toServer: false }`
  for OnlineLobby to preserve current (local-only) behavior.
- After this, every server write goes through `save` -> normalized name -> matches the
  key that `resolve` and `getStoredTokenConfig` read with.

## Decision 5 — Migration order (low-risk, incremental)
Each step compiles and runs on its own.
1. CREATE `tokens.ts` with: `TokenConfig`, defaults, `DEFAULT_PALETTE`, `normalizeName`,
   `getTokenVisuals` (moved verbatim, rewritten to read `DEFAULT_PALETTE`),
   `getStoredTokenConfig` (moved verbatim), `resolve`, `save`, `getSlotToken`,
   `defaultTokenFor`. Import `saveTokenConfig` from `./api`.
2. EDIT `TokenCustomizer.tsx`: delete the moved symbols (:6-18, :17-18, :781-824);
   add re-export lines from `./tokens`; change its internal `defaultColors` (:290-292)
   and `getPreviewBg` to derive from `DEFAULT_PALETTE[playerColor]` (keep the extra
   `accent` locally — `accent` is `F24E1E`/`FFBF00`, add as an optional field on
   PaletteEntry OR keep a tiny local map; recommend adding `accent` to PaletteEntry so
   it is also single-sourced). Verify build. (All 14 importers still work via
   re-exports.)
3. EDIT `App.tsx`: swap `saveTokenConfig(rawName,...)` -> `save(name,...)`; import from
   `./components/tokens`. (Fixes Decision 4 casing.)
4. EDIT `Leaderboard.tsx` + `LeaderboardDrawer.tsx`: route through `resolve`, thread
   `tokenConfigs` into the drawer. (Fixes Decision 3.)
5. EDIT `StartScreen.tsx` + `OnlineLobby.tsx`: replace inline LS writes with `save(...)`
   (slot + toServer opts); replace initializer `localStorage.getItem("make4_p1Token")`
   with `getSlotToken("p1")`. Update imports to `./tokens`.
6. DE-DUPLICATE palettes: point `GameBoard.PLAYER_COLORS` (:45-47), `GameUI` inline
   ternaries (:101-109, :614-615), `GameScreen` swatches (:386,:431) at
   `DEFAULT_PALETTE`. These are cosmetic-only refactors; values are already identical so
   there is zero visual risk. Do LAST so a mistake here can't block the bug fixes.
7. OPTIONAL cleanup: migrate the remaining 14 importers from `./TokenCustomizer` to
   `./tokens` for token symbols and drop the back-compat re-exports. Can be deferred.

Representative edits (not exhaustive):
- `App.tsx:143` `saveTokenConfig(player1Name, config)` -> `save(player1Name, config)`
- `StartScreen.tsx:945-948` (the 4-line block) -> `save(p1Name, config, { slot: "p1" })`
- `LeaderboardDrawer.tsx:40` `getStoredTokenConfig(player.name)` ->
  `resolve(player.name, tokenConfigs)` (+ capture `tokenConfigs` from fetch result)
- `GameBoard.tsx:45-47` `const PLAYER_COLORS = DEFAULT_PALETTE;`

## Decision 6 — Verification (no test suite)
Build/type:
- `pnpm build` (only script; runs `vite build` incl. TS). Must pass after each step.
- `pnpm exec tsc --noEmit` if a faster type-only check is wanted (tsc is present via
  vite toolchain).
Manual smoke (record before/after for parity):
1. Board render: start a local match, set a custom gradient + emoji for P1 and an image
   for P2; confirm tokens render on `GameBoard` and in `GameUI` HUD swatches and the
   `GameScreen` winner swatch — colors/gradient/emoji/image identical to before.
2. Persistence round-trip: customize a token, reload the page; StartScreen slot swatches
   (:417/:454) restore from `make4_p{1,2}Token`; confirm per-name key
   `make4_token_<lowercased>` present in `localStorage` (DevTools) and server received
   the normalized name (network tab: POST /save-token-config body `playerName` is
   lowercased).
3. Casing/leaderboard parity (the bug): play games as e.g. "Alice" and "alice"
   variations; open the inline leaderboard (StartScreen) AND the drawer; confirm the
   SAME token now shows in both for the same player, and that a server-saved token shows
   even when the local name casing differs (previously the drawer showed default / the
   inline showed a mismatch).
4. Online: create a room in one tab, join in another; customize the lobby token; confirm
   `token_sync` still propagates the opponent token (OnlineLobby :58/:65-66) and that
   lobby save still writes local keys (and, per chosen `toServer:false`, does NOT hit
   the server — unchanged from today).
5. Default fallback: a brand-new player name with no stored/server token renders the
   correct red/yellow default palette from `DEFAULT_PALETTE` in every surface.

## Risks / call-outs
- `PaletteEntry.accent` for TokenCustomizer: include it to keep a true single source, or
  the component keeps a 2-line local accent map. Recommend including `accent`.
- OnlineLobby server-sync: `save` defaults `toServer:true`; pass `toServer:false` there
  to avoid introducing new server writes (behavior-preserving). Flag for product if they
  actually WANT lobby tokens on the leaderboard.
- Back-compat re-exports keep churn low but leave two import paths temporarily; step 7
  removes them.

## Critical Files for Implementation
- /workspaces/default/code/src/app/components/tokens.ts (new owning module)
- /workspaces/default/code/src/app/components/TokenCustomizer.tsx (source of moved symbols + re-exports)
- /workspaces/default/code/src/app/components/Leaderboard.tsx (route through resolve)
- /workspaces/default/code/src/app/components/LeaderboardDrawer.tsx (route through resolve + thread tokenConfigs)
- /workspaces/default/code/src/app/App.tsx (fix save casing)
