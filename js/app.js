import { initPad, getRGBAFromPad, undoStroke, clearPad } from './drawing.js';
import { preprocessToMNIST, tensorFrom28x28 } from './processing.js';
import { softmax, argTopK, renderBars } from './utils.js';

// Build metadata flags for debugging/feature gating
window.__APP_BUILD__ = 'app-en-1';
window.__MODEL_READY__ = false;

// Expose a global clear function (used by game.js)
window.clearCanvas = function() {
  clearPad(); // clear the drawing pad
  // Reset prediction-related UI
  const pd = document.getElementById('predDigit'); if (pd) pd.textContent = '—';
  const b  = document.getElementById('bars');      if (b)  b.innerHTML = '';
  const t  = document.getElementById('topk');      if (t)  t.innerHTML = '';
};

// Model path resolved relative to the current page URL
const MODEL_PATH = new URL('./mnist_tfjs_model/model.json', window.location.href).toString();
// Shorthand for getElementById
const $ = (id) => document.getElementById(id);

/* -------- Backend -------- */
async function setupBackend() {
  // Prefer WASM; fall back to WebGL; then to CPU
  try { await tf.setBackend('wasm'); } catch {}
  if (tf.getBackend() !== 'wasm') { try { await tf.setBackend('webgl'); } catch {} }
  if (tf.getBackend() !== 'wasm' && tf.getBackend() !== 'webgl') { await tf.setBackend('cpu'); }

  // Ensure the chosen backend is initialized
  await tf.ready();

  // Update HUD with the active backend
  const be = $('backend'); 
  if (be) be.textContent = `Backend: ${tf.getBackend()}`;
}

/* -------- Model -------- */
let model = null;

async function loadModel() {
  try {
    // Load TFJS GraphModel from URL (model.json + shard files)
    model = await tf.loadGraphModel(MODEL_PATH);

    // Update UI state
    const ms = $('modelStatus'); 
    if (ms) ms.textContent = 'Model: Loaded successfully';

    // Broadcast readiness to any listeners
    window.__MODEL_READY__ = true;
    window.dispatchEvent(new Event('model-ready'));

    // Enable game controls that depend on the model
    $('btnStartGame')?.removeAttribute('disabled');
    $('btnSubmit')?.removeAttribute('disabled');

    // If the problem text was a loading placeholder, reset it
    const prob = $('problemText');
    if (prob && prob.textContent.includes('Model loading')) prob.textContent = 'Click "Start"';
  } catch (e) {
    // Log & show a friendly error with model path and message
    console.error('[app] model load error:', e);
    const ms = $('modelStatus');
    if (ms) ms.innerHTML = `Failed to load model<br><code>${MODEL_PATH}</code><br>${e.message || e}`;
  }
}

/* -------- Inference -------- */
// Try multiple common input/output tensor names (for portability across exports)
async function runGraphModel(x) {
  const inNames  = ['keras_tensor','serving_default_input_1','serving_default_input','x','input_0','args_0'];
  const outNames = ['output_0','Identity','StatefulPartitionedCall:0','Identity_0','Identity_1','dense/Sigmoid'];

  // Try executeAsync with (inName -> x) and a candidate outName
  for (const iName of inNames) {
    for (const oName of outNames) {
      try {
        const y = await model.executeAsync({ [iName]: x }, oName);
        return Array.isArray(y) ? y[0] : y;
      } catch {}
    }
  }

  // Fallback: try predict (for LayersModel or simple GraphModels)
  const y = model.predict(x);
  return Array.isArray(y) ? y[0] : y;
}

