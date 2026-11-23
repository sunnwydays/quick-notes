import assert from 'node:assert/strict';
import test from 'node:test';
import { applyOverrun, applyWake, dayLoad, editDayWithPin, insertPopup, layoutDay, restackBeforeScreensOff, suggestGhosts, toggleBlockPin } from '../plan-engine.js';

const block = (id, size, fields = {}) => ({ id, size, tier: 'medium', ...fields });
const times = ({ blocks }) => blocks.map(({ id, start, until }) => [id, start, until]);

test('starts at wake with the template offset, omits shelf items and includes tails and gaps', () => {
  const day = {
    wake: '07:30', startOffset: 5,
    blocks: [block('shelf', 30, { shelf: true }), block('one', 30), block('two', 90, { tail: 30 }), block('three', 45)],
  };
  const before = structuredClone(day);
  assert.deepEqual(times(layoutDay(day)), [['one', 455, 485], ['two', 495, 615], ['three', 630, 675]]);
  assert.deepEqual(day, before);
});

test('keeps fixed anchors, even if their reservation comes later in the stack', () => {
  const day = { blocks: [block('work', 45), block('meal', 30, { pinned: '07:30', tier: 'fixed' }), block('next', 30)] };
  assert.deepEqual(times(layoutDay(day)), [['meal', 450, 480], ['work', 490, 535], ['next', 545, 575]]);
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
  const updated = editDayWithPin(day, [task, review, pinned], pinned);
  const layout = layoutDay(updated);
  assert.deepEqual(times(layout), times(layoutDay(day)));
  assert.deepEqual(layout.blocks.map((item) => item.pinned ?? null), [null, null, '22:00']);
  assert.deepEqual(layout.bumped, []);
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
  assert.deepEqual(times(layoutDay(rescheduled)), [['early', 420, 475], ['middle', 485, 515], ['late', 525, 555]]);
});

test('uses the set size for a break even when exercise has a tail', () => {
  const day = { blocks: [block('cardio', 60, { tail: 30 }), block('then', 30)] };
  assert.deepEqual(times(layoutDay(day)), [['cardio', 420, 510], ['then', 520, 550]]);
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

test('load excludes fixed time, exercise tails, and mandatory gaps', () => {
  const day = { wake: '19:00' };
  const blocks = [
    { ...block('work', 45), start: 1140, until: 1185 },
    { ...block('meal', 30, { tier: 'fixed' }), start: 1195, until: 1225 },
    { ...block('cardio', 30, { kind: 'exercise', tail: 30 }), start: 1235, until: 1295 },
  ];
  assert.deepEqual(dayLoad(day, blocks), { usable: 60, placed: 45, ratio: .75 });
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
    '2026-11-24': { template: 'Exam / interview', wake: '21:10', blocks: [] },
  };
  const tray = [
    block('study', 45, { text: 'Study new material' }),
    block('prep', 30, { text: 'Exam prep', deadline: '2026-11-24T09:00' }),
    block('almost', 30, { text: 'Finish it', kind: 'almost' }),
  ];
  assert.deepEqual(suggestGhosts(days, tray).map(({ key, block }) => [key, block.id, block.start]), [
    ['2026-11-23', 'prep', 930], ['2026-11-23', 'almost', 1045],
  ]);
  assert.deepEqual(suggestGhosts({ '2026-11-24': days['2026-11-24'] }, [block('load', 30, { text: 'Read' })]), []);
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
