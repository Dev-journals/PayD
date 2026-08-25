#!/usr/bin/env bash
#
# check-k8s-secrets.sh — verify that k8s/base/backend-secret.yaml contains
# only the expected CHANGE_ME placeholders and no real secret values.
#
# Exit codes:
#   0 — file is clean (only placeholders)
#   1 — file contains values that are NOT known placeholders (possible leak)
#   2 — file not found or parse error
#
# Usage:
#   ./scripts/check-k8s-secrets.sh          # standalone
#   # Also wired into .husky/pre-commit and .github/workflows/secrets-check.yml

set -euo pipefail

SECRET_FILE="k8s/base/backend-secret.yaml"

if [[ ! -f "$SECRET_FILE" ]]; then
  echo "ERROR: $SECRET_FILE not found."
  exit 2
fi

# Allowed placeholder values. Any stringData value not in this set is flagged.
ALLOWED_VALUES=(
  "CHANGE_ME"
  "CHANGE_ME_TO_A_SECURE_RANDOM_STRING"
  "postgresql://payd_user:CHANGE_ME@postgres:5432/payd_db"
  "payd_user"
)

# Extract values from the stringData block. Uses Python for reliable YAML
# parsing — avoids fragile awk/grep that breaks on edge cases.
values=$(python3 -c "
import sys, re

with open('$SECRET_FILE') as f:
    content = f.read()

# Find the stringData block
match = re.search(r'^stringData:\s*\n((?:\s+\w+:.*\n?)*)', content, re.MULTILINE)
if not match:
    sys.exit(2)

block = match.group(1)
for line in block.strip().splitlines():
    # Extract value after the key: separator
    val = line.split(':', 1)[1].strip().strip('\"')
    print(val)
" 2>/dev/null)

if [[ -z "$values" ]]; then
  echo "ERROR: Could not parse stringData values from $SECRET_FILE"
  exit 2
fi

failed=0
while IFS= read -r value; do
  matched=0
  for allowed in "${ALLOWED_VALUES[@]}"; do
    if [[ "$value" == "$allowed" ]]; then
      matched=1
      break
    fi
  done
  if [[ $matched -eq 0 ]]; then
    echo "FAIL: $SECRET_FILE contains a non-placeholder value."
    echo "      Real secrets must not be committed. See k8s/README.md for safe alternatives."
    failed=1
  fi
done <<< "$values"

if [[ $failed -eq 1 ]]; then
  exit 1
fi

echo "OK: $SECRET_FILE contains only placeholder values."
exit 0
