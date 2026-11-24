import assert from 'node:assert/strict';
import test from 'node:test';
import { snapTimelineDrop, timelineDropPlace, arrangeTimelineDrop, resizeWindow, fitResize, resizeDayBlock, fitTimelineDrop, fullOpening, foldTail, applyOverrun, applyWake, dayLoad, placeInDay, lockShownTimes, insertPopup, layoutDay, restackBeforeScreensOff, suggestGhosts, toggleBlockPin, dropStaleFixed, parseQuickAdd, fitTemplateAnchors } from '../plan-engine.js';

const block = (id, size, fields = {}) => ({ id, size, tier: 'medium', ...fields });
const times = ({ blocks }) => blocks.map(({ id, start, until }) => [id, start, until]);

test('starts at wake with the template offset, omits shelf items and includes gaps', () => {
  const day = {
    wake: '07:30', startOffset: 5,
    blocks: [block('shelf', 30, { shelf: true }), block('one', 30), block('two', 120), block('three', 45)],
  };
  const before = structuredClone(day);
  assert.deepEqual(times(layoutDay(day)), [['one', 455, 485], ['two', 490, 610], ['three', 620, 665]]);
  assert.deepEqual(day, before);
});

test('keeps fixed anchors, even if their reservation comes later in the stack', () => {
  const day = { blocks: [block('work', 45), block('meal', 30, { pinned: '07:30', tier: 'fixed' }), block('next', 30)] };
  assert.deepEqual(times(layoutDay(day)), [['meal', 450, 480], ['work', 485, 530], ['next', 540, 570]]);
});

test('allows contiguous fixed anchors through midnight', () => {
  const day = {
    wake: '21:00',
    blocks: [
      block('work', 60), block('wind-down', 60, { pinned: '22:00', tier: 'fixed' }),
      block('sleep', 60, { pinned: '23:00', tier: 'fixed' }),
    ],
  };
  assert.deepEqual(times(layoutDay(day)), [['work', 1260, 1320], ['wind-down', 1320, 1380], ['sleep', 1380, 1440]]);
  assert.deepEqual(layoutDay(day).bumped, []);
});

test('keeps pinned and flexible blocks after 22:00 when they fit by midnight', () => {
  const day = {
    blocks: [block('late pin', 45, { pinned: '22:15' }), block('late flexible', 50)],
  };
  const result = layoutDay(day);
  assert.deepEqual(times(result), [['late pin', 1335, 1380], ['late flexible', 1390, 1440]]);
  assert.deepEqual(result.bumped, []);
});

test('bumps lower priority work first and only fixed pins survive a later wake unchanged', () => {
  const day = {
    wake: '22:20',
    blocks: [
      block('old-pin', 30, { pinned: '19:00', tier: 'must' }),
      block('meal', 30, { pinned: '19:00', tier: 'fixed' }),
      block('low', 45, { tier: 'low' }), block('must', 60, { tier: 'must' }),
    ],
  };
  const result = layoutDay(day);
  assert.deepEqual(result.bumped.map((b) => b.id), ['old-pin', 'low']);
  assert.deepEqual(times(result), [['meal', 1140, 1170], ['must', 1340, 1400]]);
});

test('preserves an imported Schedule until the planner changes the day', () => {
  const day = { imported: true, blocks: [block('early', 45, { importedStart: 360, duration: 25 })] };
  assert.deepEqual(times(layoutDay(day)), [['early', 360, 385]]);
});

test('pinning a block in an imported Schedule preserves the times of nonoverlapping blocks', () => {
  const task = block('task', 45, { importedStart: 1245 });
  const review = block('review', 15, { importedStart: 1290 });
  const windDown = block('wind down', 60, { importedStart: 1320 });
  const day = { imported: true, wake: '20:45', blocks: [task, review, windDown] };
  const pinned = { ...windDown, pinned: '22:00' };
  const updated = placeInDay(day, [task, review, pinned], pinned);
  const layout = layoutDay(updated);
  assert.deepEqual(times(layout), times(layoutDay(day)));
  assert.deepEqual(layout.blocks.map((item) => item.pinned ?? null), [null, null, '22:00']);
  assert.deepEqual(layout.bumped, []);
});

