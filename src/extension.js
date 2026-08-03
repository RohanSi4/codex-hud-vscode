'use strict';

const os = require('os');
const path = require('path');
const vscode = require('vscode');
const {
  formatTokens,
  newestSessionFile,
  progressBar,
  readSnapshot,
} = require('./core');

const SESSION_RESCAN_MS = 10_000;

function meterColor(percent) {
  if (percent === null) return new vscode.ThemeColor('disabledForeground');
  if (percent >= 85) return new vscode.ThemeColor('errorForeground');
  if (percent >= 65) return new vscode.ThemeColor('editorWarning.foreground');
  return new vscode.ThemeColor('charts.green');
}

function percentText(percent) {
  return percent === null ? '--' : `${Math.round(percent)}%`;
}

function markdownTooltip(snapshot, kind) {
  const tooltip = new vscode.MarkdownString(undefined, true);
  tooltip.isTrusted = true;
  if (!snapshot) {
    tooltip.appendMarkdown('**Codex HUD**\n\nWaiting for live Codex session data.');
    return tooltip;
  }

  if (kind === 'context') {
    tooltip.appendMarkdown('**Codex context**\n\n');
    tooltip.appendMarkdown(
      `${percentText(snapshot.contextPercent)} used, `
      + `${formatTokens(snapshot.contextTokens)} / ${formatTokens(snapshot.contextWindow)} tokens\n\n`,
    );
    tooltip.appendMarkdown('Updates from Codex\'s native token events.');
    return tooltip;
  }

  tooltip.appendMarkdown('**Codex account usage**\n\n');
  if (snapshot.usageWindows.length === 0) {
    tooltip.appendMarkdown('No account rate-limit window was included in the latest event.');
    return tooltip;
  }
  for (const window of snapshot.usageWindows) {
    const reset = window.resetText ? `, resets ${window.resetText}` : '';
    tooltip.appendMarkdown(`${window.label}: **${Math.round(window.percent)}% used**${reset}\n\n`);
  }
  return tooltip;
}

function activate(context) {
  const contextItem = vscode.window.createStatusBarItem(
    'codexHud.context',
    vscode.StatusBarAlignment.Right,
    101,
  );
  const usageItem = vscode.window.createStatusBarItem(
    'codexHud.usage',
    vscode.StatusBarAlignment.Right,
    100,
  );
  contextItem.name = 'Codex context usage';
  usageItem.name = 'Codex account usage';
  contextItem.command = 'codexHud.showDetails';
  usageItem.command = 'codexHud.showDetails';

  let snapshot = null;
  let sessionFile = null;
  let lastSessionScan = 0;
  let interval = null;

  function render() {
    const configuration = vscode.workspace.getConfiguration('codexHud');
    const width = configuration.get('barWidth', 10);
    const contextPercent = snapshot?.contextPercent ?? null;
    const primaryWindow = snapshot?.usageWindows?.[0] ?? null;
    const usagePercent = primaryWindow?.percent ?? null;
    const usageLabel = primaryWindow?.label || 'Usage';

    contextItem.text = `Ctx ${progressBar(contextPercent, width)} ${percentText(contextPercent)}`;
    usageItem.text = `${usageLabel} ${progressBar(usagePercent, width)} ${percentText(usagePercent)}`;
    contextItem.color = meterColor(contextPercent);
    usageItem.color = meterColor(usagePercent);
    contextItem.tooltip = markdownTooltip(snapshot, 'context');
    usageItem.tooltip = markdownTooltip(snapshot, 'usage');
    contextItem.show();
    usageItem.show();
  }

  function refresh(forceRescan = false) {
    const now = Date.now();
    if (forceRescan || !sessionFile || now - lastSessionScan >= SESSION_RESCAN_MS) {
      sessionFile = newestSessionFile(path.join(os.homedir(), '.codex', 'sessions'));
      lastSessionScan = now;
    }
    if (sessionFile) {
      try {
        snapshot = readSnapshot(sessionFile) || snapshot;
      } catch {
        sessionFile = null;
      }
    }
    render();
  }

  function restartTimer() {
    if (interval) clearInterval(interval);
    const configuration = vscode.workspace.getConfiguration('codexHud');
    interval = setInterval(
      () => refresh(false),
      configuration.get('refreshIntervalMs', 2000),
    );
  }

  context.subscriptions.push(
    contextItem,
    usageItem,
    vscode.commands.registerCommand('codexHud.refresh', () => refresh(true)),
    vscode.commands.registerCommand('codexHud.showDetails', async () => {
      refresh(true);
      if (!snapshot) {
        vscode.window.showInformationMessage('Codex HUD is waiting for session data.');
        return;
      }
      const contextDetail = `Context: ${percentText(snapshot.contextPercent)} used `
        + `(${formatTokens(snapshot.contextTokens)} / ${formatTokens(snapshot.contextWindow)} tokens)`;
      const usageDetails = snapshot.usageWindows.map((window) => {
        const reset = window.resetText ? `, resets ${window.resetText}` : '';
        return `${window.label}: ${Math.round(window.percent)}% used${reset}`;
      });
      await vscode.window.showQuickPick(
        [contextDetail, ...usageDetails],
        { title: 'Codex HUD', placeHolder: 'Live usage from the active Codex session' },
      );
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('codexHud')) {
        restartTimer();
        render();
      }
    }),
    { dispose: () => interval && clearInterval(interval) },
  );

  refresh(true);
  restartTimer();
}

function deactivate() {}

module.exports = { activate, deactivate };
