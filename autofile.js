// ---------- auto-filing ----------
// Add note on the home screen doesn't ask for a category: each note goes to the
// folder its first words name ("bring blender" goes to Bring as "blender"), or to Todo.

const DEFAULT_FOLDER = 'Todo';

// Words that name a folder, including ways Gboard hears them. They're taken off
// the note. Entries for a folder that doesn't exist (a removed project) are skipped.
// A project's own name works without listing it ("ai tutor" for ai-tutor), so
// projects are only here for mishearings.
const FOLDER_WORDS = {
  Todo: ['todo', 'todos', 'to do', 'to dos', 'two do', 'too do', 'task'],
  Buy: ['buy', 'bye', 'by', 'shopping', 'shop'],
  Bring: ['bring', 'brain', 'ring', 'bring home', 'bring from home', 'pack'],
  Thought: ['thought', 'thoughts', 'thot'],
  Journal: ['journal', 'journal entry', 'diary', 'dear diary'],
  'Working on': ['working on'],
  'Random projs': ['random project', 'random projects', 'random projs', 'project idea', 'idea'],
  'watch later': ['watch', 'watch later', 'to watch'],
  'ai-tutor': ['yeah tutor'],
};

// Ways a note starts that point to a folder. Unlike folder words, they stay in the note.
const FOLDER_CUES = {
  Thought: ['i think', 'i feel', 'i wonder', 'i realized', 'i realised', 'i guess'],
  Journal: ['today was', 'yesterday was', 'tonight was'],
};

// Matches the phrase at the start of a note as whole words, ignoring case, with
// a hyphen or any spacing between words ("to-do", "ai tutor"), plus any
// punctuation after it ("Bring: blender").
function phrasePattern(phrase) {
  const words = phrase.split(/[\s_-]+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${words.join('[\\s_-]+')}(?![\\p{L}\\p{N}])[\\s,.:;!?-]*`, 'iu');
}

function folderRules() {
  const names = categoryNames().filter((c) => c !== SCHEDULE);
  const rules = [];
  const add = (cat, phrase, keep) => {
    if (names.includes(cat)) rules.push({ cat, phrase, keep });
  };
  for (const [cat, words] of Object.entries(FOLDER_WORDS)) for (const w of words) add(cat, w, false);
  for (const [cat, words] of Object.entries(FOLDER_CUES)) for (const w of words) add(cat, w, true);
  for (const name of names) if (!BUILT_IN.includes(name)) add(name, name, false);
  // Longest first, so "bring from home" wins over "bring" and "watch later" over "watch".
  return rules.sort((a, b) => b.phrase.length - a.phrase.length);
}

// Folder words that also match with one typo in the first word ("brng", "bringg").
// Only long, distinctive words, with real words that sit one letter away left out.
const TYPO_WORDS = { Bring: 'bring', Thought: 'thought', Journal: 'journal', Buy: 'shopping' };
const NOT_TYPOS = ['being', 'though', 'through', 'brine', 'bling', 'bringing'];

// True when a and b differ by one insertion, deletion, substitution or swap.
function oneTypoApart(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const [x, y] = [a.slice(i), b.slice(i)];
  if (x.length === y.length) return x.slice(1) === y.slice(1) || (x[0] === y[1] && x[1] === y[0] && x.slice(2) === y.slice(2));
  return (x.length > y.length ? x.slice(1) : x) === (y.length > x.length ? y.slice(1) : y);
}

// The folder for one line of the text box, and the note to save there. A folder
// word on its own ("- bring") isn't taken off, since that would leave nothing.
function fileNote(line) {
  const [, bullet, text] = line.match(/^(-\s*)?(.*)$/s);
  const prefix = bullet ? BULLET : '';
  for (const { cat, phrase, keep } of folderRules()) {
    const match = text.match(phrasePattern(phrase));
    if (!match) continue;
    if (keep) return { cat, text: prefix + text };
    const rest = text.slice(match[0].length);
    if (rest) return { cat, text: prefix + rest };
  }
  const [, first, rest] = text.match(/^([\p{L}]+)[\s,.:;!?-]*(.*)$/su) || [];
  const word = first && first.toLowerCase();
  if (rest && !NOT_TYPOS.includes(word) && word.length >= 4) {
    const names = categoryNames();
    for (const [cat, target] of Object.entries(TYPO_WORDS)) {
      if (names.includes(cat) && oneTypoApart(word, target)) return { cat, text: prefix + rest };
    }
  }
  return { cat: DEFAULT_FOLDER, text: prefix + text };
}

// Shown above the text box while adding: the latest notes in any folder, so
// each one can be seen landing in its folder.
function latestNotes() {
  return data.entries
    .filter((e) => !e.deletedAt && e.category !== SCHEDULE && !PADS.includes(e.category))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
