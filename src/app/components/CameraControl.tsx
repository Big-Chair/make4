import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Loader2, X } from "lucide-react";
import type { Gesture, HandTrackingState } from "./useHandTracking";
import type { Board, CellValue } from "./useConnect4";
import { playDrop, playHover, playBlast } from "./useSoundEffects";

// --- Hand skeleton connections for drawing ---
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

function getGestureLabel(gesture: Gesture): { label: string; color: string; emoji: string } {
  const labels: Record<Gesture, { label: string; color: string; emoji: string }> = {
    point:     { label: "Aiming",         color: "#1ABCFE",               emoji: "☝️" },
    pointdown: { label: "Drop!",          color: "#0ACF83",               emoji: "☝️⬇" },
    open:      { label: "Open hand",      color: "#0ACF83",               emoji: "🖐️" },
    fist:      { label: "Punch! 💥",      color: "#A259FF",               emoji: "✊" },
    thumbsup:  { label: "Thumbs up!",     color: "#FFBF00",               emoji: "👍" },
    none:      { label: "No hand detected", color: "rgba(255,255,255,0.3)", emoji: "  " },
  };
  return labels[gesture];
}

interface CameraControlProps {
  tracking: HandTrackingState;
  blastMode: boolean;
  currentPlayer: "red" | "yellow";
  soundEnabled: boolean;
  onDrop: (col: number) => void;
  onAutoBlast: () => void;
  onRematch?: () => void;
  disabled: boolean;
  winner: CellValue | "draw";
  board: Board;
  hasBlastToken: boolean;
}

