#!/usr/bin/env python3
"""Python client for Muse-to-Muse text, image, and file relay operations."""

import argparse
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def request(url, key, method="GET", data=None, headers=None):
    request_headers = {"X-Agent-Key": key, "Accept": "application/json"}
    if headers:
        request_headers.update(headers)
    req = urllib.request.Request(url, data=data, headers=request_headers, method=method)
    try:
        return urllib.request.urlopen(req, timeout=300)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Request failed: {exc.reason}") from exc


def print_json_response(response):
    raw = response.read().decode("utf-8")
    print(json.dumps(json.loads(raw), indent=2, ensure_ascii=False) if raw else "{}")


def main():
    parser = argparse.ArgumentParser(description="Use the Muses text and file relay")
    parser.add_argument("--url", default=os.environ.get("RELAY_URL", ""), help="Worker URL (or set RELAY_URL)")
    parser.add_argument("--key", default=os.environ.get("RELAY_SECRET", ""), help="Shared key (or set RELAY_SECRET)")
    actions = parser.add_subparsers(dest="action", required=True)

    send = actions.add_parser("text-send", help="Send a text message, optionally with an image URL/data URL")
    send.add_argument("--from-agent", required=True)
    send.add_argument("--to-agent", required=True)
    send.add_argument("--body", required=True)
    send.add_argument("--image")

    inbox = actions.add_parser("inbox", help="Poll a Muse inbox")
    inbox.add_argument("agent")
    inbox.add_argument("--since", type=int, default=0, help="Only return messages newer than this millisecond timestamp")

    file_send = actions.add_parser("file-send", help="Send raw file bytes to a recipient Muse")
    file_send.add_argument("path")
    file_send.add_argument("--from-agent", required=True)
    file_send.add_argument("--to-agent", required=True)

    file_receive = actions.add_parser("file-receive", help="Download a file addressed to a Muse")
    file_receive.add_argument("file_id")
    file_receive.add_argument("--agent", required=True)
    file_receive.add_argument("--output", required=True)

    file_metadata = actions.add_parser("file-metadata", help="Read metadata for a file addressed to a Muse")
    file_metadata.add_argument("file_id")
    file_metadata.add_argument("--agent", required=True)

    file_list = actions.add_parser("file-list", help="List files addressed to a Muse")
    file_list.add_argument("agent")

    args = parser.parse_args()
    base = args.url.rstrip("/")
    if not base:
        parser.error("Set --url or RELAY_URL")
    if not args.key:
        parser.error("Set --key or RELAY_SECRET")

    try:
        if args.action == "text-send":
            payload = {"from": args.from_agent, "to": args.to_agent, "body": args.body}
            if args.image:
                payload["image"] = args.image
            data = json.dumps(payload).encode("utf-8")
            with request(f"{base}/send", args.key, "POST", data, {"Content-Type": "application/json"}) as response:
                print_json_response(response)

        elif args.action == "inbox":
            query = urllib.parse.urlencode({"agent": args.agent, "since": args.since})
            with request(f"{base}/inbox?{query}", args.key) as response:
                print_json_response(response)

        elif args.action == "file-send":
            path = Path(args.path)
            if not path.is_file():
                raise RuntimeError(f"Not a file: {path}")
            data = path.read_bytes()
            mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            encoded_name = urllib.parse.quote(path.name, safe="")
            headers = {
                "Content-Type": mime,
                "Content-Length": str(len(data)),
                "X-Muse-From": args.from_agent,
                "X-Muse-To": args.to_agent,
                "X-File-Name": encoded_name,
            }
            with request(f"{base}/v1/files", args.key, "POST", data, headers) as response:
                print_json_response(response)

        elif args.action == "file-receive":
            query = urllib.parse.urlencode({"agent": args.agent})
            with request(f"{base}/v1/files/{args.file_id}?{query}", args.key) as response:
                output = Path(args.output)
                output.write_bytes(response.read())
                print(f"Saved {output} ({response.headers.get('Content-Length', 'unknown')} bytes)")

        elif args.action == "file-metadata":
            query = urllib.parse.urlencode({"agent": args.agent})
            with request(f"{base}/v1/files/{args.file_id}/metadata?{query}", args.key) as response:
                print_json_response(response)

        elif args.action == "file-list":
            query = urllib.parse.urlencode({"agent": args.agent})
            with request(f"{base}/v1/files?{query}", args.key) as response:
                print_json_response(response)
        return 0
    except (RuntimeError, OSError, json.JSONDecodeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
