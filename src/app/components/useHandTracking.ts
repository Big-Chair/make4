import { useState, useEffect, useRef, useCallback } from "react";

// --- Types ---
export type Gesture = "point" | "pointdown" | "open" | "fist" | "thumbsup" | "none";

export interface HandTrackingState {
  isTracking: boolean;
  isLoading: boolean;
  error: string | null;
  gesture: Gesture;
  /** Normalized hand X position 0 (left of frame) to 1 (right of frame), mirrored */
  handX: number;
  /** Normalized hand Y position 0 (top) to 1 (bottom) */
  handY: number;
  /** Mapped column 0-6 based on hand X */
  selectedCol: number;
  /** Mapped board row/col for blast cursor [row, col] */
  blastCursor: [number, number] | null;
  /** Confidence in current gesture 0-1 */
  confidence: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  landmarks: number[][] | null;
  start: () => void;
  stop: () => void;
}

// --- Landmark indices ---
const WRIST = 0;
const THUMB_TIP = 4;
const THUMB_IP = 3;
const THUMB_MCP = 2;
const INDEX_TIP = 8;
const INDEX_DIP = 7;
const INDEX_PIP = 6;
const INDEX_MCP = 5;
const MIDDLE_TIP = 12;
const MIDDLE_PIP = 10;
const RING_TIP = 16;
const RING_PIP = 14;
const PINKY_TIP = 20;
const PINKY_PIP = 18;

