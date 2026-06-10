#!/usr/bin/env bash
# baton installer — copies the skill + hooks into your Claude Code config dir,
# then prints the settings.json hooks to merge (it never edits settings.json for you,
# so your existing hooks are never clobbered).
set -euo pipefail

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v node >/dev/null 2>&1 || { echo "✗ node is required on PATH (the hooks are Node ESM scripts)."; exit 1; }

echo "Installing baton into $CLAUDE_DIR ..."
mkdir -p "$CLAUDE_DIR/skills/baton" "$CLAUDE_DIR/hooks"
cp "$HERE/skills/baton/SKILL.md" "$CLAUDE_DIR/skills/baton/SKILL.md"
cp "$HERE/hooks/"baton-*.mjs "$CLAUDE_DIR/hooks/"
echo "✓ Copied skill → $CLAUDE_DIR/skills/baton/ and hooks → $CLAUDE_DIR/hooks/"
echo
echo "──────────────────────────────────────────────────────────────────────"
echo "FINAL STEP: merge these hooks into $CLAUDE_DIR/settings.json"
echo "(add alongside any hooks you already have — do not delete existing ones):"
echo "──────────────────────────────────────────────────────────────────────"
cat "$HERE/settings.snippet.json"
echo "──────────────────────────────────────────────────────────────────────"
echo
echo "Optional: enable Linear sync by copying config.example.json → $CLAUDE_DIR/baton/config.json"
echo
echo "Done. In Claude Code:  /baton  to save a handoff, then  /clear  to start fresh — it auto-loads."
