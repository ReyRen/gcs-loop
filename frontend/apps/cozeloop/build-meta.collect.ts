/**
 * 构建期采集 git / 包版本信息（供 Rsbuild source.define 注入）。
 * 本地开发机构建；git 不可用时回落 unknown，不阻断构建。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function runGit(cwd: string, command: string): string {
  try {
    return execSync(command, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/** 易读本地时间，例如 `2026-11-19 16:21:27 GMT+8` */
export function formatReadableTime(
  input: Date | string | number = new Date(),
): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const pad = (n: number) => String(n).padStart(2, '0');
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const tzHour = Math.floor(abs / 60);
  const tzMin = abs % 60;
  const tz = `GMT${sign}${tzHour}${tzMin ? `:${pad(tzMin)}` : ''}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${tz}`;
}

export type PromptBuildMeta = {
  app: string;
  name: string;
  version: string;
  branch: string;
  commit: string;
  commitShort: string;
  commitAt: string;
  dirty: boolean;
  builtAt: string;
  mode: string;
};

const appDir = path.dirname(fileURLToPath(import.meta.url));

export function collectPromptBuildMeta(options?: {
  cwd?: string;
  mode?: string;
}): PromptBuildMeta {
  const cwd = options?.cwd || appDir;
  let pkg: { name?: string; version?: string } = {};
  try {
    pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'),
    ) as typeof pkg;
  } catch {
    pkg = {};
  }

  const commit = runGit(cwd, 'git rev-parse HEAD') || 'unknown';
  let branch = runGit(cwd, 'git rev-parse --abbrev-ref HEAD') || 'unknown';
  if (branch === 'HEAD') {
    branch = runGit(cwd, 'git name-rev --name-only HEAD') || 'HEAD';
  }
  const dirty = runGit(cwd, 'git status --porcelain') !== '';
  const commitIso = runGit(cwd, 'git log -1 --format=%cI');
  const commitAt = commitIso ? formatReadableTime(commitIso) : 'unknown';

  return {
    app: 'prompt',
    name: pkg.name || '@cozeloop/community-base',
    version: pkg.version || '0.0.0',
    branch,
    commit,
    commitShort: commit === 'unknown' ? 'unknown' : commit.slice(0, 7),
    commitAt,
    dirty,
    builtAt: formatReadableTime(new Date()),
    mode: options?.mode || process.env.NODE_ENV || 'development',
  };
}
