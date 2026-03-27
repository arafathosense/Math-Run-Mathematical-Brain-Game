/* game.js — steps-aligned track & ticks */

const el = (id) => document.getElementById(id);

/* ===== Config ===== */
// Total questions per run
const TOTAL_QUESTIONS   = 10;
// Whether to use a per-question timer
const USE_TIMER         = true;
// Time limit for each question (ms)
const TIME_LIMIT_MS     = 10000;
// Initial lead (in steps) of hero over monster
const START_GAP_STEPS   = 3;
// Steps hero advances on a correct answer
const STEP_HERO         = 1;
// Steps monster advances on a wrong/timeout
const STEP_MONSTER      = 1;

/* ===== State ===== */
// Current question index (0..TOTAL_QUESTIONS)
let qIndex = 0;
// Count of correct answers
let correct = 0;
// Correct answer for the current problem (0..9)
let currentAnswer = null;
// Whether the game ended (caught or finished)
let gameOver = false;

// Logical positions in "steps" (not pixels)
let heroSteps = START_GAP_STEPS;
let monsterSteps = 0;

// Timer bookkeeping
let timerId = null;
let timerStart = 0;

/* ===== DOM ===== */
// Buttons and UI elements
const btnStart   = el('btnStartGame') || document.querySelector('#btnStartGame');
const btnSubmit  = el('btnSubmit');
const btnClear   = el('btnGameClear');
const problemEl  = el('problemText');
const slotsEl    = el('answerSlots');
const scoreEl    = el('gameScore');
const timerBar   = el('timerBar');
const heroEl     = el('hero');
const monsterEl  = el('monster');
const trackEl    = document.querySelector('.track');

/* ===== Helpers for equation row ===== */
// Show/hide the "= and answer slots" row via CSS visibility (layout remains stable)
function setAnswerRowVisible(visible) {
  // Prefer an explicit ".eq" span; otherwise fallback to the 2nd span under .expr
  const eqEl =
    document.querySelector('.equation .expr .eq') ||
    document.querySelector('.equation .expr > span:nth-child(2)');
  [eqEl, slotsEl].forEach((n) => {
    if (!n) return;
    n.style.visibility = visible ? 'visible' : 'hidden';
  });
}

/* ===== Derived ===== */
// Total number of tick marks equals total questions plus the initial gap
function totalTicks() { return TOTAL_QUESTIONS + START_GAP_STEPS; }

// Usable track width in pixels (minus left/right padding set by --track-pad)
function usableTrackWidth() {
  if (!trackEl) return 0;
  const pad = parseFloat(getComputedStyle(trackEl).getPropertyValue('--track-pad')) || 36;
  return Math.max(0, trackEl.clientWidth - pad * 2);
}

// Pixel distance for one logical "step"
function stepPx() {
  const ticks = totalTicks();
  return ticks > 0 ? usableTrackWidth() / ticks : 0;
}

/* ===== Build the rail and tick marks (strictly aligned with step logic) ===== */
function buildTicks() {
  if (!trackEl) return;
  // Remove previous rails/ticks (if rebuilding)
  trackEl.querySelectorAll('.ticks,.rail').forEach(n => n.remove());

  // Rail (the thin rounded line in the middle)
  const rail = document.createElement('div');
  rail.className = 'rail';
  trackEl.appendChild(rail);

  // Ticks (vertical marks evenly spaced along the rail)
  const ticksBox = document.createElement('div');
  ticksBox.className = 'ticks';
  const count = totalTicks();
  for (let i = 0; i <= count; i++) {
    const t = document.createElement('div');
    t.className = 'tick';
    ticksBox.appendChild(t);
  }
  trackEl.appendChild(ticksBox);
}

/* Convert logical steps → pixels and apply CSS transforms to hero/monster */
function applyActorPositions() {
  const base = parseFloat(getComputedStyle(trackEl).getPropertyValue('--track-pad')) || 36;
  const pxPerStep = stepPx();
  if (monsterEl) monsterEl.style.transform = `translateX(${base + monsterSteps * pxPerStep}px)`;
  if (heroEl)    heroEl.style.transform    = `translateX(${base + heroSteps    * pxPerStep}px)`;
}

/* ===== Problem generation (ensures answer is 0..9) ===== */
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function genProblem() {
  const ops = ['+','-','×','÷'];
  const op = ops[randInt(0, ops.length-1)];

  let a, b, ans;
  if (op === '+') {
    a = randInt(0,9); b = randInt(0,9);
    ans = a + b; if (ans > 9) return genProblem(); // keep answer within 0..9
  } else if (op === '-') {
    a = randInt(0,9); b = randInt(0,9);
    ans = a - b; if (ans < 0) return genProblem();
  } else if (op === '×') {
    a = randInt(0,9); b = randInt(0,9);
    ans = a * b; if (ans > 9) return genProblem();
  } else { // ÷
    b = randInt(1,9);
    ans = randInt(0,9);
    a = ans * b; // ensures a / b = ans exactly (integer division)
  }
  return { a, b, op, ans };
}

function renderProblemText(p) {
  if (problemEl) problemEl.textContent = `${p.a} ${p.op} ${p.b}`;
}

// Visual state of the single answer slot (colors and styles)
function setSlotState(state) {
  const slot = slotsEl?.querySelector('.slot');
  if (!slot) return;
  slot.classList.remove('done','wrong','hint');
  if (state === 'done')  slot.classList.add('done');
  if (state === 'wrong') slot.classList.add('wrong');
}
function resetSlot() {
  const slot = slotsEl?.querySelector('.slot');
  if (!slot) return;
  slot.textContent = '_';
  slot.classList.remove('done','wrong','hint');
}

