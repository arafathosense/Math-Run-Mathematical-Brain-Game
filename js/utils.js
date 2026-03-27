// ===== Otsu Threshold =====
// Input: gray (Float32Array) with values in [0,1]
// Output: threshold in [0,1]
export function otsu(gray){
  // Build 256-bin histogram from grayscale [0,1]
  const hist = new Float32Array(256);
  for (const v of gray){
    hist[Math.min(255, Math.max(0, (v * 255) | 0))]++;
  }

  const total = gray.length;

  // sum = sum(i * hist[i]) over all bins (using bin index as intensity)
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  // Iterate all possible thresholds; pick the one maximizing between-class variance
  let sumB = 0, wB = 0, varMax = -1, th = 0;
  for (let i = 0; i < 256; i++){
    wB += hist[i];               // weight of background
    if (!wB) continue;
    const wF = total - wB;       // weight of foreground
    if (!wF) break;

    sumB += i * hist[i];         // cumulative sum for background
    const mB = sumB / wB;        // mean of background
    const mF = (sum - sumB) / wF;// mean of foreground

    // Between-class variance
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > varMax){ varMax = between; th = i; }
  }

  return th / 255;               // convert back to [0,1]
}

// ===== Largest Connected Component (4-neighborhood) =====
// Input: bin (Uint8Array, values 0/1), width w, height h
// Output: bounding box {x0,y0,x1,y1} of the largest component, or null if none
export function largestCC(bin, w, h){
  const visited = new Uint8Array(w * h);
  let best = null, bestSize = 0;

  // Pre-allocate BFS queues (ring-buffer style via head/tail indices)
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);

  for (let y = 0; y < h; y++){
    for (let x = 0; x < w; x++){
      const idx = y * w + x;
      if (bin[idx] === 0 || visited[idx]) continue;

      // BFS from this seed
      let head = 0, tail = 0;
      qx[tail] = x; qy[tail] = y; tail++;
      visited[idx] = 1;

      // Track bounding box and size
      let minx = x, maxx = x, miny = y, maxy = y, size = 0;

      while (head < tail){
        const cx = qx[head], cy = qy[head]; head++;
        size++;

        // Update bounding box
        if (cx < minx) minx = cx; if (cx > maxx) maxx = cx;
        if (cy < miny) miny = cy; if (cy > maxy) maxy = cy;

        // 4-neighbors
        const nbs = [[1,0],[-1,0],[0,1],[0,-1]];
        for (const [dx, dy] of nbs){
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const nidx = ny * w + nx;
          if (!visited[nidx] && bin[nidx] === 1){
            visited[nidx] = 1;
            qx[tail] = nx; qy[tail] = ny; tail++;
          }
        }
      }

      // Keep the largest component
      if (size > bestSize){
        bestSize = size;
        best = { x0: minx, y0: miny, x1: maxx, y1: maxy };
      }
    }
  }
  return best;
}

// ===== Intensity Centroid =====
// Input: img (Float32Array), width w, height h
// Output: { cx, cy, mass }, centroid in pixel coords (float), mass = sum of intensity
export function computeCentroid(img, w, h){
  let sum = 0, sx = 0, sy = 0;
  for (let y = 0; y < h; y++){
    for (let x = 0; x < w; x++){
      const v = img[y * w + x];
      sum += v; sx += v * x; sy += v * y;
    }
  }
  if (sum <= 0) return { cx: w / 2, cy: h / 2, mass: 0 }; // fallback: center of image
  return { cx: sx / sum, cy: sy / sum, mass: sum };
}

// ===== Separable Gaussian Blur (1D) =====
// In-place: writes the blurred result back into `img`
// sigma controls blur strength; when vertical=false, blur horizontally; when true, blur vertically
export function gaussianBlur1D(img, w, h, sigma = 0.8, vertical = false){
  // Kernel radius ~ 2.5 * sigma (rounded)
  const radius = Math.max(1, Math.round(sigma * 2.5));
  const k = new Float32Array(radius * 2 + 1);

  // Build and normalize kernel
  let s = 0;
  for (let i = -radius; i <= radius; i++){
    const val = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + radius] = val; s += val;
  }
  for (let i = 0; i < k.length; i++) k[i] /= s;

  // Convolution output buffer
  const out = new Float32Array(w * h);

  if (!vertical) {
    // Horizontal pass
    for (let y = 0; y < h; y++){
      for (let x = 0; x < w; x++){
        let acc = 0;
        for (let t = -radius; t <= radius; t++){
          const xx = Math.min(w - 1, Math.max(0, x + t)); // clamp at borders
          acc += img[y * w + xx] * k[t + radius];
        }
        out[y * w + x] = acc;
      }
    }
    img.set(out);
  } else {
    // Vertical pass
    for (let x = 0; x < w; x++){
      for (let y = 0; y < h; y++){
        let acc = 0;
        for (let t = -radius; t <= radius; t++){
          const yy = Math.min(h - 1, Math.max(0, y + t)); // clamp at borders
          acc += img[yy * w + x] * k[t + radius];
        }
        out[y * w + x] = acc;
      }
    }
    img.set(out);
  }
}

// ===== Probability Utilities =====
// Softmax with max-subtraction for numerical stability
export function softmax(arr){
  const m = Math.max(...arr);
  const exps = arr.map(v => Math.exp(v - m));
  const s = exps.reduce((a, b) => a + b, 0);
  return exps.map(v => v / s);
}

// Return top-k indices with probabilities, sorted desc by p
export function argTopK(probs, k){
  return probs
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p - a.p)
    .slice(0, k);
}

// ===== Render Probability Bars =====
// root: DOM element to render into
// probs: array of length 10 (class probabilities 0..9)
// highlightIdx: optional index to visually emphasize
export function renderBars(root, probs, highlightIdx){
  root.innerHTML = '';
  for (let i = 0; i < 10; i++){
    const bar = document.createElement('div');
    bar.className = 'bar';

    const span = document.createElement('span'); // the filled bar
    span.style.width = (probs[i] * 100).toFixed(2) + '%';
    if (i === highlightIdx) span.style.filter = 'brightness(1.35)';

    const label = document.createElement('label'); // digit label
    label.textContent = String(i);

    const val = document.createElement('em'); // percentage text
    val.textContent = (probs[i] * 100).toFixed(2) + '%';

    bar.append(span, label, val);
    root.appendChild(bar);
  }
}