'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, wordDiff } = require('../src/diff.js');

const slice = (text, ranges) => ranges.map(([s, e]) => text.slice(s, e));

test('tokenize round-trips the input', () => {
  const s = '  "content": "You are a précis — modifier!\\n\\nRule 7: x_y=1;"\t';
  assert.equal(tokenize(s).join(''), s);
});

test('identical lines have no ranges', () => {
  assert.deepEqual(wordDiff('abc def', 'abc def'), { del: [], add: [] });
});

test('single changed word', () => {
  const a = 'const value = computeTotal(items, tax);';
  const b = 'const value = computeTotal(items, discount);';
  const r = wordDiff(a, b);
  assert.deepEqual(slice(a, r.del), ['tax']);
  assert.deepEqual(slice(b, r.add), ['discount']);
});

test('pure insertion in a long line', () => {
  const head = 'You are a precise CSS style modifier. '.repeat(200);
  const tail = ' Rule 6: keep selectors stable.'.repeat(50);
  const a = head + tail;
  const b = head + ' Rule 7: set text and background together.' + tail;
  const r = wordDiff(a, b);
  assert.deepEqual(r.del, []);
  assert.deepEqual(slice(b, r.add), ['Rule 7: set text and background together.']);
});

test('changed runs separated by whitespace merge into one range', () => {
  const a = 'the quick brown fox jumps';
  const b = 'the slow red fox jumps';
  const r = wordDiff(a, b);
  assert.deepEqual(slice(a, r.del), ['quick brown']);
  assert.deepEqual(slice(b, r.add), ['slow red']);
});

test('separate edits stay separate', () => {
  const a = 'alpha beta gamma delta epsilon zeta eta';
  const b = 'alpha BETA gamma delta epsilon ZETA eta';
  const r = wordDiff(a, b);
  assert.deepEqual(slice(a, r.del), ['beta', 'zeta']);
  assert.deepEqual(slice(b, r.add), ['BETA', 'ZETA']);
});

test('completely different lines return null', () => {
  assert.equal(wordDiff('foo bar baz', 'one two three'), null);
});

test('edit limit returns null instead of hanging', () => {
  const a = Array.from({ length: 3000 }, (_, i) => 'a' + i).join(' ');
  const b = Array.from({ length: 3000 }, (_, i) => 'b' + i).join(' ');
  assert.equal(wordDiff(a, b, { maxEdits: 50, minSimilarity: 0 }), null);
});

test('JSON-escaped newline is a preferred highlight edge', () => {
  const a = '"content": "6. Keep selectors stable.\\n\\nOutput JSON only."';
  const b = '"content": "6. Keep selectors stable.\\n7. Text must read on its background.\\n\\nOutput JSON only."';
  const r = wordDiff(a, b);
  assert.deepEqual(r.del, []);
  assert.deepEqual(slice(b, r.add), ['\\n7. Text must read on its background.']);
});

test('ranges index UTF-16 code units (emoji safe)', () => {
  const a = 'ship it 🚀 now';
  const b = 'ship it 🚀 later';
  const r = wordDiff(a, b);
  assert.deepEqual(slice(a, r.del), ['now']);
  assert.deepEqual(slice(b, r.add), ['later']);
});
