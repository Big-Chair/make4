/**
 * Synthesized sound effects using the Web Audio API.
 * No external audio files needed — all sounds are generated programmatically.
 */

let audioCtx: AudioContext | null = null;

/** Master SFX volume multiplier (0..1) */
let masterVolume = 0.8;

/** Set global SFX volume (0–100 scale, internally stored as 0–1) */
export function setSfxVolume(vol: number) {
  masterVolume = Math.max(0, Math.min(1, vol / 100));
}

/** Get current SFX volume (0–100 scale) */
export function getSfxVolume(): number {
  return Math.round(masterVolume * 100);
}

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  // Resume if suspended (autoplay policy)
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

/* ── Helper: play a tone ───────────────────────────────────────────── */
function tone(
  freq: number,
  type: OscillatorType,
  duration: number,
  volume = 0.15,
  delay = 0,
  rampDown = true,
) {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume * masterVolume, ctx.currentTime + delay);
  if (rampDown) {
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
  }
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + delay);
  osc.stop(ctx.currentTime + delay + duration);
}

/* ── Helper: noise burst (for impacts / explosions) ────────────────── */
function noiseBurst(duration: number, volume = 0.1, delay = 0) {
  const ctx = getCtx();
  const bufferSize = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize); // decaying noise
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume * masterVolume, ctx.currentTime + delay);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);

  // Bandpass filter for coloring
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 800;
  filter.Q.value = 1;

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(ctx.currentTime + delay);
  source.stop(ctx.currentTime + delay + duration);
}

/* ── Sound effects ─────────────────────────────────────────────────── */

/** Token drop — a satisfying thud with a short pitch sweep */
export function playDrop() {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(300, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.12);
  gain.gain.setValueAtTime(0.45 * masterVolume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.15);
  // Impact noise
  noiseBurst(0.06, 0.15);
}

/** Column hover — very subtle tick */
export function playHover() {
  tone(1200, "sine", 0.04, 0.10);
}

/** Win celebration — ascending arpeggio fanfare */
export function playWin() {
  const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
  notes.forEach((freq, i) => {
    tone(freq, "triangle", 0.3, 0.30, i * 0.12);
  });
  // Sparkle
  tone(1568, "sine", 0.5, 0.15, 0.5);
  tone(2093, "sine", 0.4, 0.10, 0.6);
}

/** Draw — neutral descending two-tone */
export function playDraw() {
  tone(440, "triangle", 0.25, 0.25, 0);
  tone(349, "triangle", 0.35, 0.25, 0.2);
}

/** Blast explosion — rumbling boom with noise */
export function playBlast() {
  const ctx = getCtx();
  // Low boom sweep
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(200, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.3);
  gain.gain.setValueAtTime(0.40 * masterVolume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.35);
  // Noise crackle
  noiseBurst(0.25, 0.30);
  // Higher debris
  tone(600, "square", 0.08, 0.12, 0.05);
  tone(900, "square", 0.06, 0.08, 0.1);
}

/** Timer tick — used when timer ≤ 5 */
export function playTimerTick() {
  tone(880, "sine", 0.06, 0.20);
}

/** Timer urgent — double beep at ≤ 3 */
export function playTimerUrgent() {
  tone(1000, "square", 0.05, 0.25, 0);
  tone(1000, "square", 0.05, 0.25, 0.1);
}

/** Button click — generic UI interaction */
export function playClick() {
  tone(800, "sine", 0.05, 0.15);
}

/** Game reset / new game */
export function playReset() {
  tone(523, "triangle", 0.12, 0.20, 0);
  tone(784, "triangle", 0.15, 0.20, 0.08);
}