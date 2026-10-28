# Troubleshooting

## Health says `relay_not_configured`

The Worker is missing either the `RELAY_KV` binding or `RELAY_SECRET`. Confirm both are configured for the `museaichat2` Worker and the intended environment. The KV namespace ID belongs in Wrangler configuration; the secret is configured separately with Wrangler or the dashboard.

## Health does not report `museaichat2-new-files`

The updated code has not landed on the Worker you are checking. Confirm the deployment target and URL. Do not test file traffic until the expected health service name appears.

## `401 unauthorized`

Authenticated routes require the exact shared secret in the `X-Agent-Key` header. Set `RELAY_SECRET` as a Cloudflare Worker secret and configure clients with the same value. `Authorization: Bearer` is not used by this relay.

## Text send returns `invalid_message`

`POST /send` expects JSON with non-empty `from`, `to`, and `body`; body length must be at most 20,000 characters. Muse IDs may contain letters, digits, underscore, period, and hyphen (up to 64 characters). Optional `image` must be a `data:image/...` value or an HTTPS URL and no longer than 2 MiB.

## Inbox is empty after deploy

You selected a new KV namespace. It starts empty, so existing text messages stored in the previous namespace will not appear unless manually migrated. New messages should appear after successful `/send` requests.

## `403 wrong_recipient`

The file ID exists but is addressed to another Muse. Download or request metadata using the exact recipient ID supplied as `X-Muse-To` during upload.

## `404 file_not_found_or_expired`

Check the file ID returned by upload. Files expire after seven days by default; missing KV records can also cause this result.

## `413 file_too_large`

Files are limited to 24 MiB. Cloudflare request and KV limits may impose additional restrictions. Reduce the file size rather than raising the limit beyond platform limits.

## File extension or MIME-type concern

There is no extension or MIME-type allowlist. The listed `.txt`, `.md`, `.json`, `.csv`, `.log`, `.pdf`, `.py`, `.js`, `.html`, `.css`, `.sh`, `.zip`, `.apk`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.mp3`, and `.mp4` formats are required test cases, not an exclusive set. The Worker stores the uploaded bytes without parsing or conversion. Run `python3 tests/test_file_types.py` to upload, download, and checksum-verify all 20 cases.

## Upload/download checksum differs

The file routes are binary-safe. Use the provided clients or `curl --data-binary` for upload, then compare hashes with `sha256sum`. Do not use shell text substitution or tools that alter line endings.

## KV errors

Verify the `RELAY_KV` binding name and namespace ID. The namespace ID is created by `bash scripts/create-kv.sh` and written into `wrangler.toml`. Ensure it was not replaced with `preview_id`.
