// js/help.js — onboarding modal (always shows on refresh)
(() => {
  // Grab modal overlay and controls
  const overlay   = document.getElementById('helpOverlay');
  const btnHelp   = document.getElementById('btnHelp');
  const btnGotIt  = document.getElementById('helpGotIt');

  // If any required element is missing, abort initialization
  if (!overlay || !btnHelp || !btnGotIt) return;

  // Remember which element had focus before opening (for accessibility)
  let lastFocused = null;

  // Open the modal: show, move focus inside, and lock page scroll
  function openHelp() {
    lastFocused = document.activeElement;
    overlay.hidden = false;
    btnGotIt.focus(); // move keyboard focus to a safe control in the dialog
    document.documentElement.style.overflow = 'hidden'; // prevent background page scroll
  }

  // Close the modal: hide, restore scroll, and return focus to previous element
  function closeHelp() {
    overlay.hidden = true;
    document.documentElement.style.overflow = '';
    lastFocused?.focus?.();
  }

  // Auto-open on every page load (delayed slightly to avoid jank)
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(openHelp, 150);
  });

  // Open when the floating Help button is clicked
  btnHelp.addEventListener('click', openHelp);

  // Close when the "Got it" button is clicked
  btnGotIt.addEventListener('click', closeHelp);

  // Click outside the dialog content (on the overlay) to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeHelp();
  });

  // Press Escape to close (only when the modal is visible)
  document.addEventListener('keydown', (e) => {
    if (!overlay.hidden && e.key === 'Escape') closeHelp();
  });
})();
