#!/usr/bin/env bash
# Test gate: backend pytest, frontend vitest + tsc. Run from anywhere; exits non-zero on the first failure.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
(cd "$root/backend" && uv run pytest -q)
(cd "$root/frontend" && npm test --silent && npm run typecheck --silent)
if git -C "$root" diff --quiet -- frontend/public/cases/index.json; then :; else
  echo "WARN: frontend/public/cases/index.json is modified (study entries?) — do not commit it" >&2
fi
echo "check: all green"
