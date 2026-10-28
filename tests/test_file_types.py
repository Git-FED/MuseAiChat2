#!/usr/bin/env python3
"""End-to-end raw-byte round-trip tests for the requested extension matrix.

Run against a deployed relay after setting RELAY_URL and RELAY_SECRET.
The Worker intentionally does not whitelist extensions or MIME types.
"""

import hashlib
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

EXTENSIONS = [
    ".txt", ".md", ".json", ".csv", ".log", ".pdf",
    ".py", ".js", ".html", ".css", ".sh",
    ".zip", ".apk",
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".mp3", ".mp4",
]


def call(url, secret, method="GET", data=None, headers=None):
    request_headers = {"X-Agent-Key": secret}
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, data=data, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Request failed: {exc.reason}") from exc


def main():
    base = os.environ.get("RELAY_URL", "").rstrip("/")
    secret = os.environ.get("RELAY_SECRET", "")
    sender = os.environ.get("MUSE_FROM", "muse3")
    recipient = os.environ.get("MUSE_TO", "muse3")
    if not base or not secret:
        print("Set RELAY_URL and RELAY_SECRET first.", file=sys.stderr)
        return 2

    failures = []
    print(f"Testing {len(EXTENSIONS)} extensions: sender={sender}, recipient={recipient}")
    for extension in EXTENSIONS:
        # Include non-text bytes to prove the relay transfers opaque binary data.
        payload = (f"Muses round-trip {extension}\r\n".encode("utf-8") + bytes([0, 255, 13, 10]) + extension.encode())
        filename = f"muses-test{extension}"
        mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        encoded_name = urllib.parse.quote(filename, safe="")
        try:
            status, _, raw = call(
                f"{base}/v1/files",
                secret,
                method="POST",
                data=payload,
                headers={
                    "Content-Type": mime,
                    "Content-Length": str(len(payload)),
                    "X-Muse-From": sender,
                    "X-Muse-To": recipient,
                    "X-File-Name": encoded_name,
                },
            )
            if status != 201:
                raise RuntimeError(f"Upload returned HTTP {status}: {raw.decode('utf-8', errors='replace')}")
            file_id = json.loads(raw.decode("utf-8"))["id"]
            query = urllib.parse.urlencode({"agent": recipient})
            status, _, received = call(f"{base}/v1/files/{file_id}?{query}", secret)
            if status != 200:
                raise RuntimeError(f"Download returned HTTP {status}")
            expected_hash = hashlib.sha256(payload).hexdigest()
            actual_hash = hashlib.sha256(received).hexdigest()
            if actual_hash != expected_hash:
                raise RuntimeError(f"Checksum mismatch: expected {expected_hash}, got {actual_hash}")
            print(f"PASS {extension} ({len(payload)} bytes, SHA-256 {actual_hash})")
        except Exception as exc:  # report every extension rather than stopping at first failure
            failures.append((extension, str(exc)))
            print(f"FAIL {extension}: {exc}")

    if failures:
        print(f"\n{len(failures)} of {len(EXTENSIONS)} file-type tests failed.", file=sys.stderr)
        return 1
    print(f"\nAll {len(EXTENSIONS)} file-type round trips passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