// --- Gesture detection from 21 landmarks ---
function detectGesture(landmarks: number[][]): { gesture: Gesture; confidence: number } {
  if (!landmarks || landmarks.length < 21) return { gesture: "none", confidence: 0 };

  // A finger is "up" if its tip is above (lower Y value) its PIP joint
  const indexUp = landmarks[INDEX_TIP][1] < landmarks[INDEX_PIP][1];
  const middleUp = landmarks[MIDDLE_TIP][1] < landmarks[MIDDLE_PIP][1];
  const ringUp = landmarks[RING_TIP][1] < landmarks[RING_PIP][1];
  const pinkyUp = landmarks[PINKY_TIP][1] < landmarks[PINKY_PIP][1];

  // Thumb extended: tip significantly away from index MCP (thumb sticking out)
  const thumbExtended =
    Math.hypot(
      landmarks[THUMB_TIP][0] - landmarks[INDEX_MCP][0],
      landmarks[THUMB_TIP][1] - landmarks[INDEX_MCP][1]
    ) > 0.08;

  // Thumb pointing up: thumb tip is well above its MCP and IP joints
  const thumbPointingUp =
    landmarks[THUMB_TIP][1] < landmarks[THUMB_IP][1] - 0.02 &&
    landmarks[THUMB_TIP][1] < landmarks[THUMB_MCP][1] - 0.04;

  const nonThumbUp = [indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;

  // --- THUMBS UP: thumb up, all other fingers curled ---
  if (thumbPointingUp && thumbExtended && nonThumbUp <= 1 && !indexUp && !middleUp) {
    return { gesture: "thumbsup", confidence: 0.88 };
  }

  // --- POINTING: only index finger up, others curled ---
  if (indexUp && !middleUp && !ringUp && !pinkyUp) {
    // Extra check: index tip should be notably above wrist (finger is vertical-ish)
    const indexVertical = landmarks[INDEX_TIP][1] < landmarks[WRIST][1] - 0.05;
    if (indexVertical) {
      return { gesture: "point", confidence: 0.9 };
    }
  }

  // --- OPEN HAND: 3+ fingers extended ---
  if (nonThumbUp >= 3) {
    return { gesture: "open", confidence: 0.7 + nonThumbUp * 0.06 };
  }

  // --- CLOSED FIST: 0-1 non-thumb fingers up, thumb not pointing up ---
  if (nonThumbUp <= 1 && !indexUp && !middleUp && !thumbPointingUp) {
    return { gesture: "fist", confidence: 0.82 };
  }

  // Fallback: if fingers are ambiguous, lean towards "none"
  return { gesture: "none", confidence: 0.3 };
}

// --- MediaPipe CDN loader ---
let mediapipeLoaded = false;
let HandLandmarker: any = null;
let FilesetResolver: any = null;

async function loadMediaPipe(): Promise<void> {
  if (mediapipeLoaded) return;

  // Load the tasks-vision module from CDN
  const vision = await import(
    /* @vite-ignore */
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs"
  );
  FilesetResolver = vision.FilesetResolver;
  HandLandmarker = vision.HandLandmarker;
  mediapipeLoaded = true;
}

// Board dimensions for blast cursor mapping
const BOARD_ROWS = 6;
const BOARD_COLS = 7;

export function useHandTracking(): HandTrackingState {
  const [isTracking, setIsTracking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gesture, setGesture] = useState<Gesture>("none");
  const [handX, setHandX] = useState(0.5);
  const [handY, setHandY] = useState(0.5);
  const [selectedCol, setSelectedCol] = useState(3);
  const [blastCursor, setBlastCursor] = useState<[number, number] | null>(null);
  const [confidence, setConfidence] = useState(0);
  const [landmarks, setLandmarks] = useState<number[][] | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handLandmarkerRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const lastDetectTimeRef = useRef(0);
  const activeRef = useRef(false);

  // Gesture debounce: require stable gesture for N frames
  const gestureBufferRef = useRef<Gesture[]>([]);
  const GESTURE_BUFFER_SIZE = 3;

  const processFrame = useCallback(() => {
    if (!activeRef.current) return;

    const now = performance.now();
    // Throttle to ~15fps
    if (now - lastDetectTimeRef.current < 66) {
      rafRef.current = requestAnimationFrame(processFrame);
      return;
    }
    lastDetectTimeRef.current = now;

    const video = videoRef.current;
    const handLandmarker = handLandmarkerRef.current;

    if (!video || !handLandmarker || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(processFrame);
      return;
    }

    try {
      const results = handLandmarker.detectForVideo(video, now);

      if (results.landmarks && results.landmarks.length > 0) {
        const hand = results.landmarks[0];
        const lms: number[][] = hand.map((lm: any) => [lm.x, lm.y, lm.z]);
        setLandmarks(lms);

        // Mirror X for natural feel (camera is mirrored)
        const indexX = 1 - lms[INDEX_TIP][0];
        const indexY = lms[INDEX_TIP][1];
        const wristX = 1 - lms[WRIST][0];
        const wristY = lms[WRIST][1];

        // Detect raw gesture
        const detected = detectGesture(lms);

        // --- Sustained downward movement detection for "pointdown" ---
        // Track index finger Y over recent frames to detect deliberate downward motion
        const yHistory: { y: number; t: number }[] = (gestureBufferRef as any)._yHistory || [];
        if (detected.gesture === "point") {
          yHistory.push({ y: indexY, t: now });
          // Keep last ~400ms of history
          while (yHistory.length > 0 && now - yHistory[0].t > 400) yHistory.shift();
        } else {
          yHistory.length = 0;
        }
        (gestureBufferRef as any)._yHistory = yHistory;

        // Detect sustained downward movement:
        // Finger must move downward consistently over several frames (not a quick flick)
        let isMovingDown = false;
        if (detected.gesture === "point" && yHistory.length >= 4) {
          const oldest = yHistory[0];
          const newest = yHistory[yHistory.length - 1];
          const deltaY = newest.y - oldest.y; // positive = downward
          const duration = newest.t - oldest.t;
          // Require at least 5% frame height moved down over at least 150ms
          // This filters out jitter but catches deliberate downward motion
          if (deltaY > 0.05 && duration > 150) {
            // Also check that movement is mostly downward (not oscillating)
            let downFrames = 0;
            for (let i = 1; i < yHistory.length; i++) {
              if (yHistory[i].y > yHistory[i - 1].y) downFrames++;
            }
            // At least 60% of frames should be moving down
            if (downFrames / (yHistory.length - 1) >= 0.6) {
              isMovingDown = true;
            }
          }
        }

        // Resolve final gesture
        const resolvedGesture: Gesture = isMovingDown ? "pointdown" : detected.gesture;

        // Debounce: buffer stable gestures
        gestureBufferRef.current.push(resolvedGesture);
        if (gestureBufferRef.current.length > GESTURE_BUFFER_SIZE) {
          gestureBufferRef.current.shift();
        }

        // For pointdown, fire immediately (1 frame) since movement is transient
        let stableGesture: Gesture = "none";
        if (resolvedGesture === "pointdown") {
          stableGesture = "pointdown";
          setGesture("pointdown");
          setConfidence(detected.confidence);
          // Clear Y history so we don't re-trigger until fresh movement
          (gestureBufferRef as any)._yHistory = [];
          gestureBufferRef.current = [];
        } else {
          // Normal debounce for all other gestures
          const allSame = gestureBufferRef.current.every(
            (g) => g === gestureBufferRef.current[0]
          );
          if (allSame && gestureBufferRef.current.length >= GESTURE_BUFFER_SIZE) {
            stableGesture = gestureBufferRef.current[0];
            setGesture(stableGesture);
            setConfidence(detected.confidence);
          }
        }

        // Position tracking
        if (stableGesture === "point" || stableGesture === "pointdown" || detected.gesture === "point") {
          setHandX(indexX);
          setHandY(indexY);
          const col = Math.min(BOARD_COLS - 1, Math.max(0, Math.floor(indexX * BOARD_COLS)));
          setSelectedCol(col);

          const bcRow = Math.min(BOARD_ROWS - 1, Math.max(0, Math.floor(indexY * BOARD_ROWS)));
          const bcCol = Math.min(BOARD_COLS - 1, Math.max(0, Math.floor(indexX * BOARD_COLS)));
          setBlastCursor([bcRow, bcCol]);
        } else {
          setHandX(wristX);
          setHandY(wristY);
          const col = Math.min(BOARD_COLS - 1, Math.max(0, Math.floor(wristX * BOARD_COLS)));
          setSelectedCol(col);

          const bcRow = Math.min(BOARD_ROWS - 1, Math.max(0, Math.floor(wristY * BOARD_ROWS)));
          const bcCol = Math.min(BOARD_COLS - 1, Math.max(0, Math.floor(wristX * BOARD_COLS)));
          setBlastCursor([bcRow, bcCol]);
        }
      } else {
        setLandmarks(null);
        setGesture("none");
        setConfidence(0);
        gestureBufferRef.current = [];
        (gestureBufferRef as any)._yHistory = [];
      }
    } catch (e) {
      // Silently continue on detection errors
    }

    rafRef.current = requestAnimationFrame(processFrame);
  }, []);

  const start = useCallback(async () => {
    if (isTracking || isLoading) return;
    setIsLoading(true);
    setError(null);

    try {
      // Check camera availability
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera not available on this device");
      }

      // Load MediaPipe
      await loadMediaPipe();

      // Create hand landmarker
      const fileset = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm"
      );
      const handLandmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      handLandmarkerRef.current = handLandmarker;

      // Start camera
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: "user" },
      });
      streamRef.current = stream;

      // Set tracking first so the video element mounts in CameraControl,
      // then an effect will attach the stream once videoRef is available.
      activeRef.current = true;
      setIsTracking(true);
      setIsLoading(false);
      gestureBufferRef.current = [];

      // Defer stream attachment + frame processing to after React commits
      // the render (which mounts the <video> element in CameraControl).
      setTimeout(() => {
        const video = videoRef.current;
        if (video && stream && !video.srcObject) {
          video.srcObject = stream;
          video.play().catch(() => {});
        }
        rafRef.current = requestAnimationFrame(processFrame);
      }, 0);
    } catch (e: any) {
      const msg =
        e.name === "NotAllowedError"
          ? "Camera permission denied"
          : e.name === "NotFoundError"
          ? "No camera found"
          : e.message || "Failed to start camera";
      setError(msg);
      setIsLoading(false);
    }
  }, [isTracking, isLoading, processFrame]);

  const stop = useCallback(() => {
    activeRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (handLandmarkerRef.current) {
      handLandmarkerRef.current.close();
      handLandmarkerRef.current = null;
    }
    setIsTracking(false);
    setGesture("none");
    setLandmarks(null);
    setConfidence(0);
    gestureBufferRef.current = [];
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return {
    isTracking,
    isLoading,
    error,
    gesture,
    handX,
    handY,
    selectedCol,
    blastCursor,
    confidence,
    videoRef,
    canvasRef,
    landmarks,
    start,
    stop,
  };
}