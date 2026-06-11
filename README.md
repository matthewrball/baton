# 🪃 baton

**Hand off a near-full Claude Code session to a fresh one — with near-zero friction.**

Long sessions fill the context window, and model quality degrades as tokens climb. The fix is to start fresh — but starting fresh normally means losing everything you were doing. `baton` makes the handoff a two-step ritual:

```
/baton      # summarize the session into a handoff, stage it
/clear      # start fresh — the handoff auto-loads into the new session
```

No copy-paste. No "where were we?" The new session wakes up already oriented, then you keep going.

---

## Why

- Context windows are finite and **degrade well before they're full** — long-context retrieval starts slipping around ~128–256k tokens, long before any hard limit.
- The usual workaround — ask the model to summarize, copy it, `/clear`, paste it back — is tedious and easy to skip.
- `baton` automates everything except the one keystroke the model *can't* do for you (`/clear`), turning a chore into muscle memory.

## How it works

```
   ┌─ /baton ──────────────────────────────────────────────┐
   │ summarize session → <project>/.baton/<timestamp>.md    │
   │ arm .baton/PENDING.md · append JOURNAL.md · render HTML │
   └────────────────────────────────────────────────────────┘
                          │
                       /clear           ← the only manual step
                          │
   ┌─ SessionStart(clear) hook ─────────────────────────────┐
   │ baton-load.mjs injects PENDING into the fresh session   │
   │ then consumes it (so an unrelated /clear won't re-fire) │
   └────────────────────────────────────────────────────────┘
                          │
              fresh, low-token session, already oriented
```

**Markdown is the source of truth** (cheap and reliable for the model to ingest). A styled **HTML dashboard** is generated *from* the markdown for human browsing — `/baton view` opens it. So you get a beautiful overview without paying for HTML on the resume path.

## Install

```bash
git clone https://github.com/matthewrball/baton.git
cd baton
./install.sh        # copies the skill + hooks into ~/.claude, prints the settings snippet
```

Then merge the printed `hooks` block into your `~/.claude/settings.json` (it adds `SessionStart(clear)` and `PreCompact` hooks — keep any hooks you already have). Hooks load at session start, so the auto-load is active in your next session.

> Requires [Claude Code](https://claude.com/claude-code) and Node.js on your PATH (the hooks are Node ESM scripts).

## Usage

| Command | What it does |
|---|---|
| `/baton` *(or `/baton save`)* | Summarize the session into a handoff and stage it for `/clear` |
| `/baton resume` | Manually re-orient from the latest handoff (fallback; the hook usually handles this) |
| `/baton view` *(`--global`)* | Open the styled HTML dashboard — this project, or all projects |
| `/baton status` | Show context-token estimate, whether a handoff is armed, and the last save time |

Each handoff is a small markdown file with a fixed schema — Intent · Done · Current State · Next Steps · Key Files · Decisions & Gotchas · Open Questions — so it's greppable, diffable, and trivially appendable.

## Layout

```
<project>/.baton/          # per-project (git-ignored): handoffs, PENDING, JOURNAL, index.html
~/.claude/baton/           # global: registry.json + a cross-project index.html dashboard
~/.claude/skills/baton/    # the skill (the "brain")
~/.claude/hooks/baton-*.mjs # load (auto-inject), render (HTML), precompact (breadcrumb)
```

## Optional: Linear sync

Off by default. To have `/baton` also post the handoff summary as a comment on a Linear issue for work projects, copy `config.example.json` to `~/.claude/baton/config.json` and list the roots:

```json
{ "linearSyncRoots": ["~/Documents/your-work-org"] }
```

When a project lives under one of those roots, `/baton` resolves the ticket (from an arg like `/baton ABC-123`, `.baton/config.json`, or the git branch) and comments the summary on it. Resolution is best-effort and never blocks the file handoff.

## Troubleshooting

**"I ran `/baton`, then `/clear`, and nothing happened."**
Check the session title — if it changed to `⟲ baton: <project>`, the handoff **did** load; the model just didn't speak first. The injected framing instructs it to open with a 3-bullet orientation, but if your session is silent anyway, the context is still there: type anything ("where were we?") and it will answer fully oriented, or run `/baton resume`. Root cause: after `/clear`, the model's first turn is the `/clear` command record itself, which carries a "do not respond" caveat that can suppress the greeting on some Claude Code versions.

**The handoff loaded into the wrong project / didn't load at all.**
The hook looks for `<cwd>/.baton/PENDING.md` in the directory Claude Code was launched from. Run `/baton status` to see whether a handoff is armed; an already-consumed handoff lives in `.baton/.consumed/` and can be re-armed by copying it back to `.baton/PENDING.md`.

## Design notes

- **`/clear` is yours.** The model cannot wipe its own context — that single keystroke is the only manual step in the loop.
- **Exactly-once injection.** Consuming the staged handoff is an atomic rename, so concurrent sessions (e.g. tmux lanes) never double-inject.
- **No truncation.** The load hook writes its payload synchronously — `process.stdout.write` + `process.exit` truncates at the ~64KB pipe buffer, which would silently cut off a large handoff.
- **Hooks never block.** A SessionStart/PreCompact hook that throws would disrupt your session, so the hooks fail silent and exit 0.

## License

[MIT](LICENSE) © 2026 Matthew Ball
