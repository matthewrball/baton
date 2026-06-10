---
name: baton
description: Hand off a near-full session to a fresh one with near-zero friction. Run `/baton` (or "baton", "handoff this session", "save context before clear", "pass the baton") to summarize the current session into a markdown handoff that auto-loads after /clear. Verbs: save (default), resume, view, status. Use when the context gauge is red (~400k+ tokens) and you want to /clear and continue where you left off.
---

# baton — session handoff

Operationalizes the handoff cycle from `~/.claude/commands/session-lifecycle.md` (Farewell → Log → Compact → Re-orient → Load the log). It turns the manual "summarize → copy → /clear → paste" ritual into **two steps: `/baton` → `/clear`.**

**How the loop works (so you understand what you're automating):**
1. `/baton` writes a markdown handoff to `<project>/.baton/`, arms `.baton/PENDING.md`, updates the journal + HTML dashboards, and (for configured Linear-sync roots) comments it on Linear.
2. You run `/clear`.
3. The `SessionStart(clear)` hook `~/.claude/hooks/baton-load.mjs` auto-injects the handoff into the new session and consumes it (no paste, no typing).

Markdown is the source of truth (cheap + reliable for the AI to ingest). HTML is a generated **view** for human browsing only — never hand-author HTML; the render script owns it.

---

## Verbs

`/baton [save|resume|view|status] [TICKET]` — `save` is the default when no verb is given. If the first argument is **not** one of the recognized verbs, treat it as `TICKET` (so `/baton ONR-123` ≡ `/baton save ONR-123`).

### `save` (default) — create the handoff

Do these in order:

1. **Resolve identity.**
   - `PROJECT_DIR` = current working directory.
   - `NAME` = its basename. `SID` = a short disambiguator (e.g. last 4 of the session id, or `HHMMSS`).
   - `TS` = current local time `YYYY-MM-DD-HHMMSS` (seconds included — two saves in the same minute must not collide). `CREATED` = full ISO-8601 with timezone offset.
   - `TOKENS` = best estimate of current context tokens (read it off the statusline gauge if visible), else `unknown`.

2. **Summarize the session** into the schema below. Be a ruthless editor:
   - **Target ≈ 1500–2000 tokens of content; hard ceiling ≈ 2500 (including frontmatter).** The whole point is to *reset* token usage — a bloated handoff defeats it.
   - Capture intent and forward state, not a transcript. Favor "what's true now + what's next" over "what we discussed."
   - **NEVER include secrets, API keys, tokens, passwords, or `.env` contents.** Reference them by name only (e.g. "rotate the world-readable `.env.local` secret"), never the value.
   - `Intent` should capture the *through-line* — why this work exists — so a reader (or future-you) grasps the session's purpose even cold.

3. **Write the handoff** to `PROJECT_DIR/.baton/<TS>-<SID>.md` (create `.baton/` if needed):

   ```
   ---
   project: <NAME>
   project_path: <PROJECT_DIR>
   session_id: <SID>
   created: <CREATED>
   context_tokens_at_save: <TOKENS>
   linear_issue: <TICKET or none>
   status: active
   ---
   # Handoff — <NAME>

   ## Intent
   <the through-line goal — why this work exists>

   ## Done
   - <accomplishments this session>

   ## Current State
   - branch: <git branch or n/a>
   - tests: <pass/fail + command, or n/a>
   - running: <dev servers / background procs, or none>
   - env: <anything non-standard the next session must know>

   ## Next Steps
   1. <ordered, actionable>

   ## Key Files
   - <path:line — what it is / why it matters>

   ## Decisions & Gotchas
   - <decisions made + rationale; traps to avoid>

   ## Open Questions
   - <unresolved items, or "none">
   ```

4. **Arm auto-load:** copy that file to `PROJECT_DIR/.baton/PENDING.md` (verbatim). The load hook consumes PENDING exactly once after the next `/clear`.

5. **Append the journal:** add one line to `PROJECT_DIR/.baton/JOURNAL.md` (create with an `# <NAME> — baton journal` header if missing):
   `- <CREATED> · <one-line intent> · → <one-line next step>`

6. **Render the views:** run `node ~/.claude/hooks/baton-render.mjs "<PROJECT_DIR>"` (updates the per-project HTML, the global registry, and `~/.claude/baton/index.html`).

7. **Gitignore:** if `PROJECT_DIR` is a git repo (`git -C "<PROJECT_DIR>" rev-parse --is-inside-work-tree` prints `true`), ensure `.baton/` is in its `.gitignore` (append if absent). If the command fails, git isn't installed, or it's not a repo, skip silently. (Note: handoffs are plaintext working context — no secrets, per step 2 — so an un-ignored `.baton/` in a non-git dir is not catastrophic, but add it to `.gitignore` first thing if you ever `git init` there.)

8. **Linear sync — only if** `PROJECT_DIR` is inside one of the configured `linearSyncRoots`. Read these from `~/.claude/baton/config.json` (shape: `{ "linearSyncRoots": ["~/Documents/foo"] }`). Expand `~`, lowercase both sides, and use a **boundary-safe match** (the path equals a root OR starts with that root **+ `/`** — avoids false positives like `foo-archive`). If the config is missing or `linearSyncRoots` is empty, **skip Linear entirely (file-only)** — this is the default for a fresh install. Otherwise do nothing Linear-related.
   - Resolve the ticket in order: (a) `TICKET` arg; (b) `.baton/config.json` `linearIssue`; (c) infer from git branch (e.g. `onr-123-foo` → `ONR-123`).
   - If resolved: post the handoff summary as a **comment** on that issue via the Linear MCP (`mcp__claude_ai_Linear__save_comment` or `create_comment`), and write `linear_issue:` into the handoff frontmatter. Linear sync here is **best-effort** (model-driven), not guaranteed.
   - If **unresolved** after (a)–(c): do **not** block the save. Write the handoff with `linear_issue: none`, tell the user plainly *"no Linear issue resolved — handoff saved to file only; pass one with `/baton ONR-123` to sync,"* and continue. Only ask interactively for a ticket if the user is clearly present and waiting.
   - **Failure isolation:** if Linear errors (auth/network), the file handoff still stands — warn and continue. Never lose the handoff over a Linear hiccup.

9. **Tell the user:** confirm the path, then: *"Saved. Run `/clear` — your handoff will auto-load into the fresh session."*

### `resume` — manual re-orient (fallback)

The hook handles resume automatically after `/clear`. Use this only if the hook didn't fire or you're mid-session: read the newest `PROJECT_DIR/.baton/*.md` (prefer `PENDING.md` if present) and give the 3-bullet orientation (intent / where we left off / immediate next step).

### `view` — open the dashboard

Run `node ~/.claude/hooks/baton-render.mjs "<PROJECT_DIR>"`, then open the HTML:
- default: `open "<PROJECT_DIR>/.baton/index.html"` (this project's history)
- `--global`: `open ~/.claude/baton/index.html` (all projects)

### `status` — quick check

Report: estimated current context tokens (from the gauge if visible), whether `.baton/PENDING.md` is armed, and the timestamp of the most recent handoff.

---

## Notes & edge cases

- **The one manual step.** Claude cannot wipe its own context — `/clear` is yours to type. Everything else is automated.
- **Multiple lanes / concurrent sessions** in one project share `.baton/`. Timestamped history files never collide; `PENDING.md` is last-save-wins. If you run parallel lanes, save from the lane you want to resume *last* before clearing.
- **Don't clobber the HUD.** This skill never touches `statusLine` or `~/.claude/.omc/hud-config.json`.
- **PreCompact breadcrumbs** (`PRECOMPACT-*.md`) are mechanical insurance written by `baton-precompact.mjs`, not curated handoffs; the render script ignores them.
