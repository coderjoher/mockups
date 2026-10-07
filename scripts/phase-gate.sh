#!/usr/bin/env bash
# Phase gate: refuses to pass phase N unless every requirement in phases 0..N
# has at least one test that names it as "[ID]", and all test suites pass.
#
# Usage: scripts/phase-gate.sh <phase-number>
# Override the test command with PHASE_GATE_TEST_CMD="..." if needed.
set -euo pipefail

phase="${1:?usage: scripts/phase-gate.sh <phase-number>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
reqs="$root/docs/phase-requirements.txt"
cd "$root"

# Files that count as tests.
mapfile -t test_files < <(
  find . \( -name node_modules -o -name .git -o -name docs -o -name scripts \) -prune -o \
    -type f \( -name '*.test.*' -o -name '*.spec.*' -o -name 'test_*.py' -o -name '*_test.py' \) -print
)

missing=0
while read -r p id; do
  [[ -z "${p:-}" || "$p" == \#* ]] && continue
  (( p > phase )) && continue
  if (( ${#test_files[@]} == 0 )) || ! grep -qF "[$id]" "${test_files[@]}"; then
    echo "MISSING TEST  phase $p  [$id]"
    missing=$((missing + 1))
  fi
done < "$reqs"

if (( missing > 0 )); then
  echo "Gate $phase FAILED: $missing requirement(s) have no test. Do not start phase $((phase + 1))."
  exit 1
fi
echo "Every requirement in phases 0..$phase has a test."

# Run the suites (current and all earlier phases = whole suite, no regressions).
if [[ -n "${PHASE_GATE_TEST_CMD:-}" ]]; then
  bash -c "$PHASE_GATE_TEST_CMD"
else
  npm run typecheck
  npm test          # Node unit + integration, then Python (pytest)
  npm run test:e2e  # Playwright end-to-end against the full stack
fi

echo "Gate $phase PASSED. Tick the exit criteria in docs/PHASES.md before starting phase $((phase + 1))."
