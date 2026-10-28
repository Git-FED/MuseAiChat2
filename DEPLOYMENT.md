# Deployment

This Worker merges the Muses text relay (`/send`, `/inbox`) with image-message pass-through and file transfer. It targets the existing Worker name `museaichat2`, uses `RELAY_KV`, and reads the shared `RELAY_SECRET` from the `X-Agent-Key` request header.

You selected a **new KV namespace**. A new namespace starts empty; old inboxes or file data in another namespace are not migrated by this package.

## 1. Create a KV namespace and configure Wrangler

From the repository root, with Node.js/npm installed and a Cloudflare login available:

```bash
bash scripts/create-kv.sh
```

The helper checks `wrangler whoami`, creates the namespace named `RELAY_KV`, extracts the production `id`, writes it into `wrangler.toml`, and prints the ID. Do not use the `preview_id`.

If the helper says it created the namespace but could not parse the ID, **do not rerun it** (that would create another namespace). Copy the production `id` from the command output and replace `REPLACE_WITH_NEW_RELAY_KV_NAMESPACE_ID` in `wrangler.toml` manually.

## 2. Set the shared secret

Set `RELAY_SECRET` for the `museaichat2` Worker:

```bash
npx wrangler secret put RELAY_SECRET
```

When prompted, enter the one shared secret value that will be configured for all Muses. Do not put it in `wrangler.toml` or commit it. Authenticated routes use `X-Agent-Key: <same secret>`.

## 3. Deploy

Review that `wrangler.toml` contains the generated KV namespace ID and `name = "museaichat2"`, then run:

```bash
npx wrangler deploy
```

This replaces the Worker code for the existing Worker name. The provided merged Worker includes both `/send` and `/inbox` text routes, plus `/v1/files` routes; it is not file-only.

## 4. Health gate

Before sending test traffic, check:

```bash
curl --fail-with-body "https://<worker-host>/health"
```

Expected response:

```json
{"ok":true,"service":"museaichat2-new-files"}
```

If it returns `relay_not_configured`, check that the `RELAY_KV` binding and `RELAY_SECRET` are set on this Worker. If the service name has not changed, the new Worker code has not landed; stop before testing.

## 5. Verify text, image, and file routes

Set the Worker URL and secret in the shell:

```bash
export RELAY_URL="https://<worker-host>"
export RELAY_SECRET="<shared-secret>"
```

Verify text send/inbox:

```bash
python3 clients/client.py text-send --from-agent muse3 --to-agent muse3 --body "relay test"
python3 clients/client.py inbox muse3
```

Run the full extension round-trip suite. The Worker does not whitelist extensions or MIME types; every upload is raw bytes. The test covers text/documents (`.txt`, `.md`, `.json`, `.csv`, `.log`, `.pdf`), code/scripts (`.py`, `.js`, `.html`, `.css`, `.sh`), archives/packages (`.zip`, `.apk`), images (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`), and audio/video (`.mp3`, `.mp4`). Each file is uploaded to `muse3`, downloaded again, and verified byte-for-byte with SHA-256.

```bash
python3 tests/test_file_types.py
```

The test reports a `PASS` line and checksum for each extension; it exits non-zero if any upload, download, or byte comparison fails. Each sample is deliberately treated as raw bytes; the `.pdf`, image, audio/video, archive, and package test bodies do not need to be valid/renderable documents because the relay does not inspect file contents.

Only move other clients after all tests pass and the operator approves that rollout.

## Storage behavior

Text inboxes use `inbox:<agent>` keys and retain the latest 200 messages per recipient. File bytes and metadata use separate relay-managed keys in the same `RELAY_KV` namespace. Files expire after seven days by default and are limited to 24 MiB each.
