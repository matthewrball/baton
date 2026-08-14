#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$REPO_DIR/adapters/claude-code/install.sh" "$@"
