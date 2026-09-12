/**
 * Desktop-only wrapper that encapsulates useHandTracking + CameraControl.
 * This module is lazy-loaded so that mobile devices never pull in the
 * MediaPipe dependency graph or CameraControl rendering code.
 */
import { useEffect, useRef } from "react";
import { AnimatePresence } from "motion/react";
import { useHandTracking, type HandTrackingState } from "./useHandTracking";
import { CameraControl } from "./CameraControl";
import type { Board, CellValue } from "./useConnect4";

export interface DesktopHandTrackingProps {
  /** Callback to sync hand-tracking state up to the parent. */
  onStateSync: (state: HandTrackingState) => void;
  blastMode: boolean;
  currentPlayer: "red" | "yellow";
  soundEnabled: boolean;
  onDrop: (col: number) => void;
  onAutoBlast: () => void;
  onRematch: () => void;
  disabled: boolean;
  winner: CellValue | "draw";
  board: Board;
  hasBlastToken: boolean;
}

export default function DesktopHandTracking({
  onStateSync,
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
}: DesktopHandTrackingProps) {
  const handTracking = useHandTracking();

  // Sync hand-tracking state to parent. We track individual values to avoid
  // infinite loops: only call setState when something actually changed.
  const cbRef = useRef(onStateSync);
  cbRef.current = onStateSync;
  const prevTracking = useRef(false);
  const prevLoading = useRef(false);
  const prevError = useRef<string | null>(null);
  const prevCol = useRef(3);
  const prevGesture = useRef("none");
  const prevBlastR = useRef<number | null>(null);
  const prevBlastC = useRef<number | null>(null);

  useEffect(() => {
    const blastR = handTracking.blastCursor?.[0] ?? null;
    const blastC = handTracking.blastCursor?.[1] ?? null;
    if (
      prevTracking.current !== handTracking.isTracking ||
      prevLoading.current !== handTracking.isLoading ||
      prevError.current !== handTracking.error ||
      prevCol.current !== handTracking.selectedCol ||
      prevGesture.current !== handTracking.gesture ||
      prevBlastR.current !== blastR ||
      prevBlastC.current !== blastC
    ) {
      prevTracking.current = handTracking.isTracking;
      prevLoading.current = handTracking.isLoading;
      prevError.current = handTracking.error;
      prevCol.current = handTracking.selectedCol;
      prevGesture.current = handTracking.gesture;
      prevBlastR.current = blastR;
      prevBlastC.current = blastC;
      cbRef.current(handTracking);
    }
  });

  return (
    <AnimatePresence>
      {handTracking.isTracking && (
        <CameraControl
          tracking={handTracking}
          blastMode={blastMode}
          currentPlayer={currentPlayer}
          soundEnabled={soundEnabled}
          onDrop={onDrop}
          onAutoBlast={onAutoBlast}
          onRematch={onRematch}
          disabled={disabled}
          winner={winner}
          board={board}
          hasBlastToken={hasBlastToken}
        />
      )}
    </AnimatePresence>
  );
}