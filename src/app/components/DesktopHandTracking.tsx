/**
 * Desktop-only hand-tracking input: useHandTracking + CameraControl.
 * This module is lazy-loaded so that mobile devices never pull in the
 * MediaPipe dependency graph or CameraControl rendering code.
 *
 * The hand state stays here. It is published through `handInput` for the
 * toolbar toggle and the board's column arrows, never lifted into GameScreen.
 */
import { useEffect, useRef } from "react";
import { AnimatePresence } from "motion/react";
import { useHandTracking } from "./useHandTracking";
import { publishHandInput, registerHandControls } from "./handInput";
import { CameraControl } from "./CameraControl";
import type { Board, CellValue } from "./useConnect4";

export interface DesktopHandTrackingProps {
  blastMode: boolean;
  currentPlayer: "red" | "yellow";
  /** True when the Match applied the move. */
  onDrop: (col: number) => boolean;
  onAutoBlast: () => boolean;
  onRematch: () => void;
  onHover: () => void;
  disabled: boolean;
  winner: CellValue | "draw";
  board: Board;
  hasBlastToken: boolean;
}

export default function DesktopHandTracking({
  blastMode,
  currentPlayer,
  onDrop,
  onAutoBlast,
  onRematch,
  onHover,
  disabled,
  winner,
  board,
  hasBlastToken,
}: DesktopHandTrackingProps) {
  const handTracking = useHandTracking();

  // Publish what the toolbar and board render; handInput drops unchanged views.
  useEffect(() => {
    publishHandInput(handTracking);
  });

  // Register start/stop for the toolbar toggle; unregistering resets the published views.
  const controlsRef = useRef(handTracking);
  controlsRef.current = handTracking;
  useEffect(
    () => registerHandControls({
      start: () => controlsRef.current.start(),
      stop: () => controlsRef.current.stop(),
    }),
    [],
  );

  return (
    <AnimatePresence>
      {handTracking.isTracking && (
        <CameraControl
          tracking={handTracking}
          blastMode={blastMode}
          currentPlayer={currentPlayer}
          onDrop={onDrop}
          onAutoBlast={onAutoBlast}
          onRematch={onRematch}
          onHover={onHover}
          disabled={disabled}
          winner={winner}
          board={board}
          hasBlastToken={hasBlastToken}
        />
      )}
    </AnimatePresence>
  );
}