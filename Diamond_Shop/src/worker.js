
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store",
    };

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers });

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "Diamond Shop API" });
    }

    // Endpoints reserved for the Discord bot
    if (url.pathname.startsWith("/api/bot/")) {
      const auth = request.headers.get("Authorization") || "";
      if (!env.BOT_KEY || auth !== `Bearer ${env.BOT_KEY}`) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }

      if (!env.DB) {
        return json({ ok: false, error: "Database not configured" }, 500);
      }

      if (url.pathname === "/api/bot/orders" && request.method === "GET") {
        try {
          const result = await env.DB.prepare(
            `SELECT id, discord_user_id, item_name, quantity,
                    amount_toman, status, created_at, expires_at
             FROM orders
             WHERE status = 'pending'
             ORDER BY created_at ASC`
          ).all();

          return json(result.results || []);
        } catch (error) {
          return json({ ok: false, error: "Database query failed" }, 500);
        }
      }

      const match = url.pathname.match(/^\/api\/bot\/orders\/([^/]+)\/status$/);
      if (match && request.method === "POST") {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, error: "Invalid JSON" }, 400);
        }

        const allowed = [
          "pending",
          "approved",
          "rejected",
          "reported_scam",
          "completed",
        ];

        if (!allowed.includes(body.status)) {
          return json({ ok: false, error: "Invalid status" }, 400);
        }

        try {
          const result = await env.DB.prepare(
            "UPDATE orders SET status = ? WHERE id = ?"
          ).bind(body.status, decodeURIComponent(match[1])).run();

          if (!result.meta?.changes) {
            return json({ ok: false, error: "Order not found" }, 404);
          }

          return json({ ok: true, status: body.status });
        } catch (error) {
          return json({ ok: false, error: "Database update failed" }, 500);
        }
      }

      return json({ ok: false, error: "Route not found" }, 404);
    }

    return json({ ok: false, error: "Route not found" }, 404);
  },
};
