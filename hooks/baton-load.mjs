#!/usr/bin/env node
// baton-load.mjs — SessionStart(clear) hook.
// After /clear, if a baton handoff was staged (.baton/PENDING.md), inject it into the
// fresh session's context, then CONSUME it so an unrelated later /clear won't re-inject.
// Only an explicit `/baton save` re-arms it.
//
// Design notes:
//  - Output is written with fs.writeSync(1, ...) (SYNCHRONOUS). process.stdout.write()
//    followed by process.exit() truncates at the ~64KB pipe buffer — verified — which
//    would silently cut off a large handoff. writeSync guarantees the full payload lands.
//  - Consume is an ATOMIC CLAIM: we read the content, then rename PENDING -> .consumed/.
//    Whichever concurrent lane wins the rename emits the context; losers get ENOENT and
//    stay silent. This gives exactly-once injection across parallel tmux lanes.
//  - Must NEVER throw / block session start — always exits 0.

import { readFileSync, existsSync, mkdirSync, renameSync, writeSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

try {
  let cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
  if (raw) {
    try {
      const data = JSON.parse(raw);
      if (data && typeof data.cwd === 'string' && data.cwd) cwd = data.cwd;
    } catch { /* malformed stdin: fall back to cwd */ }
  }
  if (!isAbsolute(cwd)) cwd = process.cwd();

  const batonDir = join(cwd, '.baton');
  const pending = join(batonDir, 'PENDING.md');

  // Nothing staged → behave like a normal /clear: emit no output, exit 0.
  if (!existsSync(pending)) process.exit(0);

  let content = '';
  try { content = readFileSync(pending, 'utf8'); } catch { process.exit(0); }
  if (!content.trim()) process.exit(0);

  // Atomic claim: rename is the lock. If another lane already consumed it, this throws → exit silently.
  const consumedDir = join(batonDir, '.consumed');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const claimed = join(consumedDir, `consumed-${stamp}.md`);
  try {
    mkdirSync(consumedDir, { recursive: true });
    renameSync(pending, claimed);
  } catch {
    process.exit(0); // lost the race or PENDING vanished — let the winning lane handle it
  }

  // Belt-and-suspenders: a pathological handoff would defeat the token-reset goal. Note it.
  const sizeNote = content.length > 40000
    ? '⚠️ This handoff is unusually large (' + Math.round(content.length / 1000) + 'KB) — it may eat into the token budget you just reset. Consider a tighter `/baton` next time.\n\n'
    : '';

  const framing =
    '📋 **Resuming from a `/baton` handoff.** The previous session staged the state below ' +
    'before context was cleared. Treat it as ground truth for where things stand.\n\n' +
    sizeNote + '---\n\n';

  const orient =
    'I just cleared context to start fresh. Using the baton handoff above, give me a brief ' +
    'orientation in 3 bullets — (1) the intent/goal, (2) where the last session left off, ' +
    '(3) the single most immediate next step — then wait for my direction before doing anything.';

  const json = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: framing + content,
      initialUserMessage: orient
    }
  });

  writeSync(1, json); // synchronous: full payload flushes before exit
} catch { /* never block session start */ }

process.exit(0);
