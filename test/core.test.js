'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractUsageWindows,
  parseLatestTokenEvent,
  progressBar,
} = require('../src/core');

test('progress bar fills to the nearest segment', () => {
  assert.equal(progressBar(0, 10), '░░░░░░░░░░');
  assert.equal(progressBar(38, 10), '████░░░░░░');
  assert.equal(progressBar(100, 10), '██████████');
});

test('parses the newest valid token event from a JSONL tail', () => {
  const first = JSON.stringify({
    timestamp: '2026-08-03T20:00:00Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: { total_tokens: 25_000 },
        model_context_window: 100_000,
      },
      rate_limits: {
        primary: { used_percent: 10, window_minutes: 300 },
      },
    },
  });
  const second = JSON.stringify({
    timestamp: '2026-08-03T20:01:00Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: { total_tokens: 38_000 },
        model_context_window: 100_000,
      },
      rate_limits: {
        primary: { used_percent: 30, window_minutes: 10080 },
      },
    },
  });

  const snapshot = parseLatestTokenEvent(`${first}\nnot json\n${second}\n`);
  assert.equal(snapshot.contextPercent, 38);
  assert.equal(snapshot.usageWindows[0].label, '7d');
  assert.equal(snapshot.usageWindows[0].percent, 30);
});

test('supports primary and secondary usage windows', () => {
  const windows = extractUsageWindows({
    primary: { used_percent: 42, window_minutes: 300, resets_at: 1785792000 },
    secondary: { used_percent: 67, window_minutes: 10080, resets_at: 1786396800 },
  });
  assert.deepEqual(windows.map(({ label, percent }) => ({ label, percent })), [
    { label: '5h', percent: 42 },
    { label: '7d', percent: 67 },
  ]);
});