/* ===== Timer ===== */
function startTimer() {
  if (!USE_TIMER || !timerBar) return;
  stopTimer();
  // Start with a full progress bar (scaleX=1), then shrink to 0
  timerBar.style.transform = 'scaleX(1)';
  timerStart = performance.now();
  timerId = requestAnimationFrame(tick);
}
function stopTimer() {
  if (timerId) cancelAnimationFrame(timerId);
  timerId = null;
  if (timerBar) timerBar.style.transform = `scaleX(0)`;
}
function tick() {
  const elapsed = performance.now() - timerStart;
  const ratio = Math.max(0, Math.min(1, 1 - elapsed / TIME_LIMIT_MS));
  if (timerBar) timerBar.style.transform = `scaleX(${ratio})`;
  if (elapsed >= TIME_LIMIT_MS) {
    onJudge(false, true); // timeout counts as incorrect
    return;
  }
  timerId = requestAnimationFrame(tick);
}

/* ===== Flow ===== */
// Start a new question (generate, render, reset UI states)
function nextQuestion() {
  if (qIndex >= TOTAL_QUESTIONS || gameOver) return;

  const p = genProblem();
  currentAnswer = p.ans;
  renderProblemText(p);
  resetSlot();

  // Ensure "= and answer slots" are visible when a new question appears
  setAnswerRowVisible(true);

  // Clear drawing pad and prediction UI
  window.clearCanvas && window.clearCanvas();

  if (scoreEl) scoreEl.textContent = `${qIndex}/${TOTAL_QUESTIONS}`;
  if (USE_TIMER) startTimer();
}

// Ask the model once and judge the result
async function judgeOnce() {
  if (qIndex >= TOTAL_QUESTIONS || gameOver) return;
  const pred = await window.getDigitPrediction?.();
  if (!pred) return;

  const slot = slotsEl?.querySelector('.slot');
  if (slot) slot.textContent = String(pred.digit);

  const isCorrect = pred.digit === currentAnswer;
  onJudge(isCorrect, false);
}

// Apply judgment: move actors, check caught/finish, and proceed or stop
function onJudge(isCorrect /*, timeout */) {
  stopTimer();

  if (isCorrect) {
    setSlotState('done');
    correct++;
    heroSteps += STEP_HERO;
  } else {
    setSlotState('wrong');
    monsterSteps += STEP_MONSTER;
  }

  // Update visual positions according to steps
  applyActorPositions();

  // Check if the monster caught the hero
  if (monsterSteps >= heroSteps) {
    gameOver = true;
    if (problemEl) problemEl.textContent = `Caught! Correct ${correct}/${TOTAL_QUESTIONS} — press "Start" to try again`;
    qIndex = TOTAL_QUESTIONS;
    if (scoreEl) scoreEl.textContent = `${qIndex}/${TOTAL_QUESTIONS}`;
    resetSlot();                 // reset slot display
    setAnswerRowVisible(false);  // hide "= and answer slots" after game over
    return;
  }

  // Move to next question or finish
  qIndex++;
  if (scoreEl) scoreEl.textContent = `${qIndex}/${TOTAL_QUESTIONS}`;

  if (qIndex >= TOTAL_QUESTIONS) {
    const msg = (correct === TOTAL_QUESTIONS)
      ? 'Stage clear! 10/10 — press "Start" to replay'
      : `Finished! Correct ${correct}/${TOTAL_QUESTIONS} — press "Start" to replay`;
    if (problemEl) problemEl.textContent = msg;
    resetSlot();
    setAnswerRowVisible(false);  // hide slots at the end of the run
    return;
  }

  nextQuestion();
}

/* ===== Start / Reset ===== */
function resetGame() {
  qIndex   = 0;
  correct  = 0;
  currentAnswer = null;
  gameOver = false;

  heroSteps = START_GAP_STEPS;
  monsterSteps = 0;

  stopTimer();
  resetSlot();
  window.clearCanvas && window.clearCanvas();

  // Ensure ticks exist before positioning actors
  buildTicks();
  applyActorPositions();

  // Make sure slots are visible at reset (in case previous run hid them)
  setAnswerRowVisible(true);

  if (scoreEl) scoreEl.textContent = `0/${TOTAL_QUESTIONS}`;
}
function startGame() {
  resetGame();
  nextQuestion();
}

/* ===== Events ===== */
// Primary controls
btnStart?.addEventListener('click', startGame);
btnSubmit?.addEventListener('click', judgeOnce);
btnClear?.addEventListener('click', () => {
  window.clearCanvas && window.clearCanvas();
});

// Rebuild ticks and recompute pixel step size on resize
window.addEventListener('resize', () => {
  buildTicks();
  applyActorPositions();
});

// When the model is ready, enable buttons and fix placeholder text if needed
window.addEventListener('model-ready', () => {
  btnStart && (btnStart.disabled = false);
  btnSubmit && (btnSubmit.disabled = false);
  if (problemEl && /Model loading|点击|Click/.test(problemEl.textContent)) {
    problemEl.textContent = 'Click "Start"';
  }
});

// On first load: build ticks, position actors, ensure slots visible
document.addEventListener('DOMContentLoaded', () => {
  buildTicks();
  applyActorPositions();
  setAnswerRowVisible(true);
});