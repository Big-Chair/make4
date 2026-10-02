import type { LucideIcon } from "lucide-react";
import { g } from "./ThemeContext";

/** An on/off setting row: icon, on/off text, and a switch tinted with `accent` (a hex colour). */
export function SettingSwitch({
  on,
  onToggle,
  label,
  onText,
  offText,
  icon: Icon,
  offIcon: OffIcon = Icon,
  accent,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  onText: string;
  offText: string;
  icon: LucideIcon;
  offIcon?: LucideIcon;
  accent: string;
}) {
  const ShownIcon = on ? Icon : OffIcon;
  return (
    <div className="flex-1 flex items-center gap-2.5">
      <ShownIcon size={18} color={on ? accent : g.textDim} />
      <span className="text-base font-medium transition-colors duration-200" style={{ color: on ? g.textSecondary : g.textFaint }}>
        {on ? onText : offText}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onToggle}
        className="ml-auto relative cursor-pointer flex items-center flex-shrink-0"
        style={{
          width: "44px",
          height: "24px",
          borderRadius: "12px",
          background: on ? `${accent}4D` : g.surfaceHover,
          border: on ? `1px solid ${accent}66` : `1px solid ${g.borderLight}`,
          transition: "all 0.25s ease",
          padding: 0,
        }}
      >
        <div
          style={{
            width: "18px",
            height: "18px",
            borderRadius: "50%",
            background: on ? accent : g.textFaint,
            boxShadow: on ? `0 0 8px ${accent}80` : "none",
            marginLeft: on ? "23px" : "3px",
            transition: "all 0.25s ease",
          }}
        />
      </button>
    </div>
  );
}
