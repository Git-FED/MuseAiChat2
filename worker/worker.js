/**
 * Minimal Cloudflare Worker starter for MuseAI Chat2.
 * Replace the health response with the application's chat/API logic.
 */
export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "museai-chat2" });
    }

    return Response.json(
      { error: "Not found" },
      { status: 404 },
    );
  },
};
