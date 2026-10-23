// Touch gestures: long press on a category, and double-tap or hold-blank-space
// to leave the notes screen.

// Holding a category opens its notes, the same as tapping Read and then it.
// Android also fires contextmenu on a long press, which counts too, so the
// press still works if the browser cancels the touch before the timer runs.
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

function onLongPress(btn, action) {
  let timer = null;
  const fire = () => {
    clearTimeout(timer);
    if (btn.held) return;
    btn.held = true;
    holdUntilRelease();
    action();
  };
  btn.addEventListener('pointerdown', () => {
    btn.held = false;
    timer = setTimeout(fire, LONG_PRESS_MS);
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
    btn.addEventListener(type, () => clearTimeout(timer));
  }
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    fire();
  });
}

// Double-tapping anywhere on the notes screen goes back, except on a button,
// where the double tap is more likely two quick presses of it.
document.addEventListener('dblclick', (e) => {
  if (!current || current.view !== 'entries' || e.target.closest('button')) return;
  getSelection().removeAllRanges(); // a double tap on text selects a word
  history.back();
});

// Holding blank space on the notes screen goes back too. Holding a note, the
// title or a button is left alone, so text can still be selected as usual.
const NOT_BLANK = 'button, .entry, h1, .empty, #undo-bar';
let blankTimer = null;

document.addEventListener('pointerdown', (e) => {
  clearTimeout(blankTimer);
  if (!current || current.view !== 'entries' || e.target.closest(NOT_BLANK)) return;
  blankTimer = setTimeout(() => {
    if (!current || current.view !== 'entries') return;
    holdUntilRelease();
    history.back();
  }, LONG_PRESS_MS);
});
for (const type of ['pointerup', 'pointercancel']) {
  document.addEventListener(type, () => clearTimeout(blankTimer));
}
