'use strict';

/**
 * Reminder popup renderer.
 *
 * Plays its own cue through WebAudio rather than shipping an audio file: the
 * sound is two short notes, which keeps the repo free of binary assets and
 * matches how the app already generates its icons from code.
 */

const card = document.getElementById('card');
const progress = document.getElementById('progress');

function playCue() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;

    // Two-note rise: audible over a game shutting down, but not alarming.
    for (const [index, freq] of [660, 880].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + index * 0.13;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      // Exponential ramps avoid the click a hard stop would make.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);

      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.24);
    }

    setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch {
    // A missing or blocked audio device must never break the reminder itself.
  }
}

let dismissed = false;

function dismiss() {
  if (dismissed) return;
  dismissed = true;
  card.classList.remove('in');
  card.classList.add('out');
  // The main process closes the window after the same delay; this just plays
  // the slide-out so the two line up.
  setTimeout(() => window.popupApi.dismiss(), 260);
}

document.getElementById('close').addEventListener('click', dismiss);

window.popupApi.onData(({ title, body, silent, autoDismissMs }) => {
  document.getElementById('title').textContent = title || 'League Alert OOG';
  document.getElementById('body').textContent = body || '';

  // Next frame, so the transition runs instead of the card appearing in place.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => card.classList.add('in'));
  });

  if (!silent) playCue();

  if (autoDismissMs > 0) {
    progress.style.transition = `transform ${autoDismissMs}ms linear`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        progress.style.transform = 'scaleX(0)';
      });
    });
    setTimeout(dismiss, autoDismissMs);
  } else {
    progress.style.display = 'none';
  }
});
