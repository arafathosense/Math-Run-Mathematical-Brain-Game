// MNIST-style preprocessing: RGBA → grayscale → (adaptive) Otsu → largest connected component
// → longest side 20px → paste into 28×28 → centroid alignment → optional blur → normalization

/*
Note:
  You are of course can do the same tasks with pre-built OpenCV, and it will be much easier. 
  However, I would like to try without relying on external software packages.
*/

import { otsu, largestCC, computeCentroid, gaussianBlur1D } from './utils.js';

export function preprocessToMNIST(rgba, { srcW, srcH, blur = false, center = true }) {
  // 1) RGBA → Grayscale in [0,1]
  const gray = new Float32Array(srcW * srcH);
  for (let i = 0; i < srcW * srcH; i++) {
    const r = rgba[i * 4 + 0], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  // 2) Otsu threshold + adaptive inversion (so both black-on-white and white-on-black unify)
  const mean = gray.reduce((a, b) => a + b, 0) / gray.length;
  const th = otsu(gray);
  const invert = mean > 0.5; // if background is bright, invert foreground
  const bin = new Uint8Array(srcW * srcH);
  for (let i = 0; i < bin.length; i++) {
    const isFg = gray[i] >= th;
    bin[i] = invert ? (isFg ? 0 : 1) : (isFg ? 1 : 0); // 1 = foreground (stroke), 0 = background
  }

  // 3) Largest Connected Component (LCC) → Region of Interest (ROI)
  const roi = largestCC(bin, srcW, srcH) ?? { x0: 0, y0: 0, x1: srcW - 1, y1: srcH - 1 };
  let { x0, y0, x1, y1 } = roi;
  const w = Math.max(1, x1 - x0 + 1), h = Math.max(1, y1 - y0 + 1);

  // 4) Keep aspect ratio; scale so the longer side = 20 px
  const target = 20;
  const scale = (w > h) ? target / w : target / h;
  const newW = Math.max(1, Math.round(w * scale));
  const newH = Math.max(1, Math.round(h * scale));

  // Crop ROI from grayscale
  const crop = new Float32Array(w * h);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      crop[yy * w + xx] = gray[(y0 + yy) * srcW + (x0 + xx)];
    }
  }

  // Nearest-neighbor scaling to newW × newH
  const scaled = new Float32Array(newW * newH);
  for (let yy = 0; yy < newH; yy++) {
    for (let xx = 0; xx < newW; xx++) {
      const sx = Math.min(w - 1, Math.round(xx / scale));
      const sy = Math.min(h - 1, Math.round(yy / scale));
      scaled[yy * newW + xx] = crop[sy * w + sx];
    }
  }

  // 5) Paste into the center of a 28×28 canvas
  const canvas28 = new Float32Array(28 * 28);
  const offX = Math.floor((28 - newW) / 2);
  const offY = Math.floor((28 - newH) / 2);
  for (let yy = 0; yy < newH; yy++) {
    for (let xx = 0; xx < newW; xx++) {
      canvas28[(offY + yy) * 28 + (offX + xx)] = scaled[yy * newW + xx];
    }
  }

  // 6) Centroid alignment (move mass center towards (14,14))
  if (center) {
    const { cx, cy, mass } = computeCentroid(canvas28, 28, 28);
    if (mass > 0) {
      const dx = Math.round(14 - cx), dy = Math.round(14 - cy);
      if (dx !== 0 || dy !== 0) {
        const shifted = new Float32Array(28 * 28);
        for (let y = 0; y < 28; y++) {
          for (let x = 0; x < 28; x++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < 28 && ny >= 0 && ny < 28) {
              shifted[ny * 28 + nx] = canvas28[y * 28 + x];
            }
          }
        }
        canvas28.set(shifted);
      }
    }
  }

  // 7) Optional light blur (helps smooth jagged strokes)
  if (blur) {
    gaussianBlur1D(canvas28, 28, 28, 0.8);          // horizontal
    gaussianBlur1D(canvas28, 28, 28, 0.8, true);    // vertical
  }

  // 8) Normalize to [0,1]
  let min = Infinity, max = -Infinity;
  for (const v of canvas28) { if (v < min) min = v; if (v > max) max = v; }
  const range = Math.max(1e-6, max - min);
  for (let i = 0; i < canvas28.length; i++) canvas28[i] = (canvas28[i] - min) / range;

  return {
    img28: canvas28,
    debug: `th=${th.toFixed(3)} invert=${invert} roi=[${x0},${y0}..${x1},${y1}] w×h=${w}×${h} scale=${scale.toFixed(3)}`
  };
}

// Convert 28×28 float array into a TF tensor shape [1, 784]
export function tensorFrom28x28(img28) {
  return tf.tensor(img28, [1, 28 * 28], 'float32');
}