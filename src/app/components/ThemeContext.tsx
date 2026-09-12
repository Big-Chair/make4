import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export type Theme = "dark" | "light";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  toggleTheme: () => {},
  isDark: true,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("make4_theme") as Theme) || "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("make4_theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, isDark: theme === "dark" }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

/**
 * Returns CSS variable references for game UI colors.
 * Use these in inline `style` props to get automatic light/dark switching.
 */
export const g = {
  bg: "var(--g-bg)",
  bgElevated: "var(--g-bg-elevated)",
  surface: "var(--g-surface)",
  surfaceHover: "var(--g-surface-hover)",
  surfaceSubtle: "var(--g-surface-subtle)",
  surfaceFaint: "var(--g-surface-faint)",
  text: "var(--g-text)",
  textBright: "var(--g-text-bright)",
  textSecondary: "var(--g-text-secondary)",
  textMuted: "var(--g-text-muted)",
  textFaint: "var(--g-text-faint)",
  textDim: "var(--g-text-dim)",
  textGhost: "var(--g-text-ghost)",
  border: "var(--g-border)",
  borderSubtle: "var(--g-border-subtle)",
  borderLight: "var(--g-border-light)",
  borderHover: "var(--g-border-hover)",
  borderStrong: "var(--g-border-strong)",
  overlay: "var(--g-overlay)",
  overlayLight: "var(--g-overlay-light)",
  divider: "var(--g-divider)",
  dividerSubtle: "var(--g-divider-subtle)",
  inputBg: "var(--g-input-bg)",
  inputBorder: "var(--g-input-border)",
  inputText: "var(--g-input-text)",
  kbdBg: "var(--g-kbd-bg)",
  kbdText: "var(--g-kbd-text)",
  boardFrameStart: "var(--g-board-frame-start)",
  boardFrameEnd: "var(--g-board-frame-end)",
  boardBorder: "var(--g-board-border)",
  boardInnerStart: "var(--g-board-inner-start)",
  boardInnerEnd: "var(--g-board-inner-end)",
  boardInnerBorder: "var(--g-board-inner-border)",
  cellBorder: "var(--g-cell-border)",
  cellEmptyCenter: "var(--g-cell-empty-center)",
  cellEmptyEdge: "var(--g-cell-empty-edge)",
  cardRed: "var(--g-card-red)",
  cardYellow: "var(--g-card-yellow)",
  cardInactive: "var(--g-card-inactive)",
  winnerBgStart: "var(--g-winner-bg-start)",
  winnerBgEnd: "var(--g-winner-bg-end)",
  gridDot: "var(--g-grid-dot)",
  crossLine: "var(--g-cross-line)",
  feetColor: "var(--g-feet-color)",
  tooltipBg: "var(--g-tooltip-bg)",
  shadowSm: "var(--g-shadow-sm)",
  shadowMd: "var(--g-shadow-md)",
  shadowLg: "var(--g-shadow-lg)",
  shadowXl: "var(--g-shadow-xl)",
  yellow: "var(--g-yellow)",
  yellowMuted: "var(--g-yellow-muted)",
} as const;