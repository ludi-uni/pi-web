// CodexSpriteRenderer — PetRenderer implementation for Codex custom pet
// packages (pet.json + spritesheet.webp). Draws the current animation row onto
// a <canvas> via drawImage cropping; the browser decodes WebP/PNG natively so
// no image dependency is needed.
//
// Codex atlas contract (codexpet.xyz/spec):
//   - 8 columns; V1 = 9 rows (1536x1872), V2 = 11 rows (1536x2288, adds
//     look-direction rows 9-10 which this renderer ignores)
//   - cell size = atlas/8 × atlas/rows (nominal 192×208)
//   - frames are consecutive non-empty cells starting at column 0; trailing
//     empty cells are ignored. We approximate "non-empty" by the recommended
//     per-row frame counts and additionally stop a row early when a probed
//     cell is fully transparent.

import { STATE_TO_ROW } from './companion-states.js';

export const CODEX_COLS = 8;

// Recommended frames per row (spec table). Rows 9-10 are V2 look directions.
const ROW_FRAME_HINTS = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8];

// Per-state playback rate (ms per frame). Idle/waiting are calm; running and
// failed are livelier. ~0.75× the original pace so the flipbook reads smooth
// rather than frantic.
const FRAME_MS = {
  idle: 210,
  running: 120,
  waiting: 225,
  review: 185,
  failed: 145,
  completed: 145,
};

export function createCodexSpriteRenderer({
  documentImpl = typeof document !== 'undefined' ? document : null,
  windowImpl = typeof window !== 'undefined' ? window : null,
  ImageImpl = typeof Image !== 'undefined' ? Image : null,
  scale = 1,
} = {}) {
  let canvas = null;
  let ctx = null;
  let image = null;
  let cellW = 0;
  let cellH = 0;
  let rows = 0;
  let probeCanvas = null;
  let state = 'idle';
  let frame = 0;
  let lastAdvance = 0;
  let raf = 0;
  let destroyed = false;
  let reduced = false;
  let emptyCols = null; // per-row detected empty columns: row -> first empty col
  let ready = false;

  function rowFor(s) {
    return STATE_TO_ROW[s] ?? 0;
  }

  function frameCount(row) {
    if (row >= rows) return 1;
    const hint = ROW_FRAME_HINTS[row] ?? CODEX_COLS;
    const firstEmpty = emptyCols?.get(row);
    const usable = firstEmpty == null ? hint : Math.min(hint, firstEmpty);
    return Math.max(1, Math.min(usable, CODEX_COLS));
  }

  // Probe a cell's alpha channel once (cached) to detect empty trailing cells.
  // Uses a dedicated probe canvas so it works before the display canvas exists.
  function cellIsEmpty(row, col) {
    if (!image || !documentImpl) return true;
    try {
      if (!probeCanvas) {
        probeCanvas = documentImpl.createElement('canvas');
        probeCanvas.width = cellW;
        probeCanvas.height = cellH;
      }
      const pctx = probeCanvas.getContext('2d', { willReadFrequently: true });
      pctx.clearRect(0, 0, cellW, cellH);
      pctx.drawImage(image, col * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH);
      const data = pctx.getImageData(0, 0, cellW, cellH).data;
      for (let i = 3; i < data.length; i += 16) {
        if (data[i] >= 16) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  function detectEmptyColumns() {
    emptyCols = new Map();
    for (let row = 0; row < Math.min(rows, ROW_FRAME_HINTS.length); row++) {
      const hint = ROW_FRAME_HINTS[row] ?? CODEX_COLS;
      for (let col = 0; col < hint; col++) {
        if (cellIsEmpty(row, col)) {
          emptyCols.set(row, col);
          break;
        }
      }
    }
  }

  function draw() {
    if (!ctx || !image || !ready) return;
    const row = Math.min(rowFor(state), rows - 1);
    const count = frameCount(row);
    const col = frame % count;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, col * cellW, row * cellH, cellW, cellH, 0, 0, canvas.width, canvas.height);
  }

  function loop(now) {
    if (destroyed) return;
    const interval = FRAME_MS[state] ?? 150;
    if (!reduced && now - lastAdvance >= interval) {
      lastAdvance = now;
      frame += 1;
    }
    draw();
    raf = windowImpl?.requestAnimationFrame?.(loop) ?? 0;
  }

  function start() {
    if (!raf && windowImpl?.requestAnimationFrame) {
      raf = windowImpl.requestAnimationFrame(loop);
    }
  }

  return {
    async load(pkg) {
      if (!ImageImpl) throw new Error('Image unavailable');
      const img = new ImageImpl();
      img.decoding = 'async';
      const loaded = new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('spritesheet failed to load'));
      });
      img.src = pkg.imageUrl;
      await loaded;
      image = img;
      cellW = Math.floor(img.naturalWidth / CODEX_COLS);
      // Codex atlases are uniform: every cell is square-ish and the row count
      // is fixed by the spec version (V1=9, V2=11). Deriving rows by dividing
      // height by cellW breaks on V2 (2288/192 = 11.92 → rounds to 12 and
      // shrinks the cell height, slicing across row boundaries). Trust the
      // declared version first, then fall back to exact divisibility.
      const declared = pkg.spriteVersionNumber === 2 ? 11 : 9;
      if (img.naturalHeight % declared === 0) {
        rows = declared;
      } else if (img.naturalHeight % 11 === 0) {
        rows = 11;
      } else if (img.naturalHeight % 9 === 0) {
        rows = 9;
      } else {
        rows = Math.max(1, Math.round(img.naturalHeight / cellW));
      }
      cellH = Math.floor(img.naturalHeight / rows);
      if (!cellW || !cellH) throw new Error('invalid spritesheet dimensions');
      if (canvas) {
        canvas.width = cellW;
        canvas.height = cellH;
      }
      ready = true;
      detectEmptyColumns();
      frame = 0;
      draw();
      return { displayName: pkg.displayName || pkg.id };
    },
    attach(el) {
      if (!documentImpl || !el) return;
      // Re-attach must not stack a second canvas — drop any existing one.
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      canvas = documentImpl.createElement('canvas');
      canvas.className = 'pet-canvas';
      canvas.width = cellW || 192;
      canvas.height = cellH || 208;
      const s = Math.max(0.25, Math.min(3, scale));
      canvas.style.width = `${(canvas.width * s) / 2}px`;
      canvas.style.height = `${(canvas.height * s) / 2}px`;
      el.appendChild(canvas);
      ctx = canvas.getContext('2d');
      if (ready) draw();
      start();
    },
    setState(next) {
      if (next === state) return;
      state = next;
      frame = 0;
      lastAdvance = 0;
      if (reduced) draw();
    },
    setScale(next) {
      scale = next;
      if (canvas) {
        const s = Math.max(0.25, Math.min(3, scale));
        canvas.style.width = `${(cellW * s) / 2}px`;
        canvas.style.height = `${(cellH * s) / 2}px`;
      }
    },
    reducedMotion(flag) {
      reduced = !!flag;
      if (reduced) {
        frame = 0;
        draw();
      }
    },
    frameSize() {
      return cellW && cellH ? { width: cellW, height: cellH } : null;
    },
    destroy() {
      destroyed = true;
      if (raf && windowImpl?.cancelAnimationFrame) windowImpl.cancelAnimationFrame(raf);
      raf = 0;
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      canvas = null;
      ctx = null;
      image = null;
      probeCanvas = null;
      ready = false;
    },
    // test seam
    _debug: () => ({ state, frame, rows, cellW, cellH, ready }),
  };
}
