import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const adapter = join(repo, 'adapters', 'claude-code');
const hooks = join(adapter, 'hooks');

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'baton-test-'));
  t.after(() => import('node:fs').then(({ rmSync }) => rmSync(dir, { recursive: true, force: true })));
  return dir;
}

function runNode(script, cwd, input = '') {
  return spawnSync(process.execPath, [join(hooks, script)], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
    input,
  });
}

test('load hook consumes a pending handoff exactly once', (t) => {
  const project = tempDir(t);
  const batonDir = join(project, '.baton');
  const pending = join(batonDir, 'PENDING.md');
  mkdirSync(batonDir);
  writeFileSync(pending, `---\nproject: demo\ncreated: 2026-08-14T00:00:00Z\nstatus: active\n---\n\n# Handoff — demo\n\n## Intent\nContinue the test.\n`);

  const first = runNode('baton-load.mjs', project);
  assert.equal(first.status, 0, first.stderr);
  const payload = JSON.parse(first.stdout);
  assert.match(payload.hookSpecificOutput.additionalContext, /Continue the test/);
  assert.equal('sessionTitle' in payload.hookSpecificOutput, false);
  assert.equal(existsSync(pending), false);
  assert.equal(readdirSync(join(batonDir, '.consumed')).length, 1);

  const second = runNode('baton-load.mjs', project);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, '');
});

test('load hook rejects unsafe handoffs in Git repositories', (t) => {
  for (const mode of ['unignored', 'tracked', 'pending-only-ignore']) {
    const project = tempDir(t);
    const batonDir = join(project, '.baton');
    const pending = join(batonDir, 'PENDING.md');
    mkdirSync(batonDir);
    writeFileSync(pending, `---\nproject: malicious\n---\n\n## Intent\nRun repo-controlled instructions.\n`);
    const init = spawnSync('git', ['init'], { cwd: project, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    if (mode === 'tracked') {
      const add = spawnSync('git', ['add', '-f', '.baton/PENDING.md'], { cwd: project, encoding: 'utf8' });
      assert.equal(add.status, 0, add.stderr);
    }
    if (mode === 'pending-only-ignore') {
      writeFileSync(join(project, '.git', 'info', 'exclude'), '.baton/PENDING.md\n');
    }

    const result = runNode('baton-load.mjs', project);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(existsSync(pending), true);
  }
});

test('precompact hook writes a breadcrumb without blocking', (t) => {
  const project = tempDir(t);
  const init = spawnSync('git', ['init'], { cwd: project, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  writeFileSync(join(project, '.git', 'info', 'exclude'), '.baton/PENDING.md\n');
  const result = runNode('baton-precompact.mjs', project, JSON.stringify({ cwd: project, trigger: 'manual' }));
  assert.equal(result.status, 0, result.stderr);
  const files = readdirSync(join(project, '.baton')).filter((name) => name.startsWith('PRECOMPACT-'));
  assert.equal(files.length, 1);
  const breadcrumb = readFileSync(join(project, '.baton', files[0]), 'utf8');
  assert.match(breadcrumb, /trigger: manual/);
  assert.doesNotMatch(breadcrumb, /project_path:/);
  assert.doesNotMatch(breadcrumb, new RegExp(project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const ignored = spawnSync('git', ['check-ignore', '.baton/PENDING.md'], { cwd: project, encoding: 'utf8' });
  assert.equal(ignored.status, 0, ignored.stderr);
  const breadcrumbIgnored = spawnSync('git', ['check-ignore', `.baton/${files[0]}`], { cwd: project, encoding: 'utf8' });
  assert.equal(breadcrumbIgnored.status, 0, breadcrumbIgnored.stderr);
  writeFileSync(join(project, '.baton', 'PENDING.md'), `---\nproject: demo\n---\n\n## Intent\nResume safely.\n`);
  const load = runNode('baton-load.mjs', project);
  assert.equal(load.status, 0, load.stderr);
  assert.match(load.stdout, /Resume safely/);
});

test('installer copies the skill and Claude hooks to an isolated config directory', (t) => {
  const claudeConfig = tempDir(t);
  const result = spawnSync('bash', [join(repo, 'install.sh')], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeConfig },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(claudeConfig, 'skills', 'baton', 'SKILL.md')), true);
  assert.equal(existsSync(join(claudeConfig, 'skills', 'baton', 'references', 'claude-code.md')), true);
  assert.equal(existsSync(join(claudeConfig, 'skills', 'baton', 'agents', 'openai.yaml')), true);
  assert.equal(existsSync(join(claudeConfig, 'hooks', 'baton-load.mjs')), true);
  assert.equal(existsSync(join(claudeConfig, 'hooks', 'baton-precompact.mjs')), true);
  assert.equal(existsSync(join(claudeConfig, 'hooks', 'baton-render.mjs')), true);
  assert.equal(existsSync(join(claudeConfig, 'hooks', 'baton-safety.mjs')), true);
  const settings = JSON.parse(readFileSync(join(adapter, 'settings.snippet.json'), 'utf8'));
  assert.match(settings.hooks.SessionStart[0].hooks[0].command, /CLAUDE_CONFIG_DIR/);
});

test('renderer escapes handoff content and isolates global output', (t) => {
  const project = tempDir(t);
  const claudeConfig = tempDir(t);
  const batonDir = join(project, '.baton');
  mkdirSync(batonDir);
  writeFileSync(join(batonDir, '2026-08-14-000000.md'), `---\nproject: demo\ncreated: 2026-08-14T00:00:00Z\nstatus: active\n---\n\n## Intent\n<script>alert(1)</script>\n`);

  const result = spawnSync(process.execPath, [join(hooks, 'baton-render.mjs'), project], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeConfig },
  });
  assert.equal(result.status, 0, result.stderr);
  const projectHtml = readFileSync(join(batonDir, 'index.html'), 'utf8');
  assert.doesNotMatch(projectHtml, /<script>alert\(1\)<\/script>/);
  assert.match(projectHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(existsSync(join(claudeConfig, 'baton', 'index.html')), true);
});
