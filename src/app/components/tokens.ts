import { saveTokenConfig } from "./api";

export interface TokenConfig {
  type: "default" | "gradient" | "emoji" | "image";
  gradient?: string;
  highlightColor?: string;
  borderColor?: string;
  darkColor?: string;
  glowColor?: string;
  emoji?: string; // can now combine with any background type
  imageUrl?: string;
}

export const DEFAULT_TOKEN_RED: TokenConfig = { type: "default" };
export const DEFAULT_TOKEN_YELLOW: TokenConfig = { type: "default" };

/** The default board-piece palette per color — single source for the values that
 *  were previously copy-pasted across GameBoard, GameUI, GameScreen, TokenCustomizer
 *  and getTokenVisuals. `accent` is used by the customizer modal only. */
export const DEFAULT_PALETTE: Record<
  "red" | "yellow",
  { bg: string; highlight: string; border: string; dark: string; glow: string; accent: string }
> = {
  red: {
    bg: "radial-gradient(circle at 35% 35%, #FF7A7A, #F24E1E 60%, #D4401A)",
    highlight: "#FF7A7A",
    border: "#B8331A",
    dark: "#D4401A",
    glow: "#F24E1E",
    accent: "#F24E1E",
  },
  yellow: {
    bg: "radial-gradient(circle at 35% 35%, #FFE082, #FFBF00 60%, #E6AC00)",
    highlight: "#FFE082",
    border: "#CC9900",
    dark: "#E6AC00",
    glow: "#FFBF00",
    accent: "#FFBF00",
  },
};

/** The one name-normalization rule for every token key (localStorage + server). */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function defaultTokenFor(color: "red" | "yellow"): TokenConfig {
  return color === "red" ? DEFAULT_TOKEN_RED : DEFAULT_TOKEN_YELLOW;
}

/** Helper to get the visual properties for a token config to render on the board */
export function getTokenVisuals(config: TokenConfig, playerColor: "red" | "yellow") {
  const p = DEFAULT_PALETTE[playerColor];
  const defaults = { bg: p.bg, highlight: p.highlight, border: p.border, dark: p.dark, glow: p.glow };

  // Emoji is now cross-cutting — available on any type
  const emoji = config.emoji || null;

  if (config.type === "gradient" && config.gradient) {
    return {
      bg: config.gradient,
      highlight: config.highlightColor || defaults.highlight,
      border: config.borderColor || defaults.border,
      dark: config.darkColor || defaults.dark,
      glow: config.glowColor || defaults.glow,
      emoji,
      imageUrl: null as string | null,
    };
  }
  if (config.type === "image" && config.imageUrl) {
    return {
      bg: "rgba(30,30,30,0.8)",
      highlight: defaults.highlight,
      border: defaults.border,
      dark: defaults.dark,
      glow: defaults.glow,
      emoji,
      imageUrl: config.imageUrl,
    };
  }
  // "default" or legacy "emoji" type
  return { ...defaults, emoji, imageUrl: null as string | null };
}

const nameKey = (name: string) => `make4_token_${normalizeName(name)}`;
const slotKey = (slot: "p1" | "p2") => (slot === "p1" ? "make4_p1Token" : "make4_p2Token");

/** Look up a player's token config from localStorage by name */
export function getStoredTokenConfig(playerName: string): TokenConfig | null {
  try {
    const stored = localStorage.getItem(nameKey(playerName));
    if (stored) return JSON.parse(stored) as TokenConfig;
  } catch { /* ignore */ }
  return null;
}

/** Read the per-slot token (used to seed the customizer before a name is known). */
export function getSlotToken(slot: "p1" | "p2"): TokenConfig | null {
  try {
    const stored = localStorage.getItem(slotKey(slot));
    if (stored) return JSON.parse(stored) as TokenConfig;
  } catch { /* ignore */ }
  return null;
}

/** Persist a token config. Fans out to per-name localStorage, an optional per-slot
 *  localStorage entry, and (unless disabled) the server — all keyed consistently. */
export function save(
  name: string,
  config: TokenConfig,
  opts?: { slot?: "p1" | "p2"; toServer?: boolean },
): void {
  const normalized = normalizeName(name);
  try {
    if (normalized) localStorage.setItem(nameKey(name), JSON.stringify(config));
    if (opts?.slot) localStorage.setItem(slotKey(opts.slot), JSON.stringify(config));
  } catch { /* ignore */ }
  if (normalized && opts?.toServer !== false) {
    saveTokenConfig(normalized, config);
  }
}

/** Resolve which token a player should display. Single precedence:
 *  server (case-insensitive) → localStorage → default. */
export function resolve(
  name: string,
  serverConfigs?: Record<string, unknown>,
  fallbackColor: "red" | "yellow" = "red",
): TokenConfig {
  const normalized = normalizeName(name);
  if (serverConfigs) {
    for (const key of Object.keys(serverConfigs)) {
      if (normalizeName(key) === normalized) {
        const cfg = serverConfigs[key];
        if (cfg) return cfg as TokenConfig;
      }
    }
  }
  return getStoredTokenConfig(name) ?? defaultTokenFor(fallbackColor);
}
