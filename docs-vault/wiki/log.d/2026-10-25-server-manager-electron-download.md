- 2026-10-25 — Server manager runbook: Electron 45 has no install script and downloads its binary on the first start
  through Node, so a shortcut or login item that calls `electron.exe` directly fails after a fresh `npm ci` (it exits
  with "Invalid file descriptor to ICU data"). Run `npm start -w server-manager` once after every `npm ci`.
