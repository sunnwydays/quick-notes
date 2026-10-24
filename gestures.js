// Touch gestures: long press on a category, and double-tap or hold-blank-space
// to leave the notes screen.

const LONG_PRESS_MS = 300;

// The finger is usually still down when the next screen opens, and Android's
// own long press would then select whatever is under it. Until that finger
// lifts, block selection everywhere. The click or long-press menu that ends the
// hold would also land on whatever is now under the finger (a category button,
// after going back home), so swallow those until the next touch starts.
const PRESS_ENDS = ['pointerup', 'pointercancel', 'touchend', 'touchcancel'];
let stillHeld = false;
let endingHold = false;

function holdUntilRelease() {
  stillHeld = true;
  endingHold = true;
  document.body.classList.add('still-held');
  const release = () => {
    stillHeld = false;
    document.body.classList.remove('still-held');
    for (const type of PRESS_ENDS) document.removeEventListener(type, release, true);
  };
  for (const type of PRESS_ENDS) document.addEventListener(type, release, true);
}

document.addEventListener('selectstart', (e) => {
  if (stillHeld) e.preventDefault();
}, true);
for (const type of ['click', 'contextmenu']) {
  document.addEventListener(type, (e) => {
    if (!endingHold) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}
document.addEventListener('pointerdown', () => {
  if (!stillHeld) endingHold = false;
}, true);

// Holding a category and letting go opens its editor, the same as tapping Write
// and then it. The button turns black once held long enough, as the cue to let
// go. It opens on the lift rather than when the timer runs, because Android only
// raises the keyboard for a focus() inside a real touch event. Android also
// fires contextmenu on a long press, which counts too. If the browser cancels
// the touch after that, open straight away; the keyboard may then need a tap.
function onHoldRelease(btn, action) {
  let timer = null;
  let armed = false;
  const arm = () => {
    clearTimeout(timer);
    armed = true;
    btn.held = true;
    btn.classList.add('primary');
  };
  const disarm = () => {
    clearTimeout(timer);
    const was = armed;
    armed = false;
    btn.classList.remove('primary');
    return was;
  };
  btn.addEventListener('pointerdown', () => {
    btn.held = false;
    disarm();
    timer = setTimeout(arm, LONG_PRESS_MS);
  });
  btn.addEventListener('pointerup', () => {
    if (disarm()) action();
  });
  btn.addEventListener('pointercancel', () => {
    if (!disarm()) return;
    holdUntilRelease();
    action();
  });
  btn.addEventListener('pointerleave', disarm);
  // Stop the tap's mouse events, which could move focus off the text box.
  btn.addEventListener('touchend', (e) => {
    if (btn.held) e.preventDefault();
  });
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!armed && !btn.held) arm();
  });
}

// The notes and schedule screens, where these back gestures work.
function onListScreen() {
  return Boolean(current) && (current.view === 'entries' || current.view === 'schedule');
}

// Double-tapping anywhere on the notes screen goes back, except on a button,
// where the double tap is more likely two quick presses of it.
document.addEventListener('dblclick', (e) => {
  if (!onListScreen() || e.target.closest('button')) return;
  getSelection().removeAllRanges(); // a double tap on text selects a word
  history.back();
});

// Holding blank space on the notes screen goes back too. Holding a note, the
// title or a button is left alone, so text can still be selected as usual.
const NOT_BLANK = 'button, .entry, .block, h1, h2, .empty, .free, .schedule-note, #undo-bar';
let blankTimer = null;

document.addEventListener('pointerdown', (e) => {
  clearTimeout(blankTimer);
  if (!onListScreen() || e.target.closest(NOT_BLANK)) return;
  blankTimer = setTimeout(() => {
    if (!onListScreen()) return;
    holdUntilRelease();
    history.back();
  }, LONG_PRESS_MS);
});
for (const type of ['pointerup', 'pointercancel']) {
  document.addEventListener(type, () => clearTimeout(blankTimer));
}

// Swiping sideways on the schedule steps through the days, the same as the ‹ ›
// arrows: left for the next day, right for the one before. Touch events rather
// than pointer ones, since the browser can cancel the pointer partway.
const SWIPE_PX = 60;
let swipeStart = null;

document.addEventListener('touchstart', (e) => {
  swipeStart = current && current.view === 'schedule' && e.touches.length === 1
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  // A finger on the move isn't holding blank space.
  if (swipeStart && Math.abs(e.touches[0].clientX - swipeStart.x) > 10) clearTimeout(blankTimer);
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!swipeStart || !current || current.view !== 'schedule') return;
  const dx = e.changedTouches[0].clientX - swipeStart.x;
  const dy = e.changedTouches[0].clientY - swipeStart.y;
  swipeStart = null;
  if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < 2 * Math.abs(dy)) return;
  const btn = $(dx < 0 ? 'day-next' : 'day-prev');
  if (btn.dataset.day) btn.click();
});
