// Modules loaded at runtime straight from a CDN (see useHandTracking.loadMediaPipe).
// No local package is installed for them, so the compiler needs an ambient declaration.
declare module "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs" {
  export const FilesetResolver: any;
  export const HandLandmarker: any;
}
