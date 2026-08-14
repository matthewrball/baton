import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';

export function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 });
  return result.status === 0 ? result.stdout.trim() : '';
}

export function isGitWorkTree(cwd) {
  return git(['rev-parse', '--is-inside-work-tree'], cwd) === 'true';
}

export function isBatonTracked(cwd) {
  return Boolean(git(['ls-files', '--', '.baton'], cwd));
}

export function isBatonIgnored(cwd) {
  return git(['check-ignore', '.baton/.baton-ignore-check'], cwd) === '.baton/.baton-ignore-check';
}

export function canLoadBatonState(cwd) {
  return !isGitWorkTree(cwd) || (!isBatonTracked(cwd) && isBatonIgnored(cwd));
}

export function ensureBatonIgnored(cwd) {
  if (!isGitWorkTree(cwd)) return true;
  if (isBatonTracked(cwd)) return false;
  if (isBatonIgnored(cwd)) return true;

  const gitExclude = git(['rev-parse', '--git-path', 'info/exclude'], cwd);
  if (!gitExclude) return false;
  const excludeFile = isAbsolute(gitExclude) ? gitExclude : join(cwd, gitExclude);
  try {
    mkdirSync(dirname(excludeFile), { recursive: true });
    const existing = existsSync(excludeFile) ? readFileSync(excludeFile, 'utf8') : '';
    if (!existing.split(/\r?\n/).includes('.baton/')) {
      appendFileSync(excludeFile, `${existing && !existing.endsWith('\n') ? '\n' : ''}.baton/\n`);
    }
  } catch {
    return false;
  }
  return isBatonIgnored(cwd);
}
