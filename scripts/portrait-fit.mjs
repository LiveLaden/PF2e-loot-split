/**
 * Loot Split — portrait normalization.
 *
 * Token art varies wildly: some busts overflow their ring, others sit tiny
 * inside the frame. This measures each file's real content bounds (alpha
 * channel) and returns a scale factor so every portrait fills its frame
 * equally, keeping small and large creatures visually consistent.
 *
 * View-layer only: results are cached by URL and never stored in the session.
 * Anything unreadable (remote art without CORS, load failures, fully opaque
 * images like full-body actor art or icons) safely resolves to 1.
 */

const _fitCache = new Map(); // url -> Promise<number>

export const PORTRAIT_TARGET_FILL = 0.62;
export const PORTRAIT_MIN_SCALE = 0.7;
export const PORTRAIT_MAX_SCALE = 2.0;
const ALPHA_THRESHOLD = 24;
const SAMPLE = 128;

/** Pure math, Node-testable: content box (px, SAMPLE grid) -> scale factor. */
export function fitScaleForBox(x0, y0, x1, y1, cornersOpaque) {
  if (cornersOpaque) return 1;
  if (!(x1 >= x0 && y1 >= y0)) return 1;
  const coverage = Math.max(x1 - x0 + 1, y1 - y0 + 1) / SAMPLE;
  if (!(coverage > 0)) return 1;
  const s = PORTRAIT_TARGET_FILL / coverage;
  if (!Number.isFinite(s)) return 1;
  return Math.min(PORTRAIT_MAX_SCALE, Math.max(PORTRAIT_MIN_SCALE, s));
}

/**
 * Pure ring detector (circular Hough-style voting on radial gradients).
 * Token rings are the largest near-circular edge at roughly the frame center,
 * so every portrait can be scaled until its RING matches, whatever the bust
 * inside does. Returns { scale, radius, cx, cy, confidence } or null.
 * gray/alpha are Uint8ClampedArray-like, length S*S. Node-testable.
 */
export function detectRingScale(gray, alpha, S) {
  const ANGLES = 72;
  const DR = Math.max(1, Math.round(S * 0.016));
  const R_MIN = Math.round(S * 0.13);
  const R_MAX = Math.round(S * 0.48);
  const STEP = Math.max(2, Math.round(S * 0.04));
  const half = (S - 1) / 2;
  const lum = (x, y) => gray[y * S + x];
  const alp = (x, y) => alpha[y * S + x];
  let globalMax = 0;
  const cands = [];
  for (let oy = -STEP; oy <= STEP; oy += STEP) {
    for (let ox = -STEP; ox <= STEP; ox += STEP) {
      const cx = half + ox;
      const cy = half + oy;
      for (let r = R_MIN; r <= R_MAX; r++) {
        let sum = 0;
        let strong = 0;
        for (let k = 0; k < ANGLES; k++) {
          const a = (k / ANGLES) * Math.PI * 2;
          const dx = Math.cos(a);
          const dy = Math.sin(a);
          const x0 = Math.round(cx + dx * (r - DR));
          const y0 = Math.round(cy + dy * (r - DR));
          const x1 = Math.round(cx + dx * (r + DR));
          const y1 = Math.round(cy + dy * (r + DR));
          if (x0 < 0 || y0 < 0 || x0 >= S || y0 >= S || x1 < 0 || y1 < 0 || x1 >= S || y1 >= S) continue;
          if (alp(x0, y0) < ALPHA_THRESHOLD) continue; // need art on the inner side
          const g = Math.abs(lum(x1, y1) - lum(x0, y0));
          sum += g;
          if (g > 18) strong++;
        }
        const mean = sum / ANGLES;
        if (mean > globalMax) globalMax = mean;
        cands.push({ r, cx, cy, mean, frac: strong / ANGLES });
      }
    }
  }
  let best = null;
  for (const c of cands) {
    const conf = (c.mean / (globalMax || 1)) * c.frac;
    if (!best || conf > best.conf) best = { ...c, conf };
  }
  if (!best || best.conf < 0.8 || globalMax < 12) return null;
  const s = (PORTRAIT_TARGET_FILL * S) / 2 / best.r;
  if (!Number.isFinite(s)) return null;
  return {
    scale: Math.min(PORTRAIT_MAX_SCALE, Math.max(PORTRAIT_MIN_SCALE, s)),
    radius: best.r,
    cx: best.cx,
    cy: best.cy,
    confidence: best.conf,
  };
}

export function portraitFit(url) {
  if (!url || typeof url !== "string") return Promise.resolve(1);
  let pending = _fitCache.get(url);
  if (!pending) {
    pending = _measure(url).catch(() => 1);
    _fitCache.set(url, pending);
  }
  return pending;
}

function _measure(url) {
  return new Promise((resolve) => {
    const done = (v) => resolve(Number.isFinite(v) ? v : 1);
    try {
      const img = new Image();
      img.decoding = "async";
      // Anonymous mode keeps CORS-enabled remotes readable; same-origin is unaffected.
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const cv = document.createElement("canvas");
          cv.width = SAMPLE;
          cv.height = SAMPLE;
          const ctx = cv.getContext("2d", { willReadFrequently: true });
          if (!ctx) return done(1);
          ctx.clearRect(0, 0, SAMPLE, SAMPLE);
          ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
          // May throw on tainted canvas (remote art without CORS headers).
          const data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
          const N = SAMPLE * SAMPLE;
          const gray = new Uint8ClampedArray(N);
          const alpha = new Uint8ClampedArray(N);
          for (let i = 0; i < N; i++) {
            const R = data[i * 4];
            const G = data[i * 4 + 1];
            const B = data[i * 4 + 2];
            gray[i] = Math.round(0.299 * R + 0.587 * G + 0.114 * B);
            alpha[i] = data[i * 4 + 3];
          }
          const cornersOpaque = [
            [0, 0],
            [SAMPLE - 1, 0],
            [0, SAMPLE - 1],
            [SAMPLE - 1, SAMPLE - 1],
          ].every(([x, y]) => alpha[y * SAMPLE + x] > ALPHA_THRESHOLD);
          if (cornersOpaque) return done(1);
          let x0 = SAMPLE;
          let y0 = SAMPLE;
          let x1 = -1;
          let y1 = -1;
          for (let y = 0; y < SAMPLE; y++) {
            for (let x = 0; x < SAMPLE; x++) {
              if (alpha[y * SAMPLE + x] > ALPHA_THRESHOLD) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
              }
            }
          }
          // Ringless full-bleed art (no ring to equalize) renders as-is.
          if (x1 >= x0 && Math.max(x1 - x0 + 1, y1 - y0 + 1) / SAMPLE > 0.82) {
            return done(1);
          }
          // Prefer the token ring itself; fall back to content bounds.
          try {
            const ring = detectRingScale(gray, alpha, SAMPLE);
            if (ring) return done(ring.scale);
          } catch { /* fall through to bbox */ }
          done(fitScaleForBox(x0, y0, x1, y1, cornersOpaque));
        } catch {
          done(1);
        }
      };
      img.onerror = () => done(1);
      img.src = url;
    } catch {
      done(1);
    }
  });
}