// End-to-end: read canvas → preprocess → run model → update UI
async function getDigitPrediction() {
  if (!model) return null;

  // 1) Grab RGBA pixels from the drawing pad
  const rgba = getRGBAFromPad();

  // 2) Preprocess to MNIST style 28×28 float array
  const { img28, debug } = preprocessToMNIST(rgba, { srcW: 280, srcH: 280, blur: false, center: true });

  // 2.1) Optional 28×28 preview (nearest-neighbor upscaling; no smoothing)
  const preview = document.getElementById('preview28');
  if (preview) {
    const pctx = preview.getContext('2d');
    const prev = pctx.createImageData(28,28);
    for (let i=0;i<28*28;i++){
      const v = Math.round(img28[i]*255);
      prev.data[i*4+0]=v; prev.data[i*4+1]=v; prev.data[i*4+2]=v; prev.data[i*4+3]=255;
    }
    const tmp = document.createElement('canvas'); tmp.width=28; tmp.height=28;
    tmp.getContext('2d').putImageData(prev,0,0);
    pctx.imageSmoothingEnabled = false;
    pctx.clearRect(0,0,preview.width,preview.height);
    pctx.drawImage(tmp,0,0,preview.width,preview.height);
  }

  // 2.2) Show debug string (threshold, inversion, ROI, scale, etc.)
  const dbg = document.getElementById('debug'); 
  if (dbg) dbg.textContent = debug;

  // 3) To tensor → inference → latency
  const x  = tensorFrom28x28(img28);
  const t0 = performance.now();
  const y  = await runGraphModel(x);
  const t1 = performance.now();
  const lt = $('latency'); 
  if (lt) lt.textContent = `Latency: ${(t1-t0).toFixed(1)} ms`;

  // 4) Normalize outputs to probabilities
  const raw   = Array.from(await y.data()); // Float32Array → Array
  // If already looks like probs (>=0 and sums to ~1), keep; else apply softmax
  const probs = (raw.every(v => v >= 0) && Math.abs(raw.reduce((a,b)=>a+b,0) - 1) < 1e-3)
    ? raw : softmax(raw);

  // 5) Top-k and UI updates
  const top = argTopK(probs, 10);

  const barsEl = document.getElementById('bars'); 
  if (barsEl) renderBars(barsEl, probs, top[0].i);

  const pd = document.getElementById('predDigit'); 
  if (pd) pd.textContent = String(top[0].i);

  const tk = document.getElementById('topk'); 
  if (tk) tk.innerHTML = top.slice(0,3).map(t => `<li>#${t.i} : ${(t.p*100).toFixed(2)}%</li>`).join('');

  // 6) Cleanup tensors to avoid memory leaks
  tf.dispose([x,y]);
  return { digit: top[0].i, conf: top[0].p, probs };
}
window.getDigitPrediction = getDigitPrediction;

/* -------- UI Binding -------- */
function bindUI() {
  const pad          = $('pad');
  const brushSize    = $('brushSize');
  const eraserToggle = $('eraserToggle');
  const clearBtn     = $('clearBtn');      // hidden legacy button (if present)
  const undoBtn      = $('undoBtn');
  const uploadInput  = $('uploadInput');
  const gameClearBtn = $('btnGameClear');  // visible clear button

  // Initialize drawing pad with optional controls
  if (pad) initPad(pad, { brushSizeInput: brushSize, eraserToggle });

  // Wire up clear actions (both buttons clear the same way)
  clearBtn?.addEventListener('click', window.clearCanvas);
  gameClearBtn?.addEventListener('click', window.clearCanvas);

  // Undo last stroke if supported
  undoBtn?.addEventListener('click', () => undoStroke());

  // Allow uploading an image and drawing it onto the pad
  uploadInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !pad) return;

    const img = new Image();
    img.onload = () => {
      const ctx = pad.getContext('2d');
      window.clearCanvas();

      // Draw the uploaded image scaled to pad resolution
      const temp = document.createElement('canvas');
      temp.width = img.width; temp.height = img.height;
      temp.getContext('2d').drawImage(img, 0, 0);
      ctx.drawImage(temp, 0, 0, pad.width, pad.height);
    };
    img.src = URL.createObjectURL(file);
    e.target.value = ''; // reset input so selecting the same file again will trigger 'change'
  });
}

/* -------- Entry -------- */
// Boot sequence: choose backend → load model → bind UI
document.addEventListener('DOMContentLoaded', async () => {
  await setupBackend();
  await loadModel();
  bindUI();
});