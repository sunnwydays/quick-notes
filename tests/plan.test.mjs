import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutDay } from '../plan.js';

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

test('allows contiguous fixed anchors and checks the end, not the trailing gap, against 22:00', () => {
  const day = {
    wake: '21:00',
    blocks: [
      block('work', 60), block('wind-down', 60, { pinned: '22:00', tier: 'fixed' }),
      block('sleep', 60, { pinned: '23:00', tier: 'fixed' }),
    ],
  };
  assert.deepEqual(times(layoutDay(day)), [['wind-down', 1320, 1380], ['sleep', 1380, 1440]]);
  assert.deepEqual(layoutDay({ ...day, blocks: [day.blocks[0]] }).bumped, []);
});

test('bumps lower priority work first and only fixed pins survive a later wake unchanged', () => {
  const day = {
    wake: '20:20',
    blocks: [
      block('old-pin', 30, { pinned: '19:00', tier: 'must' }),
      block('meal', 30, { pinned: '19:00', tier: 'fixed' }),
      block('low', 45, { tier: 'low' }), block('must', 60, { tier: 'must' }),
    ],
  };
  const result = layoutDay(day);
  assert.deepEqual(result.bumped.map((b) => b.id), ['old-pin', 'low']);
  assert.deepEqual(times(result), [['meal', 1140, 1170], ['must', 1220, 1280]]);
});

test('preserves an imported Schedule until the planner changes the day', () => {
  const day = { imported: true, blocks: [block('early', 45, { importedStart: 360, duration: 25 })] };
  assert.deepEqual(times(layoutDay(day)), [['early', 360, 385]]);
});