test('unpinning a fixed template block lets it move like any other block', () => {
  const day = { blocks: [block('wash', 24, { pinned: '07:00', tier: 'fixed', templateAnchor: true })] };
  const unpinned = toggleBlockPin(day, 'wash', null);
  assert.equal(unpinned.blocks[0].tier, 'medium');
  assert.equal(dropStaleFixed({ id: 'old', tier: 'fixed', pinned: null }).tier, 'medium');
  assert.equal(dropStaleFixed({ id: 'kept', tier: 'fixed', pinned: '07:00' }).tier, 'fixed');
});

test('pin toggles preserve the displayed stack until an intentional reschedule', () => {
  const day = {
    blocks: [block('early', 45), block('middle', 30, { pinned: '09:00' }), block('late', 30)],
  };
  const original = times(layoutDay(day));
  const unpinned = toggleBlockPin(day, 'middle', null);
  assert.deepEqual(times(layoutDay(unpinned)), original);
  assert.equal(layoutDay(unpinned).blocks[1].pinned, null);
  const repinned = toggleBlockPin(unpinned, 'middle', '09:00');
  assert.deepEqual(times(layoutDay(repinned)), original);
  assert.equal(layoutDay(repinned).blocks[1].pinned, '09:00');
  assert.equal(toggleBlockPin(unpinned, 'middle', '09:15'), null);

  const { day: rescheduled } = applyOverrun(unpinned, 'early', 475);
  assert.deepEqual(times(layoutDay(rescheduled)), [['early', 420, 475], ['middle', 485, 515], ['late', 520, 550]]);
});

test('an old saved tail folds into the block length', () => {
  assert.deepEqual(foldTail(block('cardio', 60, { tail: 30 })), block('cardio', 90));
  assert.deepEqual(foldTail(block('cardio', 60, { duration: 45, tail: 15 })), { ...block('cardio', 60), duration: 60 });
  assert.deepEqual(foldTail(block('plain', 30, { tail: 0 })), block('plain', 30));
});

test('an overrun keeps the earlier stack and fixed time, and moves work from that block down', () => {
  const day = {
    imported: true,
    blocks: [
      block('earlier', 30, { importedStart: 420 }),
      block('over', 30, { importedStart: 450 }),
      block('meal', 30, { importedStart: 500, pinned: '08:20', tier: 'fixed' }),
      block('flex', 45, { importedStart: 540 }),
      block('bump-me', 30, { importedStart: 600, pinned: '10:00', tier: 'low' }),
    ],
  };
  assert.equal(applyOverrun(day, 'over', 449), null);
  const { day: changed, timed } = applyOverrun(day, 'over', 615);
  assert.equal(timed.start, 450);
  const result = layoutDay(changed);
  assert.deepEqual(times(result), [['earlier', 420, 450], ['over', 450, 500], ['meal', 500, 530], ['flex', 625, 670]]);
  assert.deepEqual(result.bumped.map((b) => b.id), ['bump-me']);
});

test('load excludes fixed time, exercise, and mandatory gaps', () => {
  const day = { wake: '19:00' };
  const blocks = [
    { ...block('work', 45), start: 1140, until: 1185 },
    { ...block('meal', 30, { tier: 'fixed' }), start: 1195, until: 1225 },
    { ...block('cardio', 60, { kind: 'exercise' }), start: 1235, until: 1295 },
  ];
  assert.deepEqual(dayLoad(day, blocks), { usable: 80, placed: 45, ratio: 45 / 80 });
});

