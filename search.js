// ---------- search ----------
// Typing in the box on the home screen swaps the category buttons for the notes
// that match, grouped by category. A note matches when it contains every word
// typed, in any order, ignoring case. Tapping a category's heading opens its notes.

function searchTerms() {
  return $('search').value.toLowerCase().split(/\s+/).filter(Boolean);
}

function renderSearch() {
  const terms = searchTerms();
  const searching = terms.length > 0;
  $('home').classList.toggle('searching', searching);
  $('categories').hidden = searching;
  $('read-btn').hidden = searching;
  $('search-clear').hidden = !$('search').value;
  const box = $('search-results');
  box.hidden = !searching;
  box.replaceChildren();
  if (!searching) return;
  box.classList.toggle('with-times', showTimes);

  let total = 0;
  let groups = 0;
  for (const cat of orderedCategories()) {
    const hits = entriesFor(cat).filter((e) => {
      const text = e.text.toLowerCase();
      return terms.every((w) => text.includes(w));
    });
    if (!hits.length) continue;
    total += hits.length;
    groups++;

    const head = document.createElement('button');
    head.className = 'group-head';
    head.textContent = `${label(cat)} (${hits.length})`;
    head.addEventListener('click', () => go({ view: 'entries', cat }));
    const notes = document.createElement('div');
    for (const entry of hits) {
      const div = document.createElement('div');
      div.className = 'entry';
      div.append(entryBody(entry));
      notes.append(div);
    }
    box.append(head, notes);
  }

  const summary = document.createElement('p');
  summary.className = 'empty';
  summary.textContent = total
    ? `${total} note${total === 1 ? '' : 's'} in ${groups} categor${groups === 1 ? 'y' : 'ies'}.`
    : 'No notes match.';
  box.prepend(summary);
}

$('search').addEventListener('input', renderSearch);
// Search / Enter on the keyboard just puts the keyboard away; results are already showing.
$('search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('search').blur();
});
function clearSearch() {
  $('search').value = '';
  renderSearch();
}
$('search-clear').addEventListener('click', clearSearch);

// Two taps in a row, or a press-and-hold, on empty space (not on a note, heading or the box)
// clear the search. Timed by hand because phones don't reliably fire dblclick.
function isBlank(e) {
  return searchTerms().length > 0 &&
    (e.target === $('home') || e.target === $('search-results') || e.target.classList.contains('empty'));
}

let holdTimer = 0;
let held = false;
$('home').addEventListener('pointerdown', (e) => {
  held = false;
  if (!isBlank(e)) return;
  holdTimer = setTimeout(() => {
    held = true;
    clearSearch();
  }, 600);
});
for (const type of ['pointerup', 'pointercancel', 'pointermove']) {
  $('home').addEventListener(type, () => clearTimeout(holdTimer));
}

let lastBlankTap = 0;
$('home').addEventListener('click', (e) => {
  if (held) { held = false; return; }
  if (!isBlank(e)) return;
  const now = Date.now();
  if (now - lastBlankTap < 400) {
    lastBlankTap = 0;
    clearSearch();
  } else {
    lastBlankTap = now;
  }
});
