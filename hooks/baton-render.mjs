#!/usr/bin/env node
// baton-render.mjs — generate the human-facing HTML views from the markdown source of truth.
//   - per-project:  <projectDir>/.baton/index.html
//   - global:       ~/.claude/baton/index.html  (+ registry.json)
// Markdown is the source of truth; this script never mutates the .md handoffs.
// Usage: node baton-render.mjs [projectDir]   (defaults to $CLAUDE_PROJECT_DIR or cwd)

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const GLOBAL_DIR = join(homedir(), '.claude', 'baton');
const REGISTRY = join(GLOBAL_DIR, 'registry.json');

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Percent-encode each path segment so file:// links survive spaces, #, ?, % etc.
const fileUrl = (absPath) => 'file://' + absPath.split('/').map(encodeURIComponent).join('/');

const inline = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/`([^`]+)`/g, '<code>$1</code>');

function parseFrontmatter(text) {
  text = text.replace(/\r\n/g, '\n'); // tolerate CRLF
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {};
  let body = text;
  if (m) {
    body = m[2];
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return { meta, body };
}

function sections(body) {
  const map = {};
  let cur = '_pre';
  map[cur] = [];
  for (const line of body.split('\n')) {
    const h = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (h) { cur = h[1]; map[cur] = []; }
    else map[cur].push(line);
  }
  for (const k of Object.keys(map)) map[k] = map[k].join('\n').trim();
  return map;
}

function renderBody(body) {
  const lines = body.split('\n');
  let html = '', inUl = false, inOl = false;
  const closeLists = () => { if (inUl) { html += '</ul>'; inUl = false; } if (inOl) { html += '</ol>'; inOl = false; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { closeLists(); continue; }
    let m;
    if ((m = line.match(/^#{1,3}\s+(.*)$/))) { closeLists(); html += `<h3 class="sec">${inline(m[1])}</h3>`; }
    else if ((m = line.match(/^[-*]\s+(.*)$/))) { if (!inUl) { closeLists(); html += '<ul>'; inUl = true; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\d+\.\s+(.*)$/))) { if (!inOl) { closeLists(); html += '<ol>'; inOl = true; } html += `<li>${inline(m[1])}</li>`; }
    else { closeLists(); html += `<p>${inline(line)}</p>`; }
  }
  closeLists();
  return html;
}

function loadHandoffs(batonDir) {
  if (!existsSync(batonDir)) return [];
  const skip = new Set(['PENDING.md', 'JOURNAL.md']);
  const items = [];
  for (const f of readdirSync(batonDir)) {
    if (!f.endsWith('.md') || skip.has(f) || f.startsWith('PRECOMPACT-')) continue;
    try {
      const { meta, body } = parseFrontmatter(readFileSync(join(batonDir, f), 'utf8'));
      items.push({ file: f, meta, body });
    } catch { /* skip unreadable */ }
  }
  items.sort((a, b) => {
    const c = (b.meta.created || b.file).localeCompare(a.meta.created || a.file);
    return c !== 0 ? c : (b.file || '').localeCompare(a.file || ''); // stable tie-break
  });
  return items;
}

const CSS = `
:root{--bg:#0d1117;--card:#161b22;--line:#30363d;--fg:#e6edf3;--dim:#8b949e;--accent:#f7931a;--accent2:#58a6ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:32px}
.wrap{max-width:920px;margin:0 auto}
h1{font-size:24px;margin:0 0 4px;letter-spacing:-.01em}
.muted{color:var(--dim);font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 24px;margin:18px 0}
.card.latest{border-color:var(--accent);box-shadow:0 0 0 1px rgba(247,147,26,.25)}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 14px}
.chip{font:12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dim);background:#0d111733;border:1px solid var(--line);border-radius:999px;padding:5px 10px}
.chip.tag{color:var(--accent)}
.chip.ok{color:#3fb950}
h3.sec{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--accent2);margin:18px 0 6px;border-bottom:1px solid var(--line);padding-bottom:4px}
ul,ol{margin:6px 0;padding-left:22px}
li{margin:3px 0}
p{margin:6px 0}
code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:#0d1117;border:1px solid var(--line);border-radius:5px;padding:1px 5px}
a{color:var(--accent2);text-decoration:none}a:hover{text-decoration:underline}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.tbl{width:100%;border-collapse:collapse;margin-top:14px}
.tbl td{border-top:1px solid var(--line);padding:12px 10px;vertical-align:top}
.tbl tr:hover td{background:#1b212a}
.intent{color:var(--dim);font-size:13.5px}
.foot{margin-top:28px;color:var(--dim);font-size:12px;text-align:center}
`;

const page = (title, inner) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<title>${esc(title)}</title><style>${CSS}</style></head>` +
  `<body><div class="wrap">${inner}<div class="foot">baton — markdown is the source of truth; this view is generated.</div></div></body></html>`;

function chips(meta, file) {
  const out = [];
  if (meta.created) out.push(`<span class="chip">${esc(meta.created)}</span>`);
  if (meta.status) out.push(`<span class="chip ${meta.status === 'done' ? 'ok' : ''}">${esc(meta.status)}</span>`);
  if (meta.linear_issue && meta.linear_issue !== 'none') out.push(`<span class="chip tag">${esc(meta.linear_issue)}</span>`);
  if (meta.context_tokens_at_save && meta.context_tokens_at_save !== 'unknown') out.push(`<span class="chip">${esc(meta.context_tokens_at_save)} tok</span>`);
  out.push(`<span class="chip">${esc(file)}</span>`);
  return `<div class="meta">${out.join('')}</div>`;
}

function projectPage(name, dir, items) {
  if (!items.length) {
    return page(`baton — ${name}`,
      `<h1>${esc(name)}</h1><div class="muted">${esc(dir)}</div>` +
      `<div class="card"><p class="intent">No handoffs yet. Run <code>/baton</code> to create one.</p></div>`);
  }
  const cards = items.map((it, i) =>
    `<div class="card${i === 0 ? ' latest' : ''}">` +
    `<div class="row"><strong>${i === 0 ? 'Latest handoff' : 'Handoff'}</strong>` +
    `<span class="muted">${esc(it.meta.session_id || '')}</span></div>` +
    chips(it.meta, it.file) + renderBody(it.body) + `</div>`).join('');
  return page(`baton — ${name}`,
    `<h1>${esc(name)}</h1><div class="muted">${esc(dir)} · ${items.length} handoff(s) · ` +
    `<a href="${fileUrl(join(homedir(), '.claude', 'baton', 'index.html'))}">all projects →</a></div>${cards}`);
}

function globalPage(registry) {
  const rows = Object.entries(registry)
    .sort((a, b) => String(b[1].updated || '').localeCompare(String(a[1].updated || '')))
    .map(([path, r]) => {
      const link = fileUrl(join(path, '.baton', 'index.html'));
      const ticket = r.ticket ? `<span class="chip tag">${esc(r.ticket)}</span>` : '';
      return `<tr><td><a href="${link}"><strong>${esc(r.name || basename(path))}</strong></a>` +
        `<div class="muted">${esc(path)}</div></td>` +
        `<td class="intent">${esc(r.intent || '')}</td>` +
        `<td><div class="meta" style="margin:0">${ticket}` +
        `<span class="chip ${r.status === 'done' ? 'ok' : ''}">${esc(r.status || 'active')}</span>` +
        `<span class="chip">${esc(r.count || 1)}×</span></div>` +
        `<div class="muted">${esc(r.updated || '')}</div></td></tr>`;
    }).join('');
  const inner = `<h1>baton — all projects</h1><div class="muted">cross-project handoff dashboard</div>` +
    (rows ? `<table class="tbl">${rows}</table>` : `<div class="card"><p class="intent">No projects registered yet.</p></div>`);
  return page('baton — all projects', inner);
}

// ---- main ----
const projectDir = process.argv[2] || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const batonDir = join(projectDir, '.baton');
const name = basename(projectDir);
const items = loadHandoffs(batonDir);

mkdirSync(batonDir, { recursive: true });
writeFileSync(join(batonDir, 'index.html'), projectPage(name, projectDir, items));

// Global views are best-effort: a failure here must not break the per-project render above.
try {
  mkdirSync(GLOBAL_DIR, { recursive: true });
  let registry = {};
  if (existsSync(REGISTRY)) {
    try {
      registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
    } catch {
      // Don't silently wipe every other project's entry on a corrupt file — back it up first.
      try { renameSync(REGISTRY, REGISTRY + '.corrupt'); } catch { /* ignore */ }
      console.warn('baton: registry.json was corrupt — backed up to registry.json.corrupt, starting fresh');
    }
  }
  if (items.length) {
    const latest = items[0];
    const secs = sections(latest.body);
    registry[projectDir] = {
      name,
      latest_file: latest.file,
      intent: (secs['Intent'] || '').replace(/\s+/g, ' ').slice(0, 200),
      ticket: latest.meta.linear_issue && latest.meta.linear_issue !== 'none' ? latest.meta.linear_issue : '',
      status: latest.meta.status || 'active',
      count: items.length,
      updated: latest.meta.created || latest.file
    };
  }
  // Prune entries whose project dir no longer exists (moved/deleted projects).
  for (const k of Object.keys(registry)) {
    if (k !== projectDir && !existsSync(k)) delete registry[k];
  }
  writeFileSync(REGISTRY, JSON.stringify(registry, null, 2));
  writeFileSync(join(GLOBAL_DIR, 'index.html'), globalPage(registry));
} catch (e) {
  console.warn('baton: could not update global views (per-project render still succeeded):', e.message);
}
console.log(`baton: rendered ${items.length} handoff(s) for "${name}" → ${join(batonDir, 'index.html')}`);
