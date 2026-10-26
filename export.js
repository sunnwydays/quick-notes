// ---------- export ----------

function exportText() {
  return orderedCategories()
    .map((cat) => {
      const items = entriesFor(cat).map((e) => `[${formatFull(e.createdAt)}]\n${e.text}`);
      return items.length ? `# ${cat}\n\n${items.join('\n\n')}` : null;
    })
    .filter(Boolean)
    .join('\n\n\n');
}

function downloadExport() {
  const blob = new Blob([exportText()], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dash-${formatFull(new Date().toISOString()).slice(0, 10)}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('export-btn').addEventListener('click', downloadExport);
$('copy-btn').addEventListener('click', () => {
  navigator.clipboard
    .writeText(exportText())
    .then(() => alert('Copied all notes.'))
    .catch(() => alert('Copy failed. Use Export in the menu on the home screen instead.'));
});
