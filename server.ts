// Chess matchmaking server — deploy on Deno Deploy (free, always-on)
// Rooms auto-expire after 5 minutes unless the host sends a heartbeat every 60 s.

const kv = await Deno.openKv();
const ROOM_TTL_MS = 5 * 60 * 1000; // 5 minutes

const CORS_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

Deno.serve(async (req: Request) => {
  const { pathname } = new URL(req.url);

  // Pre-flight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // ── GET /rooms ──────────────────────────────────────────────────────────────
  if (req.method === "GET" && pathname === "/rooms") {
    const rooms: unknown[] = [];
    for await (const { value } of kv.list({ prefix: ["rooms"] })) {
      rooms.push(value);
    }
    return new Response(JSON.stringify(rooms), { headers: CORS_HEADERS });
  }

  // ── POST /rooms ─────────────────────────────────────────────────────────────
  if (req.method === "POST" && pathname === "/rooms") {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const rawName = typeof body.name === "string" ? body.name.trim() : "";
    const name = rawName.length > 0 ? rawName.slice(0, 40) : "Chess Game";
    const port = typeof body.port === "number" ? body.port : 8080;
    // Prefer client-reported IP (more reliable than edge-network header detection)
    const rawIp = typeof body.ip === "string" ? body.ip.trim() : "";
    const ip = rawIp.length > 0 ? rawIp : clientIp(req);
    const id = crypto.randomUUID();
    const room = { id, name, ip, port, created_at: Date.now() };
    await kv.set(["rooms", id], room, { expireIn: ROOM_TTL_MS });
    return new Response(JSON.stringify({ id }), { status: 201, headers: CORS_HEADERS });
  }

  // ── POST /rooms/:id/heartbeat ───────────────────────────────────────────────
  const hbMatch = pathname.match(/^\/rooms\/([^/]+)\/heartbeat$/);
  if (req.method === "POST" && hbMatch) {
    const entry = await kv.get(["rooms", hbMatch[1]]);
    if (!entry.value) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: CORS_HEADERS });
    }
    await kv.set(["rooms", hbMatch[1]], entry.value, { expireIn: ROOM_TTL_MS });
    return new Response(JSON.stringify({ ok: true }), { headers: CORS_HEADERS });
  }

  // ── DELETE /rooms/:id ───────────────────────────────────────────────────────
  const delMatch = pathname.match(/^\/rooms\/([^/]+)$/);
  if (req.method === "DELETE" && delMatch) {
    await kv.delete(["rooms", delMatch[1]]);
    return new Response(JSON.stringify({ ok: true }), { headers: CORS_HEADERS });
  }

  return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: CORS_HEADERS });
});
