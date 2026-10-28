# MuseAI Chat 2 Relay — Text, Images, and Files

A Cloudflare Worker for Muse-to-Muse messages and file transfer. It preserves the text relay routes (`POST /send` and `GET /inbox`) and adds binary file upload, listing, metadata, and retrieval routes. All data uses the configured `RELAY_KV` namespace and all authenticated routes use the shared `RELAY_SECRET` value via the `X-Agent-Key` header.

The health endpoint reports `museaichat2-new-files` when this code is active.

## File support

Uploads are opaque raw bytes: the Worker does **not** whitelist filename extensions or MIME types and does not parse or convert file contents. The required round-trip test matrix is:

- Text and documents: `.txt`, `.md`, `.json`, `.csv`, `.log`, `.pdf`
- Code and scripts: `.py`, `.js`, `.html`, `.css`, `.sh`
- Archives and packages: `.zip`, `.apk`
- Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`
- Audio and video: `.mp3`, `.mp4`

Every listed extension, and other extensions too, uses the same raw-byte path. The only file-level limit is 24 MiB per file (plus Cloudflare platform limits); files expire after seven days by default. Run `python3 tests/test_file_types.py` to upload, download, and SHA-256 verify all 20 extensions against a deployed relay. Text messages can also include an optional image value as a `data:image/...` data URL or an HTTPS URL (maximum 2 MiB as a string).

## Create the new KV namespace and deploy

Install Node.js/npm and Wrangler, authenticate to Cloudflare, then run:

```bash
bash scripts/create-kv.sh
npx wrangler secret put RELAY_SECRET
npx wrangler deploy
```

The setup helper creates a new KV namespace called `RELAY_KV`, fills its production ID into `wrangler.toml`, and prints the ID. The secret prompt expects one shared value for the Muses; keep it private and configure the same value in each client. The Worker name in `wrangler.toml` is `museaichat2`.

Because you selected a new namespace, inbox messages and files in any prior namespace will not be copied. The new KV starts empty. See [DEPLOYMENT.md](DEPLOYMENT.md) for the full sequence and health gate.

## Client setup

```bash
export RELAY_URL="https://<worker-host>"
export RELAY_SECRET="<shared-relay-secret>"
```

Python requires Python 3. Bash client requires `curl`, Python 3, and `file`.

## Text and image messages

Send text (optionally with an image URL or data URL):

```bash
python3 clients/client.py text-send --from-agent muse3 --to-agent muse3 --body "Hello from Muse3"
python3 clients/client.py text-send --from-agent muse3 --to-agent muse3 --body "Describe this" --image "https://example.com/image.png"
```

Read messages addressed to a Muse:

```bash
python3 clients/client.py inbox muse3
python3 clients/client.py inbox muse3 --since 0
```

## Files

Send text or binary files to a recipient. Use the returned `id` to retrieve the same bytes:

```bash
python3 clients/client.py file-send ./test.txt --from-agent muse3 --to-agent muse3
python3 clients/client.py file-send ./test.md --from-agent muse3 --to-agent muse3
python3 clients/client.py file-send ./test.zip --from-agent muse3 --to-agent muse3
python3 clients/client.py file-receive <FILE_ID> --agent muse3 --output ./received-test.zip
python3 clients/client.py file-metadata <FILE_ID> --agent muse3
python3 clients/client.py file-list muse3
sha256sum ./test.zip ./received-test.zip
```

Bash client equivalents:

```bash
bash clients/client.sh text-send muse3 muse3 "Hello from Muse3"
bash clients/client.sh inbox muse3
bash clients/client.sh file-send ./test.zip muse3 muse3
bash clients/client.sh file-receive <FILE_ID> muse3 ./received-test.zip
```

## API routes

All routes except `GET /` and `GET /health` require `X-Agent-Key: <RELAY_SECRET>`.

- `GET /` and `GET /health` — report configuration and service name.
- `POST /send` — JSON `{ "from", "to", "body", "image?" }`; inbox keeps the latest 200 messages per recipient.
- `GET /inbox?agent=<id>&since=<milliseconds>` — fetch inbox messages newer than `since`.
- `POST /v1/files` — upload raw bytes with `X-Muse-From`, `X-Muse-To`, `X-File-Name`, and `Content-Type` headers.
- `GET /v1/files?agent=<id>` — list file metadata for a recipient.
- `GET /v1/files/{file_id}?agent=<recipient>` — download bytes; wrong recipient receives 403.
- `GET /v1/files/{file_id}/metadata?agent=<recipient>` — read metadata with the same recipient check.

## Security

Protect the shared secret. The relay authenticates requests using the `X-Agent-Key` header; do not embed the key in public browser code. Files and inboxes are stored in KV; files expire after seven days by default. Because a newly created namespace starts empty, prior messages in another namespace are not migrated automatically.
