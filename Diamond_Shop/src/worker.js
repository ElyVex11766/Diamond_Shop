export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store",
    };

    const json = (data, status = 200) =>
      Response.json(data, { status, headers });

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "Diamond Shop API" });
    }

    if (url.pathname.startsWith("/api/bot/")) {
      const auth = request.headers.get("Authorization") || "";

      if (!env.BOT_KEY) {
        return json({ ok: false, error: "BOT_KEY missing in Worker" }, 500);
      }

      if (auth !== `Bearer ${env.BOT_KEY}`) {
        return json({ ok: false, error: "Authorization mismatch" }, 401);
      }

      if (!env.DB) {
        return json({ ok: false, error: "Database not configured" }, 500);
      }

      if (
        url.pathname === "/api/bot/payment-links" &&
        request.method === "POST"
      ) {
        let body;

        try {
          body = await request.json();
        } catch {
          return json({ ok: false, error: "Invalid JSON" }, 400);
        }

        const {
          order_id,
          discord_user_id,
          discord_username,
          item_name,
          quantity,
          unit_price_toman,
          amount_toman,
          expires_at,
        } = body;

        if (
          !order_id ||
          !discord_user_id ||
          !discord_username ||
          !item_name ||
          !Number.isSafeInteger(quantity) ||
          quantity < 1 ||
          !Number.isSafeInteger(unit_price_toman) ||
          unit_price_toman < 0 ||
          (amount_toman !== undefined &&
            (!Number.isSafeInteger(amount_toman) || amount_toman < 0)) ||
          !expires_at ||
          !Number.isFinite(Date.parse(expires_at)) ||
          Date.parse(expires_at) <= Date.now()
        ) {
          return json({ ok: false, error: "Invalid order data" }, 400);
        }

        const amount =
          amount_toman === undefined
            ? quantity * unit_price_toman
            : amount_toman;

        if (!Number.isSafeInteger(amount)) {
          return json({ ok: false, error: "Invalid total amount" }, 400);
        }

        try {
          await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS payment_links (
              id TEXT PRIMARY KEY,
              token_hash TEXT NOT NULL UNIQUE,
              discord_user_id TEXT NOT NULL,
              discord_username TEXT NOT NULL,
              item_name TEXT NOT NULL,
              quantity INTEGER NOT NULL,
              unit_price_toman INTEGER NOT NULL,
              amount_toman INTEGER NOT NULL,
              status TEXT NOT NULL DEFAULT 'pending',
              created_at TEXT NOT NULL,
              expires_at TEXT NOT NULL
            )
          `).run();

          const bytes = crypto.getRandomValues(new Uint8Array(32));
          const token = Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

          const digest = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(token)
          );

          const tokenHash = Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

          await env.DB.prepare(`
            INSERT INTO payment_links (
              id, token_hash, discord_user_id, discord_username,
              item_name, quantity, unit_price_toman, amount_toman,
              status, created_at, expires_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
          `)
            .bind(
              String(order_id),
              tokenHash,
              String(discord_user_id),
              String(discord_username),
              String(item_name),
              quantity,
              unit_price_toman,
              amount,
              new Date().toISOString(),
              new Date(expires_at).toISOString()
            )
            .run();

          return json(
            {
              ok: true,
              order_id: String(order_id),
              payment_url: `${url.origin}/pay/${token}`,
              expires_at: new Date(expires_at).toISOString(),
            },
            201
          );
        } catch (error) {
          console.error("Payment link creation failed:", error);
          return json(
            {
              ok: false,
              error:
                "Could not create payment link; check D1 schema and duplicate order ID.",
            },
            500
          );
        }
      }

      if (
        url.pathname === "/api/bot/orders" &&
        request.method === "GET"
      ) {
        try {
          const result = await env.DB.prepare(`
            SELECT id, discord_user_id, item_name, quantity,
                   amount_toman, status, created_at, expires_at
            FROM orders
            WHERE status = 'pending'
            ORDER BY created_at ASC
          `).all();

          return json(result.results || []);
        } catch (error) {
          console.error("GET /api/bot/orders failed:", error);
          return json({ ok: false, error: "Database query failed" }, 500);
        }
      }

      const match = url.pathname.match(
        /^\/api\/bot\/orders\/([^/]+)\/status$/
      );

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
          )
            .bind(body.status, decodeURIComponent(match[1]))
            .run();

          if (!result.meta?.changes) {
            return json({ ok: false, error: "Order not found" }, 404);
          }

          return json({ ok: true, status: body.status });
        } catch (error) {
          console.error("Order status update failed:", error);
          return json({ ok: false, error: "Database update failed" }, 500);
        }
      }

      return json({ ok: false, error: "Route not found" }, 404);
    }

    const paymentMatch = url.pathname.match(
      /^\/api\/payment-links\/([a-f0-9]{64})$/
    );

    if (paymentMatch && request.method === "GET") {
      if (!env.DB) {
        return json({ ok: false, error: "Database not configured" }, 500);
      }

      try {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(paymentMatch[1])
        );

        const tokenHash = Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        const order = await env.DB.prepare(`
          SELECT id, discord_username, item_name, quantity,
                 unit_price_toman, amount_toman, status,
                 created_at, expires_at
          FROM payment_links
          WHERE token_hash = ?
          LIMIT 1
        `)
          .bind(tokenHash)
          .first();
      }
        if (!order) 
          return json({ ok: false, error: "Link not found" }, 404);
        }

        if (
          order.status !== "pending" ||
          Date.parse(order.expires_at) <= Date.now()
        ) {
          return json(
            { ok: false, expired: true, error: "Link Expired" },
            410
          );
        }

        return json({ ok: true, order });
      } catch (error) {
        console.error("Payment link lookup failed:", error);
        return json({ ok: false, error: "Database query failed" }, 500);
      }
    }

    if (
      /^\/pay\/[a-f0-9]{64}$/.test(url.pathname) &&
      request.method === "GET"
    ) {
      if (!env.ASSETS) {
        return json({ ok: false, error: "Assets not configured" }, 500);
      }

      return env.ASSETS.fetch(
        new Request(new URL("/index.html", url.origin), request)
      );
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return json({ ok: false, error: "Assets not configured" }, 500);
  },
};
