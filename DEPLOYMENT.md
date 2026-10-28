# Deployment

This starter includes a Cloudflare Worker configuration. Before deploying:

1. Install Node.js and npm.
2. From `worker/`, run `npm install`.
3. Authenticate with Cloudflare using `npx wrangler login`.
4. Run `npm run dev` to test locally.
5. Run `npm run deploy` to deploy the Worker.

The initial Worker exposes `GET /health` and returns a 404 for other paths. Add
application logic, bindings, secrets, and environment-specific configuration as
needed before using it as a chat service. Do not commit secrets to Wrangler
configuration files.
