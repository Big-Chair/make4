import type { TokenConfig } from "./TokenCustomizer";
import { getTokenVisuals } from "./TokenCustomizer";
import { g } from "./ThemeContext";

/**
 * A tiny token circle for leaderboard rows.
 * Renders the player's custom gradient/image/emoji at the given size.
 */
export function MiniToken({
  config,
  size = 22,
  playerColor = "red",
}: {
  config: TokenConfig;
  size?: number;
  playerColor?: "red" | "yellow";
}) {
  const tv = getTokenVisuals(config, playerColor);

  return (
    <div
      className="rounded-full relative overflow-hidden flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: tv.bg,
        border: `1.5px solid ${tv.highlight}`,
        boxShadow: `0 1px 4px ${g.shadowMd}, inset 0 1px 2px rgba(255,255,255,0.3)`,
      }}
    >
      {tv.imageUrl && (
        <img
          src={tv.imageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover rounded-full"
        />
      )}
      {tv.emoji && (
        <span
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{
            fontSize: size * 0.5,
            lineHeight: 1,
            textShadow: tv.imageUrl ? "0 1px 2px rgba(0,0,0,0.7)" : "none",
          }}
        >
          {tv.emoji}
        </span>
      )}
    </div>
  );
}