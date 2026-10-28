#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  client.sh text-send FROM TO BODY [IMAGE_URL]
  client.sh inbox AGENT [SINCE_MS]
  client.sh file-send FILE FROM TO
  client.sh file-receive FILE_ID AGENT OUTPUT_PATH
  client.sh file-metadata FILE_ID AGENT
  client.sh file-list AGENT

Set RELAY_URL and RELAY_SECRET in the environment. The shared key is sent as X-Agent-Key.
USAGE
  exit 2
}

[[ $# -ge 1 ]] || usage
: "${RELAY_URL:?Set RELAY_URL to the deployed relay URL}"
: "${RELAY_SECRET:?Set RELAY_SECRET to the relay shared key}"
base="${RELAY_URL%/}"

case "$1" in
  text-send)
    [[ $# -ge 4 && $# -le 5 ]] || usage
    payload="$(python3 -c 'import json,sys; d={"from":sys.argv[1],"to":sys.argv[2],"body":sys.argv[3]}; d.update({"image":sys.argv[4]} if len(sys.argv)>4 else {}); print(json.dumps(d))' "$2" "$3" "$4" "${5-}")"
    curl --fail-with-body --silent --show-error -X POST "${base}/send" \
      -H "X-Agent-Key: ${RELAY_SECRET}" -H "Content-Type: application/json" --data "$payload"
    ;;
  inbox)
    [[ $# -ge 2 && $# -le 3 ]] || usage
    since="${3:-0}"
    curl --fail-with-body --silent --show-error --get "${base}/inbox" \
      -H "X-Agent-Key: ${RELAY_SECRET}" --data-urlencode "agent=$2" --data-urlencode "since=$since"
    ;;
  file-send)
    [[ $# -eq 4 ]] || usage
    file="$2"; from_agent="$3"; to_agent="$4"
    [[ -f "$file" ]] || { echo "Not a file: $file" >&2; exit 2; }
    filename="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$(basename "$file")")"
    mime="$(file --brief --mime-type "$file" 2>/dev/null || printf 'application/octet-stream')"
    curl --fail-with-body --silent --show-error -X POST "${base}/v1/files" \
      -H "X-Agent-Key: ${RELAY_SECRET}" -H "X-Muse-From: ${from_agent}" \
      -H "X-Muse-To: ${to_agent}" -H "X-File-Name: ${filename}" \
      -H "Content-Type: ${mime}" --data-binary "@${file}"
    ;;
  file-receive)
    [[ $# -eq 4 ]] || usage
    curl --fail-with-body --silent --show-error -G "${base}/v1/files/$2" \
      -H "X-Agent-Key: ${RELAY_SECRET}" --data-urlencode "agent=$3" --output "$4"
    echo "Saved $4"
    ;;
  file-metadata)
    [[ $# -eq 3 ]] || usage
    curl --fail-with-body --silent --show-error -G "${base}/v1/files/$2/metadata" \
      -H "X-Agent-Key: ${RELAY_SECRET}" --data-urlencode "agent=$3"
    ;;
  file-list)
    [[ $# -eq 2 ]] || usage
    curl --fail-with-body --silent --show-error -G "${base}/v1/files" \
      -H "X-Agent-Key: ${RELAY_SECRET}" --data-urlencode "agent=$2"
    ;;
  *) usage ;;
esac
