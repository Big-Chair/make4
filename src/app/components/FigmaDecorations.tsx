export function FigmaLogo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size * 1.5} viewBox="0 0 38 57" fill="none">
      <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE"/>
      <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83"/>
      <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262"/>
      <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E"/>
      <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF"/>
    </svg>
  );
}

export function FigmaCursor({ color = "#F24E1E", className = "" }: { color?: string; className?: string }) {
  return (
    <svg className={className} width="20" height="28" viewBox="0 0 20 28" fill="none">
      <path d="M1 1L19 12L10 14L7 27L1 1Z" fill={color} stroke="white" strokeWidth="1.5"/>
    </svg>
  );
}

export function GridDots({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="120" height="120" viewBox="0 0 120 120" fill="none" opacity="0.15">
      {Array.from({ length: 6 }).map((_, r) =>
        Array.from({ length: 6 }).map((_, c) => (
          <circle
            key={`${r}-${c}`}
            cx={10 + c * 22}
            cy={10 + r * 22}
            r="2"
            fill="var(--g-grid-dot)"
          />
        ))
      )}
    </svg>
  );
}

export function DiamondShape({ color = "#A259FF", className = "" }: { color?: string; className?: string }) {
  return (
    <svg className={className} width="40" height="40" viewBox="0 0 40 40" fill="none">
      <rect x="20" y="2" width="25" height="25" rx="3" transform="rotate(45 20 2)" fill={color} opacity="0.6"/>
    </svg>
  );
}

export function CrossShape({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" opacity="0.3">
      <line x1="12" y1="2" x2="12" y2="22" stroke="var(--g-cross-line)" strokeWidth="2" strokeLinecap="round"/>
      <line x1="2" y1="12" x2="22" y2="12" stroke="var(--g-cross-line)" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}