export function CameraControl({
  tracking,
  blastMode,
  currentPlayer,
  soundEnabled,
  onDrop,
  onAutoBlast,
  onRematch,
  disabled,
  winner,
  board,
  hasBlastToken,
}: CameraControlProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastActionTimeRef = useRef(0);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Track previous gesture to detect transitions
  const prevGestureRef = useRef<Gesture>("none");

  const ACTION_COOLDOWN = 700; // ms between actions

  // Draw hand skeleton on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!tracking.landmarks) return;

    const lms = tracking.landmarks;
    const w = canvas.width;
    const h = canvas.height;

    // Gesture-based color
    const gestureColor =
      tracking.gesture === "fist" ? "#A259FF" :
      tracking.gesture === "pointdown" ? "#0ACF83" :
      tracking.gesture === "point" ? "#1ABCFE" :
      tracking.gesture === "thumbsup" ? "#FFBF00" :
      tracking.gesture === "open" ? "#0ACF83" : "rgba(255,255,255,0.3)";

    // Draw connections
    ctx.strokeStyle = `${gestureColor}99`;
    ctx.lineWidth = 2;
    for (const [i, j] of HAND_CONNECTIONS) {
      if (lms[i] && lms[j]) {
        ctx.beginPath();
        ctx.moveTo((1 - lms[i][0]) * w, lms[i][1] * h);
        ctx.lineTo((1 - lms[j][0]) * w, lms[j][1] * h);
        ctx.stroke();
      }
    }

    // Draw landmarks
    for (let i = 0; i < lms.length; i++) {
      const [x, y] = lms[i];
      ctx.beginPath();
      ctx.arc((1 - x) * w, y * h, [4, 8, 12, 16, 20].includes(i) ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = [4, 8, 12, 16, 20].includes(i) ? gestureColor : "rgba(255,255,255,0.6)";
      ctx.fill();
    }

    // Directional indicator from index fingertip
    if (tracking.gesture === "point" || tracking.gesture === "pointdown") {
      const tipX = (1 - lms[8][0]) * w;
      const tipY = lms[8][1] * h;

      if (tracking.gesture === "pointdown") {
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX, Math.min(h, tipY + 25));
        ctx.strokeStyle = "#0ACF83";
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(tipX - 6, tipY + 17);
        ctx.lineTo(tipX, tipY + 27);
        ctx.lineTo(tipX + 6, tipY + 17);
        ctx.strokeStyle = "#0ACF83";
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX, Math.max(0, tipY - 20));
        ctx.strokeStyle = "#1ABCFE";
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(tipX - 5, tipY - 14);
        ctx.lineTo(tipX, tipY - 22);
        ctx.lineTo(tipX + 5, tipY - 14);
        ctx.strokeStyle = "#1ABCFE";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Fist punch burst effect — radiating lines from wrist center
    if (tracking.gesture === "fist") {
      const wristX = (1 - lms[0][0]) * w;
      const wristY = lms[0][1] * h;
      const burstRadius = 30;
      const rays = 8;

      for (let i = 0; i < rays; i++) {
        const angle = (i / rays) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(
          wristX + Math.cos(angle) * 12,
          wristY + Math.sin(angle) * 12
        );
        ctx.lineTo(
          wristX + Math.cos(angle) * burstRadius,
          wristY + Math.sin(angle) * burstRadius
        );
        ctx.strokeStyle = "rgba(162,89,255,0.5)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(wristX, wristY, 16, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(162,89,255,0.4)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }, [tracking.landmarks, tracking.gesture]);

  // --- Gesture transition → action state machine ---
  useEffect(() => {
    if (!tracking.isTracking) {
      prevGestureRef.current = "none";
      return;
    }

    const now = performance.now();
    const prev = prevGestureRef.current;
    const curr = tracking.gesture;

    // Detect transitions only
    if (prev === curr) return;

    const cooldownOk = now - lastActionTimeRef.current > ACTION_COOLDOWN;

    // --- THUMBS UP or OPEN HAND → REMATCH (only on winner screen) ---
    if ((curr === "thumbsup" || curr === "open") && winner && onRematch && cooldownOk) {
      lastActionTimeRef.current = now;
      setActionFeedback("REMATCH!");
      setTimeout(() => setActionFeedback(null), 1000);
      if (soundEnabled) playHover();
      setTimeout(() => onRematch(), 400);
      prevGestureRef.current = curr;
      return;
    }

    if (disabled || winner) {
      prevGestureRef.current = curr;
      return;
    }

    // --- FIST = Auto-blast best target ---
    if (curr === "fist" && hasBlastToken && cooldownOk) {
      lastActionTimeRef.current = now;
      onAutoBlast();
      if (soundEnabled) playBlast();
      setActionFeedback("BLAST! 💥");
      setTimeout(() => setActionFeedback(null), 1000);
      prevGestureRef.current = curr;
      return;
    }

    // --- POINTDOWN = DROP piece (sustained downward finger movement) ---
    if (curr === "pointdown" && cooldownOk) {
      lastActionTimeRef.current = now;
      onDrop(tracking.selectedCol);
      if (soundEnabled) playDrop();
      setActionFeedback(`Drop col ${tracking.selectedCol + 1}`);
      setTimeout(() => setActionFeedback(null), 800);
      prevGestureRef.current = curr;
      return;
    }

    prevGestureRef.current = curr;
  }, [
    tracking.gesture,
    tracking.isTracking,
    tracking.selectedCol,
    disabled,
    winner,
    hasBlastToken,
    board,
    onDrop,
    onAutoBlast,
    onRematch,
    soundEnabled,
  ]);

  const gestureInfo = getGestureLabel(tracking.gesture);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 20 }}
      className="fixed bottom-20 left-4 z-50 flex flex-col items-start gap-2"
    >
      {/* Camera PiP */}
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{
          width: "220px",
          height: "165px",
          background: "#0A0A0A",
          border: `2px solid ${gestureInfo.color}50`,
          boxShadow: `0 8px 32px ${g.shadowLg}, 0 0 20px ${gestureInfo.color}15`,
          transition: "border-color 0.3s, box-shadow 0.3s",
        }}
      >
        {/* Video (mirrored) */}
        <video
          ref={tracking.videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: "scaleX(-1)", opacity: 0.65 }}
          autoPlay
          playsInline
          muted
        />

        {/* Hand skeleton overlay */}
        <canvas
          ref={canvasRef}
          width={220}
          height={165}
          className="absolute inset-0 w-full h-full"
        />

        {/* Action feedback flash */}
        <AnimatePresence>
          {actionFeedback && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.2 }}
              className="absolute inset-0 flex items-center justify-center"
              style={{ background: "rgba(0,0,0,0.5)" }}
            >
              <span
                className="text-lg font-bold px-4 py-1.5 rounded-xl"
                style={{
                  color: actionFeedback.includes("BLAST")
                    ? "#A259FF"
                    : actionFeedback.includes("REMATCH")
                    ? "#FFBF00"
                    : "#0ACF83",
                  background: "rgba(0,0,0,0.6)",
                  border: `1px solid ${
                    actionFeedback.includes("BLAST")
                      ? "rgba(162,89,255,0.4)"
                      : actionFeedback.includes("REMATCH")
                      ? "rgba(255,191,0,0.4)"
                      : "rgba(10,207,131,0.4)"
                  }`,
                }}
              >
                {actionFeedback}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Loading overlay */}
        {tracking.isLoading && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }}>
            <Loader2 size={24} color="#A259FF" className="animate-spin" />
            <span className="ml-2 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
              Loading hand tracking...
            </span>
          </div>
        )}

        {/* Camera badge */}
        <div
          className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-lg"
          style={{
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: tracking.isTracking ? "#0ACF83" : "#F24E1E",
              boxShadow: tracking.isTracking ? "0 0 6px #0ACF83" : "none",
            }}
          />
          <span className="text-sm uppercase tracking-[1px]" style={{ color: "rgba(255,255,255,0.6)" }}>
            {tracking.isTracking ? "Live" : "Off"}
          </span>
        </div>

        {/* Close button */}
        <button
          onClick={tracking.stop}
          className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer"
          style={{
            background: "rgba(0,0,0,0.6)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <X size={12} color="rgba(255,255,255,0.5)" />
        </button>
      </div>

      {/* Gesture indicator bar */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-xl w-[220px]"
        style={{
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(8px)",
          border: `1px solid ${gestureInfo.color}30`,
        }}
      >
        <span className="text-sm leading-none">{gestureInfo.emoji}</span>
        <span className="text-sm font-medium flex-1" style={{ color: gestureInfo.color }}>
          {gestureInfo.label}
        </span>
        {tracking.confidence > 0 && (
          <span className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
            {Math.round(tracking.confidence * 100)}%
          </span>
        )}
      </div>

      {/* Gesture guide — contextual based on game state */}
      <div
        className="flex flex-col gap-1.5 px-3 py-2.5 rounded-xl w-[220px]"
        style={{
          background: "rgba(0,0,0,0.4)",
          backdropFilter: "blur(4px)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <span className="text-sm uppercase tracking-[1px] mb-0.5" style={{ color: "rgba(255,255,255,0.25)" }}>
          Hand Controls
        </span>
        {winner ? (
          <>
            <GestureRow emoji="&#x1F590;&#xFE0F;" gesture="Open hand" action="Rematch" color="#0ACF83" />
            <GestureRow emoji="👍" gesture="Thumbs up" action="Rematch" color="#FFBF00" />
          </>
        ) : (
          <>
            <GestureRow emoji="☝️" gesture="Point" action="Select column" color="#1ABCFE" active={tracking.gesture === "point"} />
            <GestureRow emoji="☝️⬇" gesture="Push down" action="Drop piece" color="#0ACF83" active={tracking.gesture === "pointdown"} />
            <GestureRow emoji="✊" gesture="Punch" action="Auto-blast" color="#A259FF" dim={!hasBlastToken} active={tracking.gesture === "fist"} />
          </>
        )}
      </div>
    </motion.div>
  );
}

function GestureRow({ emoji, gesture, action, color, active, dim }: {
  emoji: string;
  gesture: string;
  action: string;
  color: string;
  active?: boolean;
  dim?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-1.5 py-0.5"
      style={{
        background: active ? `${color}10` : "transparent",
        opacity: dim ? 0.4 : 1,
        transition: "background 0.2s, opacity 0.2s",
      }}
    >
      <span className="text-sm leading-none w-[18px] text-center">{emoji}</span>
      <span className="text-sm flex-1" style={{ color: "rgba(255,255,255,0.45)" }}>{gesture}</span>
      <span className="text-sm font-medium" style={{ color }}>{action}</span>
    </div>
  );
}