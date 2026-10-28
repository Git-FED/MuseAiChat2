# MuseAI Chat2

Starter scaffold for a MuseAI Chat2 service.

## Structure

- `wrangler.toml` — project-level Wrangler configuration.
- `worker/` — Cloudflare Worker entry point, package metadata, and Worker config.
- `clients/bus.py` — placeholder Python client-side message bus interface.
- `DEPLOYMENT.md` — initial Cloudflare deployment steps.

The Worker currently provides a `GET /health` endpoint. Application-specific
chat behavior and the client transport have not yet been implemented.
