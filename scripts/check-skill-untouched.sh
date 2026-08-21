#!/usr/bin/env bash
# Smoke test: Phase 1 scaffolding must not touch what agents actually install.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

if ! git diff --exit-code --quiet -- skillmama/SKILL.md .claude/skills/skillmama/SKILL.md; then
  echo "FAIL: SKILL.md changed relative to the last commit"
  fail=1
fi

if ! diff -q skillmama/SKILL.md .claude/skills/skillmama/SKILL.md > /dev/null; then
  echo "FAIL: skillmama/SKILL.md and .claude/skills/skillmama/SKILL.md have drifted apart"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "OK: SKILL.md install copies are unchanged and in sync"
fi

exit $fail
