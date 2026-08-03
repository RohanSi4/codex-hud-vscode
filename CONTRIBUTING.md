# Contributing

Issues and focused pull requests are welcome.

## Local development

1. Clone the repository and open it in VS Code.
2. Run `npm run check && npm test`.
3. Press `F5` to launch an Extension Development Host.
4. Start or resume a Codex session and verify both meters in the status bar.

Keep the extension local-first. New features should not upload session data,
credentials, prompts, tool output, or account information.

## Pull requests

- Add tests for parsing or formatting changes.
- Keep the extension dependency-free unless a dependency removes meaningful
  complexity or risk.
- Explain any changes to the local session-data contract.