test('ghosts reserve the shelf first and suggest each remaining Todo once without changing the plan', () => {
  const days = {
    '2026-11-23': { template: 'Recovery / social', blocks: [] },
    '2026-11-24': { blocks: [] },
    '2026-11-25': { blocks: [block('shelf', 45, { shelf: true, goal: 'g', todoId: 's' })] },
  };
  const tray = [block('duplicate shelf', 45, { todoId: 's' }), block('budget', 45, { goal: 'g' }),
    block('todo', 30, { todoId: 't' }), block('duplicate todo', 30, { todoId: 't' })];
  const before = structuredClone({ days, tray });
  const ghosts = suggestGhosts(days, tray, { g: 1.25 });
  assert.deepEqual(ghosts.map(({ key, block }) => [key, block.id, block.start]),
    [['2026-11-25', 'shelf', 420], ['2026-11-24', 'todo', 420]]);
  assert.deepEqual({ days, tray }, before);
});

test('ghosts respect fixed blocks, tomorrow’s exam, and the strict load ceiling', () => {
  const days = {
    '2026-11-23': { wake: '15:30', blocks: [
      block('project', 45, { text: 'AI tutor', pinned: '16:30' }),
      block('dinner', 30, { text: 'Dinner', tier: 'fixed', pinned: '19:00' }),
    ] },
    '2026-11-24': { template: 'Exam / interview', wake: '21:15', blocks: [] },
  };
  const tray = [
    block('study', 45, { text: 'Study new material' }),
    block('prep', 30, { text: 'Exam prep', deadline: '2026-11-24T09:00' }),
    block('almost', 30, { text: 'Finish it', kind: 'almost' }),
  ];
  assert.deepEqual(suggestGhosts(days, tray).map(({ key, block }) => [key, block.id, block.start]), [
    ['2026-11-23', 'prep', 930], ['2026-11-23', 'almost', 1110],
  ]);
  assert.deepEqual(suggestGhosts({ '2026-11-24': days['2026-11-24'] }, [block('load', 30, { text: 'Read' })]), []);
});

test('a project ghost ends exactly when the meal begins', () => {
  const days = { '2026-11-23': { blocks: [
    block('lunch', 30, { text: 'Lunch', tier: 'fixed', pinned: '11:30' }),
  ] } };
  const [ghost] = suggestGhosts(days, [block('project', 45, { text: 'AI tutor' })]);
  assert.deepEqual([ghost.block.start, ghost.block.until], [645, 690]);
});

test('a late wake keeps fixed commitments through screens-off and bumps flexible work', () => {
  const day = { imported: true, blocks: [
    block('fixed meeting', 30, { importedStart: 1140, tier: 'fixed' }),
    block('must', 45, { importedStart: 1170, tier: 'must' }),
    block('low', 60, { importedStart: 1225, tier: 'low' }),
    block('screens off', 60, { importedStart: 1320, tier: 'fixed', pinned: '22:00' }),
  ] };
  const result = layoutDay(restackBeforeScreensOff(applyWake(day, '20:45')));
  assert.deepEqual(times(result), [['fixed meeting', 1140, 1170], ['must', 1245, 1290], ['screens off', 1320, 1380]]);
  assert.deepEqual(result.bumped.map(({ id }) => id), ['low']);
});

test('a later wake only pushes blocks it overlaps', () => {
  const day = { blocks: [
    block('early', 30, { restackStart: 480, restackUntil: 510 }),
    block('next', 30, { restackStart: 530, restackUntil: 560 }),
    block('later', 60, { restackStart: 720, restackUntil: 780 }),
  ] };
  const result = layoutDay(restackBeforeScreensOff(applyWake(day, '08:15')));
  assert.deepEqual(times(result), [['early', 495, 525], ['next', 530, 560], ['later', 720, 780]]);
});

test('a short interruption uses only the time it needs from a pinned buffer', () => {
  const day = { blocks: [
    block('buffer', 45, { text: 'Buffer', pinned: '10:00', tier: 'fixed' }),
    block('meal', 30, { pinned: '10:45', tier: 'fixed' }),
  ] };
  const { day: updated } = insertPopup(day, block('popup', 15), 610);
  assert.deepEqual(times(layoutDay(updated)), [
    ['buffer', 600, 610], ['popup', 610, 625], ['popup-free', 625, 645], ['meal', 645, 675],
  ]);
});

