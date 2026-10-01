/**
 * handInput — the hand-tracking input's published face.
 *
 * The camera input (`DesktopHandTracking`, lazy-loaded with MediaPipe) owns the
 * hand state and publishes the two views other modules render: the camera's
 * status (for the toolbar toggle) and the hand pointer (for the board's column
 * arrows). Readers subscribe here directly, so hand state never round-trips
 * through GameScreen, and a gesture re-renders only the readers of the pointer.
 *
 * No React state, no MediaPipe: importing this costs mobile nothing. Only one
 * camera input is mounted at a time; it resets everything when it unmounts.
 */
import { useSyncExternalStore } from "react";
import type { Gesture } from "./useHandTracking";

export interface HandCamera {
  isTracking: boolean;
  isLoading: boolean;
  error: string | null;
}

/** Where the hand points while tracking; `null` when the camera is off. */
export interface HandPointer {
  gesture: Gesture;
  selectedCol: number;
  blastCursor: [number, number] | null;
}

interface HandControls {
  start: () => void;
  stop: () => void;
}

const IDLE_CAMERA: HandCamera = { isTracking: false, isLoading: false, error: null };

let camera: HandCamera = IDLE_CAMERA;
let pointer: HandPointer | null = null;
let controls: HandControls | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const sameCursor = (a: HandPointer["blastCursor"], b: HandPointer["blastCursor"]) =>
  a === b || (a !== null && b !== null && a[0] === b[0] && a[1] === b[1]);

/** The camera input publishes its latest state. Unchanged views keep their identity. */
export function publishHandInput(state: HandCamera & HandPointer) {
  let changed = false;
  if (
    state.isTracking !== camera.isTracking ||
    state.isLoading !== camera.isLoading ||
    state.error !== camera.error
  ) {
    camera = { isTracking: state.isTracking, isLoading: state.isLoading, error: state.error };
    changed = true;
  }
  const nextPointer = state.isTracking
    ? { gesture: state.gesture, selectedCol: state.selectedCol, blastCursor: state.blastCursor }
    : null;
  if (
    (nextPointer === null) !== (pointer === null) ||
    (nextPointer && pointer && (
      nextPointer.gesture !== pointer.gesture ||
      nextPointer.selectedCol !== pointer.selectedCol ||
      !sameCursor(nextPointer.blastCursor, pointer.blastCursor)
    ))
  ) {
    pointer = nextPointer;
    changed = true;
  }
  if (changed) emit();
}

/** The mounted camera input registers how to start and stop itself. */
export function registerHandControls(next: HandControls) {
  controls = next;
  return () => {
    if (controls !== next) return;
    controls = null;
    camera = IDLE_CAMERA;
    pointer = null;
    emit();
  };
}

/** Start the camera if it is off, stop it if it is on. A no-op before the input loads. */
export function toggleHandTracking() {
  if (camera.isTracking) controls?.stop();
  else controls?.start();
}

export function useHandCamera(): HandCamera {
  return useSyncExternalStore(subscribe, () => camera, () => IDLE_CAMERA);
}

export function useHandPointer(): HandPointer | null {
  return useSyncExternalStore(subscribe, () => pointer, () => null);
}
