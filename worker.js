const FILE_PREFIX = "filedata:";
const META_PREFIX = "filemeta:";
const MAX_FILE_BYTES = 24 * 1024 * 1024;
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function corsHeaders(request, env) {
  return {
    "access-control-allow-origin": env.ALLOWED_ORIGIN || request.headers.get("Origin") || "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, X-Agent-Key, X-Muse-From, X-Muse-To, X-Muse-Id, X-File-Name",
    "access-control-expose-headers": "X-File-ID, X-Muse-From, X-Muse-To, Content-Disposition",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function error(message, status, cors) {
  return json({ error: message }, status, cors);
}

function validAgent(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value);
}

function authorized(request, env) {
  const supplied = request.headers.get("X-Agent-Key") || "";
  const expected = env.RELAY_SECRET || "";
  const a = new TextEncoder().encode(supplied);
  const b = new TextEncoder().encode(expected);
  if (!expected || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

function fileRoute(path) {
  const match = path.match(/^\/v1\/files\/([A-Za-z0-9_-]{8,80})(?:\/(metadata))?$/);
  return match ? { id: match[1], metadataOnly: Boolean(match[2]) } : null;
}

function cleanFileName(value) {
  let name = value || "file.bin";
  try { name = decodeURIComponent(name); } catch { /* use original header value */ }
  name = name.split(/[\\/]/).pop().replace(/[\r\n\0]/g, "_").slice(0, 180);
  return name || "file.bin";
}

function fileTtl(env) {
  const value = Number.parseInt(env.FILE_TTL_SECONDS || "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_TTL_SECONDS;
}

async function readInbox(env, agent) {
  const raw = await env.RELAY_KV.get(`inbox:${agent}`);
  if (!raw) return [];
  const value = JSON.parse(raw);
  return Array.isArray(value) ? value : [];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      if (!env.RELAY_KV || !env.RELAY_SECRET) return error("relay_not_configured", 503, cors);
      return json({ ok: true, service: "museaichat2-new-files" }, 200, cors);
    }

    if (!env.RELAY_KV || !env.RELAY_SECRET) return error("relay_not_configured", 503, cors);
    if (!authorized(request, env)) return error("unauthorized", 401, cors);

    if (request.method === "POST" && url.pathname === "/send") {
      let data;
      try { data = await request.json(); }
      catch { return error("invalid_json", 400, cors); }
      const from = String(data.from || "").trim();
      const to = String(data.to || "").trim();
      const body = String(data.body || "");
      if (!validAgent(from) || !validAgent(to) || !body || body.length > 20000) {
        return error("invalid_message", 400, cors);
      }
      if (data.image !== undefined) {
        if (typeof data.image !== "string" || data.image.length > 2 * 1024 * 1024) return error("image_too_large", 413, cors);
        if (!data.image.startsWith("data:image/") && !data.image.startsWith("https://")) {
          return error("image_must_be_data_or_https_url", 400, cors);
        }
      }
      try {
        const msg = { id: crypto.randomUUID(), from, to, body, ts: Date.now() };
        if (data.image) msg.image = data.image;
        const key = `inbox:${to}`;
        const inbox = await readInbox(env, to);
        inbox.push(msg);
        await env.RELAY_KV.put(key, JSON.stringify(inbox.slice(-200)));
        return json({ ok: true, id: msg.id, ts: msg.ts }, 201, cors);
      } catch {
        return error("inbox_storage_error", 500, cors);
      }
    }

    if (request.method === "GET" && url.pathname === "/inbox") {
      const agent = String(url.searchParams.get("agent") || "").trim();
      const since = Number(url.searchParams.get("since") || 0);
      if (!validAgent(agent) || !Number.isFinite(since)) return error("invalid_query", 400, cors);
      try {
        const inbox = await readInbox(env, agent);
        const fresh = inbox.filter((message) => Number(message.ts) > since);
        const last = inbox.length ? inbox[inbox.length - 1].ts : since;
        return json({ messages: fresh, last }, 200, cors);
      } catch {
        return error("inbox_storage_error", 500, cors);
      }
    }

    // Intentionally accept any filename extension and MIME type: file transfer
    // is opaque raw-byte storage, not a file parser or extension allowlist.
    if (request.method === "POST" && url.pathname === "/v1/files") {
      const from = request.headers.get("X-Muse-From") || "";
      const to = request.headers.get("X-Muse-To") || "";
      if (!validAgent(from) || !validAgent(to)) return error("invalid_muse_identity", 400, cors);
      const contentLength = Number(request.headers.get("Content-Length") || 0);
      if (contentLength > MAX_FILE_BYTES) return error("file_too_large", 413, cors);
      if (!request.body) return error("empty_file", 400, cors);
      let bytes;
      try { bytes = await request.arrayBuffer(); }
      catch { return error("invalid_upload", 400, cors); }
      if (!bytes.byteLength) return error("empty_file", 400, cors);
      if (bytes.byteLength > MAX_FILE_BYTES) return error("file_too_large", 413, cors);

      const id = crypto.randomUUID().replaceAll("-", "");
      const ttl = fileTtl(env);
      const metadata = {
        id,
        name: cleanFileName(request.headers.get("X-File-Name")),
        contentType: request.headers.get("Content-Type") || "application/octet-stream",
        size: bytes.byteLength,
        from,
        to,
        createdAt: new Date().toISOString(),
        expiresInSeconds: ttl,
      };
      try {
        await env.RELAY_KV.put(`${FILE_PREFIX}${id}`, bytes, { expirationTtl: ttl });
        await env.RELAY_KV.put(`${META_PREFIX}${id}`, JSON.stringify(metadata), { expirationTtl: ttl });
      } catch {
        return error("file_storage_error", 502, cors);
      }
      return json(metadata, 201, { ...cors, "x-file-id": id });
    }

    if (request.method === "GET" && url.pathname === "/v1/files") {
      const agent = request.headers.get("X-Muse-Id") || url.searchParams.get("agent") || "";
      if (!validAgent(agent)) return error("invalid_muse_identity", 400, cors);
      if (typeof env.RELAY_KV.list !== "function") return error("file_listing_unavailable", 501, cors);
      const cursor = url.searchParams.get("cursor") || undefined;
      try {
        const page = await env.RELAY_KV.list({ prefix: META_PREFIX, limit: 100, cursor });
        const records = await Promise.all(page.keys.map(async ({ name }) => {
          try { return await env.RELAY_KV.get(name, "json"); } catch { return null; }
        }));
        return json({ files: records.filter((record) => record && record.to === agent), cursor: page.cursor || null, list_complete: Boolean(page.list_complete) }, 200, cors);
      } catch {
        return error("file_listing_error", 502, cors);
      }
    }

    const route = request.method === "GET" ? fileRoute(url.pathname) : null;
    if (route) {
      const agent = request.headers.get("X-Muse-Id") || url.searchParams.get("agent") || "";
      if (!validAgent(agent)) return error("invalid_muse_identity", 400, cors);
      let metadata;
      try { metadata = await env.RELAY_KV.get(`${META_PREFIX}${route.id}`, "json"); }
      catch { return error("file_storage_error", 502, cors); }
      if (!metadata) return error("file_not_found_or_expired", 404, cors);
      if (metadata.to !== agent) return error("wrong_recipient", 403, cors);
      if (route.metadataOnly) return json(metadata, 200, cors);

      let bytes;
      try { bytes = await env.RELAY_KV.get(`${FILE_PREFIX}${route.id}`, "arrayBuffer"); }
      catch { return error("file_storage_error", 502, cors); }
      if (!bytes) return error("file_content_not_found_or_expired", 404, cors);
      const safeName = metadata.name.replace(/["\\\r\n]/g, "_");
      return new Response(bytes, {
        status: 200,
        headers: {
          ...cors,
          "content-type": metadata.contentType || "application/octet-stream",
          "content-length": String(metadata.size),
          "content-disposition": `attachment; filename="${safeName}"`,
          "cache-control": "no-store",
          "x-file-id": metadata.id,
          "x-muse-from": metadata.from,
          "x-muse-to": metadata.to,
        },
      });
    }

    return error("not_found", 404, cors);
  },
};