test('a block placed at a time without a pin keeps that time until the stack is re-timed', () => {
  const day = { blocks: [block('lunch', 50, { pinned: '11:30', tier: 'fixed' }), block('free', 30)] };
  const dropped = block('drop', 45, { pinned: null });
  const updated = placeInDay(day, [...day.blocks, dropped], dropped, 14 * 60);
  const layout = layoutDay(updated);
  assert.deepEqual(times(layout).find(([id]) => id === 'drop'), ['drop', 840, 885]);
  assert.equal(layout.blocks.find((item) => item.id === 'drop').pinned, null);
});

test('deleting or resizing a block leaves every other block at the time it showed', () => {
  const day = toggleBlockPin({ blocks: [
    block('breakfast', 30), block('commute', 46, { restackStart: 809 }), block('cardio', 55, { pinned: '14:15' }),
  ] }, 'cardio', '14:15');
  const deleted = lockShownTimes(day, day.blocks.filter(({ id }) => id !== 'cardio'));
  assert.deepEqual(times(layoutDay(deleted)), [['breakfast', 420, 450], ['commute', 809, 855]]);
  const resized = lockShownTimes(day, day.blocks.map((b) => b.id === 'breakfast' ? { ...b, size: 90 } : b));
  assert.deepEqual(times(layoutDay(resized)), [['breakfast', 420, 510], ['commute', 809, 855], ['cardio', 855, 910]]);
});

test('placing a block on others pushes them down, around pins, and leaves earlier blocks alone', () => {
  const day = { blocks: [
    block('early', 30, { restackStart: 480 }), block('one', 30), block('two', 60, { restackStart: 600 }),
    block('three', 30, { restackStart: 660 }), block('pin', 30, { pinned: '11:30' }), block('later', 30, { restackStart: 800 }),
  ] };
  const placed = placeInDay(day, day.blocks, day.blocks[1], 610);
  assert.deepEqual(times(layoutDay(placed)),
    [['early', 480, 510], ['one', 610, 640], ['pin', 690, 720], ['two', 720, 780], ['three', 780, 810], ['later', 810, 840]]);
});

test('growing a block pushes the next one down', () => {
  const day = { blocks: [block('one', 30, { restackStart: 600 }), block('two', 30, { restackStart: 630 })] };
  const grown = lockShownTimes(day, day.blocks.map((b) => b.id === 'one' ? { ...b, size: 60 } : b), 'one');
  assert.deepEqual(times(layoutDay(grown)), [['one', 600, 660], ['two', 660, 690]]);
});

test('routine, meals and buffers can run straight into the next session', () => {
  const blocks = ['routine', 'meal', 'buffer'].map(kind => block(kind, 45, { kind }));
  blocks.push(block('short', 34), block('long', 35), block('last', 5));
  assert.deepEqual(layoutDay({ blocks }).blocks.map(item => item.start), [420, 465, 510, 555, 594, 639]);
});

test('after Dinner practice fits only with an explicit skipped break', () => {
  const day = { blocks: [block('meal', 65, { kind: 'meal', pinned: '17:00' }), block('gym', 60, { pinned: '18:30' })] };
  const stack = layoutDay(day).blocks;
  const practice = block('practice', 35);
  assert.equal(fitTimelineDrop(stack, practice, 1085), null);
  assert.equal(fitTimelineDrop(stack, practice, 1085, true).duration, 25);
  assert.equal(fitTimelineDrop(stack, practice, 1086, true), null);
  assert.equal(fitTimelineDrop(stack, { ...practice, duration: 25, originalDuration: 35 }, 1086, true), null);
  assert.equal(fullOpening(stack, practice, 1085, 1440, 1085), 1180);
  assert.equal(fullOpening([], practice, 420, 1320, 420), 420);
});

test('a drop shifts flexible work around a pin before shortening the dragged session', () => {
  const stack = [
    { ...block('work', 30), start: 600, until: 630 },
    { ...block('fixed', 20, { pinned: '10:50' }), start: 650, until: 670 },
  ];
  const fit = fitTimelineDrop(stack, block('practice', 35), 600);
  assert.equal(fit.duration, 35);
  assert.deepEqual(times({ blocks: fit.timed }), [['work', 675, 705], ['fixed', 650, 670]]);
  assert.equal(fitTimelineDrop(stack, block('practice', 35), 611).duration, 34);
  assert.equal(fitTimelineDrop(stack, block('practice', 35), 651), null);
});

