'use strict';

const fs = require('fs');
const path = require('path');

const TAIL_BYTES = 1024 * 1024;

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, number));
}

function progressBar(percent, width = 10) {
  const safePercent = clampPercent(percent) ?? 0;
  const safeWidth = Math.max(1, Math.floor(width));
  const filled = Math.round((safePercent / 100) * safeWidth);
  return `${'█'.repeat(filled)}${'░'.repeat(safeWidth - filled)}`;
}

function formatWindow(minutes, secondary = false) {
  const value = Number(minutes);
  if (value === 300) return '5h';
  if (value === 10080) return '7d';
  if (Number.isFinite(value) && value > 0 && value % 1440 === 0) {
    return `${value / 1440}d`;
  }
  if (Number.isFinite(value) && value > 0 && value % 60 === 0) {
    return `${value / 60}h`;
  }
  return secondary ? 'Secondary' : 'Usage';
}

function formatReset(unixSeconds) {
  const millis = Number(unixSeconds) * 1000;
  if (!Number.isFinite(millis) || millis <= 0) return null;
  return new Date(millis).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function extractUsageWindows(rateLimits) {
  if (!rateLimits || typeof rateLimits !== 'object') return [];
  const windows = [];
  for (const [key, secondary] of [['primary', false], ['secondary', true]]) {
    const window = rateLimits[key];
    const percent = clampPercent(window?.used_percent ?? window?.usedPercent);
    if (percent === null) continue;
    const minutes = window?.window_minutes ?? window?.windowDurationMins;
    windows.push({
      label: formatWindow(minutes, secondary),
      percent,
      minutes: Number(minutes) || null,
      resetAt: window?.resets_at ?? window?.resetsAt ?? null,
      resetText: formatReset(window?.resets_at ?? window?.resetsAt),
      secondary,
    });
  }
  return windows;
}

function snapshotFromTokenEvent(record, filePath = null, mtimeMs = null) {
  if (record?.type !== 'event_msg' || record?.payload?.type !== 'token_count') {
    return null;
  }

  const info = record.payload.info || {};
  const last = info.last_token_usage || info.lastTokenUsage || {};
  const contextWindow = Number(info.model_context_window ?? info.modelContextWindow);
  const contextTokens = Number(last.total_tokens ?? last.totalTokens);
  const contextPercent = contextWindow > 0 && Number.isFinite(contextTokens)
    ? clampPercent((contextTokens / contextWindow) * 100)
    : null;
  const usageWindows = extractUsageWindows(
    record.payload.rate_limits ?? record.payload.rateLimits,
  );

  return {
    timestamp: record.timestamp || null,
    filePath,
    mtimeMs,
    contextPercent,
    contextTokens: Number.isFinite(contextTokens) ? contextTokens : null,
    contextWindow: Number.isFinite(contextWindow) ? contextWindow : null,
    usageWindows,
  };
}

function parseLatestTokenEvent(text, filePath = null, mtimeMs = null) {
  const lines = text.split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.includes('"token_count"')) continue;
    try {
      const snapshot = snapshotFromTokenEvent(JSON.parse(line), filePath, mtimeMs);
      if (snapshot) return snapshot;
    } catch {
      // The first line of a tail read can be partial. Keep searching backward.
    }
  }
  return null;
}

function readTail(filePath, maxBytes = TAIL_BYTES) {
  const stat = fs.statSync(filePath);
  const length = Math.min(stat.size, maxBytes);
  const start = Math.max(0, stat.size - length);
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(descriptor, buffer, 0, length, start);
    let text = buffer.toString('utf8');
    if (start > 0) {
      const newline = text.indexOf('\n');
      text = newline >= 0 ? text.slice(newline + 1) : '';
    }
    return { text, mtimeMs: stat.mtimeMs };
  } finally {
    fs.closeSync(descriptor);
  }
}

function readSnapshot(filePath) {
  const { text, mtimeMs } = readTail(filePath);
  return parseLatestTokenEvent(text, filePath, mtimeMs);
}

function listJsonlFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const directory = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(fullPath);
    }
  }
  return files;
}

function newestSessionFile(rootDir) {
  let newest = null;
  for (const filePath of listJsonlFiles(rootDir)) {
    try {
      const mtimeMs = fs.statSync(filePath).mtimeMs;
      if (!newest || mtimeMs > newest.mtimeMs) newest = { filePath, mtimeMs };
    } catch {
      // Session files can move during cleanup. Ignore transient failures.
    }
  }
  return newest?.filePath ?? null;
}

function formatTokens(tokens) {
  const value = Number(tokens);
  if (!Number.isFinite(value)) return 'unknown';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}

module.exports = {
  clampPercent,
  extractUsageWindows,
  formatReset,
  formatTokens,
  formatWindow,
  newestSessionFile,
  parseLatestTokenEvent,
  progressBar,
  readSnapshot,
  snapshotFromTokenEvent,
};
