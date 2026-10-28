#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/wrangler.toml"
PLACEHOLDER="REPLACE_WITH_NEW_RELAY_KV_NAMESPACE_ID"

command -v npx >/dev/null 2>&1 || { echo "npx is required; install Node.js/npm first." >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required to safely update wrangler.toml." >&2; exit 1; }

if ! grep -Fq "id = \"$PLACEHOLDER\"" "$CONFIG"; then
  echo "wrangler.toml no longer has the placeholder. Refusing to create another namespace." >&2
  exit 1
fi

# Run outside the repository so Wrangler does not try to validate the
# intentionally-placeholder namespace ID before the namespace exists.
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
printf 'Checking Cloudflare login...\n'
(cd "$workdir" && npx wrangler whoami)
printf '\nCreating a new KV namespace named RELAY_KV...\n'
output="$(cd "$workdir" && npx wrangler kv namespace create RELAY_KV 2>&1)" || {
  printf '%s\n' "$output" >&2
  exit 1
}
printf '%s\n' "$output"

namespace_id="$(printf '%s\n' "$output" | python3 -c '
import re, sys
text = sys.stdin.read()
patterns = [r"\bid\s*=\s*[\"\x27]([A-Za-z0-9_-]{16,})[\"\x27]", r"[\"\x27]id[\"\x27]\s*:\s*[\"\x27]([A-Za-z0-9_-]{16,})[\"\x27]"]
for pattern in patterns:
    matches = re.findall(pattern, text)
    if matches:
        print(matches[-1])
        raise SystemExit(0)
raise SystemExit(1)
')" || {
  cat >&2 <<'MSG'

The namespace command completed, but its ID could not be parsed automatically.
Do not rerun the create command (that would make another namespace).
Copy the production `id` from the output above into wrangler.toml, replacing
REPLACE_WITH_NEW_RELAY_KV_NAMESPACE_ID. Do not use preview_id.
MSG
  exit 1
}

python3 - "$CONFIG" "$PLACEHOLDER" "$namespace_id" <<'PY'
from pathlib import Path
import sys
config, placeholder, namespace_id = sys.argv[1:]
p = Path(config)
text = p.read_text()
needle = f'id = "{placeholder}"'
if text.count(needle) != 1:
    raise SystemExit("Expected exactly one KV ID placeholder; no config changes made.")
p.write_text(text.replace(needle, f'id = "{namespace_id}"', 1))
PY

printf '\nKV namespace created and configured. Production namespace ID: %s\n' "$namespace_id"
printf 'Next: set RELAY_SECRET for the Worker, then run: npx wrangler deploy\n'
