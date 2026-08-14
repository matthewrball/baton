#!/usr/bin/env node
// baton-precompact.mjs — PreCompact hook (matchers: manual, auto).
// Writes a MECHANICAL breadcrumb before compaction as insurance against lost state.
// This is NOT a curated handoff (a hook has no model) — run `/baton` for that.
// Never throws / blocks; always exits 0.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { execSync } from 'node:child_process';
import { ensureBatonIgnored, isGitWorkTree } from './baton-safety.mjs';

const sh = (cmd, cwd) => {
  try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 }).trim(); }
  catch { return ''; }
};

try {
  let cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let trigger = 'unknown';
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  if (raw) {
    try {
      const d = JSON.parse(raw);
      if (d && typeof d.cwd === 'string' && d.cwd) cwd = d.cwd;
      if (d && d.trigger) trigger = String(d.trigger);
    } catch { /* ignore */ }
  }

  const isGit = isGitWorkTree(cwd);
  if (!ensureBatonIgnored(cwd)) process.exit(0);

  const batonDir = join(cwd, '.baton');
  mkdirSync(batonDir, { recursive: true });

  const branch = isGit ? sh('git rev-parse --abbrev-ref HEAD', cwd) : '';
  const status = isGit ? sh('git status --short', cwd).split('\n').slice(0, 30).join('\n') : '';
  const recent = sh("find . -type f -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/.baton/*' -mtime -1 2>/dev/null | head -20", cwd);

  const now = new Date().toISOString();
  const stamp = now.replace(/[:.]/g, '-');
  const md = `---
type: precompact-breadcrumb
trigger: ${trigger}
created: ${now}
project: ${JSON.stringify(basename(cwd))}
---
# Precompact breadcrumb (${trigger})

> Mechanical snapshot written automatically before compaction. NOT a curated handoff — run \`/baton\` for a real one.

## Git
- branch: ${branch || '(not a git repo)'}

### git status --short
\`\`\`
${status || '(clean or n/a)'}
\`\`\`

## Recently modified (last 24h)
\`\`\`
${recent || '(none)'}
\`\`\`
`;
  writeFileSync(join(batonDir, `PRECOMPACT-${stamp}.md`), md);
} catch { /* never block compaction */ }

process.exit(0);