test('events can touch either edge of routines, meals and buffers', () => {
  const event = block('event', 45, { kind: 'event' });
  for (const fields of [{ text: 'Shower and read' }, { kind: 'routine' }, { kind: 'meal' }, { kind: 'buffer' }]) {
    const anchor = { ...block('anchor', 30, fields), pinned: '22:00', start: 1320, until: 1350 };
    assert.equal(fitTimelineDrop([anchor], event, 1275).duration, 45);
    assert.equal(fitTimelineDrop([anchor], event, 1350).duration, 45);
    assert.equal(fullOpening([anchor], event, 1275, 1350, 1275), 1275);
    const task = { ...event, start: 420, until: 465, pinned: '07:00' };
    assert.equal(fitTimelineDrop([task], anchor, 465).duration, 30);
    assert.deepEqual(layoutDay({ blocks: [event, block('middle', 30, fields), block('last', 45)] }).blocks
      .map(item => item.start), [420, 465, 495]);
  }
});

test('resizing uses the opening below first, then above, for pinned and unpinned blocks', () => {
  for (const pinned of [null, '21:09']) {
    const buffer = block('Buffer', 45, { pinned, restackStart: 1269 });
    const day = { blocks: [block('before', 20, { restackStart: 1210 }), buffer,
      block('Shower and read', 60, { pinned: '22:00' })] };
    const window = resizeWindow(day, buffer.id);
    assert.deepEqual(fitResize(window, 48), { start: 1269, until: 1317 });
    assert.deepEqual(fitResize(window, 100), { start: 1230, until: 1320 });
    const range = fitResize(window, 70);
    const updated = resizeDayBlock(day, buffer, range);
    const expected = [['before', 1210, 1230], ['Buffer', 1250, 1320], ['Shower and read', 1320, 1380]];
    assert.deepEqual(times(layoutDay(updated)), expected);
    assert.deepEqual(times(layoutDay({ ...updated, pinLayout: undefined })), expected);
    assert.equal(updated.blocks[1].pinned, pinned && '20:50');
  }
});

test('resizing can recover a saved overlap and grow upward at midnight', () => {
  const buffer = block('Buffer', 70, { pinned: '21:09' });
  const day = { blocks: [buffer, block('Shower', 60, { pinned: '22:00' })] };
  assert.deepEqual(fitResize(resizeWindow(day, buffer.id), 70), { start: 1250, until: 1320 });
  const late = { blocks: [block('late', 25, { pinned: '23:35' })] };
  assert.deepEqual(fitResize(resizeWindow(late, 'late'), 60), { start: 1380, until: 1440 });
});

test('a drag near the bottom of Study 454 lands after its break regardless of the grab offset', () => {
  const task = block('next study', 47);
  for (const pinned of [null, '18:15']) {
    const study = { ...block('Study 454', 75, { pinned }), start: 1095, until: 1170 };
    const stack = [study, { ...block('later', 30, { pinned: '20:45' }), start: 1245, until: 1275 }];
    const drop = (item, pointer, top) => arrangeTimelineDrop(stack, item,
      timelineDropPlace(stack, pointer, snapTimelineDrop(stack, item, pointer, top, 420)), 420);
    for (const [pointer, top] of [[1155, 1151], [1169, 1170], [1172, 1151], [1177, 1172], [1170, 1170]]) {
      const fit = drop(task, pointer, top);
      assert.equal(fit.start, 1180);
      assert.equal(fit.duration, 47);
    }
    assert.equal(drop(task, 1188, 1185).start, 1185);
    assert.equal(drop(block('Dinner', 45, { kind: 'meal' }), 1155, 1151).start, 1170);
  }
});

