// Drawing pad interaction (Pointer Events unify mouse / touch / stylus) + HiDPI adaptation
let ctx, pad, strokes = [], current = null;
let dpr = Math.max(1, window.devicePixelRatio || 1); // device pixel ratio (for retina/HiDPI screens)

export function initPad(canvas, { brushSizeInput, eraserToggle, onDraw } = {}) {
  pad = canvas;
  const cssW = Number(pad.getAttribute('width') || 280);  // logical width from HTML attribute
  const cssH = Number(pad.getAttribute('height') || 280); // logical height from HTML attribute

  // Set the actual canvas resolution according to device pixel ratio
  pad.width  = Math.round(cssW * dpr);
  pad.height = Math.round(cssH * dpr);
  pad.style.width  = cssW + 'px';
  pad.style.height = cssH + 'px';

  ctx = pad.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale drawing context to match DPR
  resetCanvas();

  // Start drawing on pointer down
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pad.setPointerCapture(e.pointerId); // capture pointer until release
    const [x,y] = getPos(e);
    current = {
      eraser: !!eraserToggle?.checked,                  // true if eraser is active
      size: parseInt(brushSizeInput?.value || '24', 10),// brush size
      points: [[x,y]]                                   // start stroke points
    };
  });

  // Continue drawing on pointer move
  pad.addEventListener('pointermove', (e) => {
    if (!current) return; // ignore if not drawing
    e.preventDefault();
    const [x,y] = getPos(e);
    const last = current.points[current.points.length - 1];
    current.points.push([x,y]);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = current.size;
    ctx.strokeStyle = current.eraser ? '#000' : '#fff'; // black = erase, white = draw
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.moveTo(last[0], last[1]);
    ctx.lineTo(x, y);
    ctx.stroke();

    onDraw?.(); // optional callback (e.g., update live preview)
  });

  // Finish drawing on pointer up or cancel
  const end = (e) => {
    if (!current) return;
    pad.releasePointerCapture?.(e.pointerId);
    strokes.push(current); // save the finished stroke
    current = null;
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
}

// Convert pointer event coordinates to canvas coordinates (account for DPR)
function getPos(e){
  const r = pad.getBoundingClientRect();
  return [
    (e.clientX - r.left) * (pad.width / dpr / r.width),
    (e.clientY - r.top)  * (pad.height / dpr / r.height)
  ];
}

// Clear all strokes and reset canvas
export function clearPad() {
  strokes = [];
  resetCanvas();
}

// Undo the last stroke
export function undoStroke() {
  if (strokes.length === 0) return;
  strokes.pop();
  redrawAll();
}

// Reset canvas (fill black background)
function resetCanvas() {
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0,0, pad.width / dpr, pad.height / dpr);
  ctx.restore();
}

// Redraw all saved strokes (used after undo)
function redrawAll() {
  resetCanvas();
  for (const s of strokes) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = s.size;
    ctx.strokeStyle = s.eraser ? '#000' : '#fff';
    ctx.globalCompositeOperation = 'source-over';
    for (let i=1;i<s.points.length;i++){
      const [x0,y0] = s.points[i-1], [x1,y1] = s.points[i];
      ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.stroke();
    }
  }
}

// Export the canvas content as RGBA pixel array (scaled back to CSS resolution, not DPR)
export function getRGBAFromPad() {
  // Draw original canvas into a temporary one
  const tmp = document.createElement('canvas');
  tmp.width  = pad.width;
  tmp.height = pad.height;
  const tctx = tmp.getContext('2d');
  tctx.drawImage(pad, 0, 0);

  // Scale it down to CSS size (remove DPR scaling)
  const out = document.createElement('canvas');
  out.width = Math.round(pad.width / dpr);
  out.height = Math.round(pad.height / dpr);
  const octx = out.getContext('2d');
  octx.drawImage(tmp, 0, 0, out.width, out.height);

  // Return pixel data (Uint8ClampedArray with RGBA values)
  return octx.getImageData(0,0,out.width,out.height).data;
}