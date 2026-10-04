/**
 * Celebrations that are drawn, not played: a short confetti burst on a full-screen canvas inside
 * `#ui`. It listens to the event bus (badge-earned, trail-complete, cosmetic-unlocked) and never
 * touches the session. The canvas ignores every tap (`pointer-events: none`, set inline because
 * `#ui > *` turns pointer events back on), lasts 1.2 seconds, and is skipped entirely when the
 * player has asked for reduced motion.
 */
import './rewards.css';
import type { EventBus } from './events';

export const CONFETTI_MS = 1200;
export const CONFETTI_PIECES = 80;
/** The UI palette (the --tq-* tokens in src/ui/ui.css): primary, accent, sky, warn, bad. */
export const CONFETTI_COLORS = ['#2f6b3a', '#f2b705', '#87ceeb', '#b26a00', '#b3261e'] as const;

/** Gravity and drag, in pixels and seconds. */
const GRAVITY = 900;
const DRAG = 0.6;

export interface ConfettiOptions {
  /** Replaces Math.random (tests). */
  random?: () => number;
}

/** True when the player's system asks for less motion. Confetti is skipped then. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  angle: number;
  spin: number;
  color: string;
}

function makePieces(width: number, height: number, random: () => number): Piece[] {
  const pieces: Piece[] = [];
  for (let i = 0; i < CONFETTI_PIECES; i += 1) {
    // A pop from the upper middle: most pieces fly up and out, then fall.
    const angle = -Math.PI / 2 + (random() - 0.5) * Math.PI * 1.1;
    const speed = 380 + random() * 520;
    pieces.push({
      x: width / 2 + (random() - 0.5) * width * 0.2,
      y: height * 0.35,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 7 + random() * 7,
      angle: random() * Math.PI * 2,
      spin: (random() - 0.5) * 14,
      color: CONFETTI_COLORS[Math.floor(random() * CONFETTI_COLORS.length)]!,
    });
  }
  return pieces;
}

/**
 * Draw one burst of confetti over `host`. Returns a function that ends it early, or null when
 * nothing was drawn (reduced motion, or no canvas drawing available). Never throws.
 */
export function burstConfetti(host: HTMLElement, options: ConfettiOptions = {}): (() => void) | null {
  if (prefersReducedMotion()) return null;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;
  const random = options.random ?? Math.random;

  const rect = host.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || host.clientWidth || window.innerWidth || 1));
  const height = Math.max(1, Math.round(rect.height || host.clientHeight || window.innerHeight || 1));
  const scale = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.className = 'tq-confetti';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.pointerEvents = 'none';
  context.scale(scale, scale);
  host.appendChild(canvas);

  const pieces = makePieces(width, height, random);
  const startedAt = performance.now();
  let last = startedAt;
  let ended = false;
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let safety: ReturnType<typeof setTimeout> | undefined;

  const end = (): void => {
    if (ended) return;
    ended = true;
    if (frame !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    if (timer !== undefined) clearTimeout(timer);
    if (safety !== undefined) clearTimeout(safety);
    canvas.remove();
  };

  const draw = (): void => {
    if (ended) return;
    const now = performance.now();
    const elapsed = now - startedAt;
    if (elapsed >= CONFETTI_MS) {
      end();
      return;
    }
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const fade = elapsed > CONFETTI_MS - 300 ? Math.max(0, (CONFETTI_MS - elapsed) / 300) : 1;
    context.clearRect(0, 0, width, height);
    context.globalAlpha = fade;
    for (const piece of pieces) {
      piece.vx *= 1 - DRAG * dt;
      piece.vy = piece.vy * (1 - DRAG * dt) + GRAVITY * dt;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.angle += piece.spin * dt;
      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.angle);
      context.fillStyle = piece.color;
      context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
      context.restore();
    }
    context.globalAlpha = 1;
    if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(draw);
    else timer = setTimeout(draw, 16);
  };

  // However the frames run, the canvas is gone a moment after the burst is over.
  safety = setTimeout(end, CONFETTI_MS + 200);
  try {
    draw();
  } catch (error) {
    console.warn('confetti failed', error);
    end();
    return null;
  }
  return end;
}

/**
 * Fire confetti on a badge, a finished trail and a new cosmetic. A second event while a burst is
 * still falling replaces it, so the screen never fills with canvases. Returns a stop function: it
 * unsubscribes and ends any burst still falling, so nothing it started outlives it.
 */
export function installEffects(host: HTMLElement, bus: EventBus, options: ConfettiOptions = {}): () => void {
  let current: (() => void) | null = null;
  const unsubscribe = bus.on((event) => {
    if (event.type !== 'badge-earned' && event.type !== 'trail-complete' && event.type !== 'cosmetic-unlocked') return;
    current?.();
    current = burstConfetti(host, options);
  });
  return () => {
    unsubscribe();
    current?.();
    current = null;
  };
}