test('dropping on a block inserts before its upper half or after its lower half', () => {
  const deer = block('deer project', 90);
  for (const pinned of [null, '14:15']) {
    const stack = [
      { ...block('Upload travel photos', 45), start: 810, until: 855 },
      { ...block('Workout', 60, { pinned }), start: 855, until: 915 },
    ];
    const place = (pointer) => timelineDropPlace(stack, pointer, pointer);
    assert.deepEqual(place(870), { before: 'Workout' });
    assert.deepEqual(place(900), { after: 'Workout' });
    assert.deepEqual(place(930), { at: 930 });

    const after = arrangeTimelineDrop(stack, deer, place(900), 420);
    assert.deepEqual([after.start, after.until], [925, 1015]);
    assert.deepEqual(times({ blocks: after.timed }), times({ blocks: stack }));

    const before = arrangeTimelineDrop(stack, deer, place(870), 420);
    if (pinned) assert.equal(before, null);
    else {
      assert.deepEqual([before.start, before.until], [865, 955]);
      assert.deepEqual(times({ blocks: before.timed }), [['Upload travel photos', 810, 855], ['Workout', 965, 1025]]);
    }
  }
});

test('quick-add pulls a time and length out of the title', () => {
  assert.deepEqual(parseQuickAdd('gym 5pm 1h'), { text: 'gym', start: 17 * 60, duration: 60 });
  assert.deepEqual(parseQuickAdd('call mom 30m'), { text: 'call mom', duration: 30 });
  assert.deepEqual(parseQuickAdd('study 454 9-11'), { text: 'study 454', start: 9 * 60, duration: 120 });
  assert.deepEqual(parseQuickAdd('lab 2:30pm 90m'), { text: 'lab', start: 14 * 60 + 30, duration: 90 });
  assert.deepEqual(parseQuickAdd('run at 5 for 1.5h'), { text: 'run', start: 17 * 60, duration: 90 });
  assert.deepEqual(parseQuickAdd('meeting 17:00 45 min'), { text: 'meeting', start: 17 * 60, duration: 45 });
  assert.deepEqual(parseQuickAdd('read 1h30m'), { text: 'read', duration: 90 });
  assert.deepEqual(parseQuickAdd('class 11-1pm'), { text: 'class', start: 11 * 60, duration: 120 });
  assert.deepEqual(parseQuickAdd('dinner 6-7'), { text: 'dinner', start: 18 * 60, duration: 60 });
});

test('quick-add leaves numbers that are not times alone', () => {
  assert.deepEqual(parseQuickAdd('study 454'), { text: 'study 454' });
  assert.deepEqual(parseQuickAdd('ECE 454 lab 3'), { text: 'ECE 454 lab 3' });
  assert.deepEqual(parseQuickAdd('call 911'), { text: 'call 911' });
  assert.deepEqual(parseQuickAdd('5pm'), { text: '5pm' });
  assert.deepEqual(parseQuickAdd(''), { text: '' });
});

test('template blocks fit around blocks already on the day instead of pushing them', () => {
  const anchor = (id, start, size, kind) => block(id, size, { kind, templateAnchor: true, restackStart: start, restackUntil: start + size });
  const kept = [block('foosim', 30, { restackStart: 1146 }), block('prelab', 55, { restackStart: 1255 })];
  const fitted = fitTemplateAnchors(kept, [anchor('buffer', 1260, 60, 'buffer'), anchor('shower', 1320, 60, 'routine')]);
  assert.deepEqual(fitted.map(({ id, restackStart, restackUntil }) => [id, restackStart, restackUntil]), [['shower', 1320, 1380]]);
  const trimmed = fitTemplateAnchors([block('prelab', 30, { restackStart: 1255 })], [anchor('buffer', 1260, 60, 'buffer')]);
  assert.deepEqual(trimmed.map(({ restackStart, duration }) => [restackStart, duration]), [[1285, 35]]);
  const moved = fitTemplateAnchors([block('study', 60, { restackStart: 1300 })], [anchor('shower', 1320, 60, 'routine')]);
  assert.deepEqual(moved.map(({ restackStart }) => restackStart), [1240]);
});
