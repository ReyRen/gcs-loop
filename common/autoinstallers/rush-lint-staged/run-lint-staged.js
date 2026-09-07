/**
 * Cross-platform lint-staged launcher.
 * Windows Node cannot access MSYS path `/bin/bash`; prefer Git Bash when present.
 * Avoid `spawnSync(..., { shell: true })` so paths with spaces (Program Files) stay intact.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const candidates = [
  process.env.LINT_STAGED_SHELL,
  '/bin/bash',
  '/usr/bin/bash',
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
].filter(Boolean);

const shellPath = candidates.find((candidate) => {
  try {
    return fs.existsSync(candidate);
  } catch (_error) {
    return false;
  }
});

if (!shellPath) {
  console.error(
    '[lint-staged] bash not found. Install Git Bash, or set LINT_STAGED_SHELL to a bash executable.',
  );
  process.exit(1);
}

const repoRoot = path.resolve(__dirname, '../../..');
const configPath = path.join(
  repoRoot,
  'common',
  'autoinstallers',
  'rush-lint-staged',
  '.lintstagedrc.js',
);
const lintStagedEntry = path.join(__dirname, 'node_modules', 'lint-staged', 'bin', 'lint-staged.js');

if (!fs.existsSync(lintStagedEntry)) {
  console.error(
    `[lint-staged] missing ${lintStagedEntry}. Run: rush update-autoinstaller --name rush-lint-staged`,
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [
    lintStagedEntry,
    '--config',
    configPath,
    '--shell',
    shellPath,
    '--concurrent',
    '8',
  ],
  {
    stdio: 'inherit',
    shell: false,
    cwd: repoRoot,
    env: process.env,
  },
);

process.exit(result.status ?? 1);
