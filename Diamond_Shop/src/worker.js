
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function getBotKey(request) {
  return request.headers.get("Authorization") || "";
}

function isBotAuthorized(request, env) {
  const key = env.BOT_KEY;
  if (!key) return false;

  const auth = getBotKey(request);
  return auth === key || auth === `Bearer ${key}`;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    try {
      if (url.pathname === "/health" || url.pathname === "/api/health") {
        try {
          await env.DB.prepare("SELECT 1").first();

          return json({
            ok: true,
            database: "connected",
          });
        } catch (error) {
          console.error("Health check failed:", error);

          return json({
            ok: false,
            database: "error",
          }, 500);
        }
      }

      if (url.pathname === "/api/items" && method === "GET") {
        try {
          const result = await env.DB.prepare(
            "SELECT * FROM items ORDER BY id"
          ).all();

          return json({
            ok: true,
            items: result.results || [],
          });
        } catch (error) {
          console.error("Items query failed:", error);

          return json({
            ok: false,
            error: "Could not load items",
          }, 500);
        }
      }

      if (
        url.pathname === "/api/bot/payment-links" &&
        method === "POST"
      ) {
        if (!isBotAuthorized(request, env)) {
          return json({ ok: false, error: "Unauthorized" }, 401);
        }

        let body;

        try {
          body = await request.json();
        } catch {
          return json({ ok: false, error: "Invalid JSON" }, 400);
        }

        const orderId = body.order_id;
        const discordUsername = body.discord_username;
        const itemName = body.item_name;
        const quantity = Number(body.quantity);
        const unitPrice = Number(body.unit_price_toman);
        const amount = Number(
          body.amount_toman ?? quantity * unitPrice
        );
        const expiresAt = body.expires_at;

        if (
          orderId == null ||
          !discordUsername ||
          !itemName ||
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          !Number.isFinite(unitPrice) ||
          unitPrice < 0 ||
          !Number.isFinite(amount) ||
          amount < 0 ||
          !expiresAt ||
          !Number.isFinite(Date.parse(expiresAt)) ||
          Date.parse(expiresAt) <= Date.now()
        ) {
          return json({
            ok: false,
            error: "Invalid or missing order fields",
          }, 400);
        }

        try {
          await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS payment_links (
              id TEXT PRIMARY KEY,
              order_id TEXT NOT NULL,
              token_hash TEXT NOT NULL UNIQUE,
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

          const token = randomToken();
          const tokenHash = await sha256Hex(token);
          const createdAt = new Date().toISOString();
          const id = String(orderId);

          await env.DB.prepare(`
            INSERT INTO payment_links (
              id, order_id, token_hash, discord_username,
              item_name, quantity, unit_price_toman,
              amount_toman, status, created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            id,
            id,
            tokenHash,
            String(discordUsername),
            String(itemName),
            quantity,
            Math.round(unitPrice),
            Math.round(amount),
            "pending",
            createdAt,
            new Date(expiresAt).toISOString()
          ).run();

          return json({
            ok: true,
            order_id: id,
            payment_url: `${url.origin}/pay/${token}`,
            expires_at: new Date(expiresAt).toISOString(),
          }, 201);
        } catch (error) {
          console.error("Payment link creation failed:", error);

          return json({
            ok: false,
            error: "Could not create payment link",
          }, 500);
        }
      }

      if (url.pathname === "/api/bot/orders" && method === "GET") {
        if (!isBotAuthorized(request, env)) {
          return json({ ok: false, error: "Unauthorized" }, 401);
        }

        try {
          const result = await env.DB.prepare(
            "SELECT * FROM orders WHERE status = ? ORDER BY id DESC"
          ).bind("pending").all();

          return json({
            ok: true,
            orders: result.results || [],
          });
        } catch (error) {
          console.error("Orders query failed:", error);

          return json({
            ok: false,
            error: "Could not load orders",
          }, 500);
        }
      }

      const match = url.pathname.match(
        /^\/api\/bot\/orders\/([^/]+)\/status$/
      );

      if (match && method === "POST") {
        if (!isBotAuthorized(request, env)) {
          return json({ ok: false, error: "Unauthorized" }, 401);
        }

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
          ).bind(
            body.status,
            decodeURIComponent(match[1])
          ).run();

          if (!result.meta?.changes) {
            return json({
              ok: false,
              error: "Order not found",
            }, 404);
          }

          return json({
            ok: true,
            status: body.status,
          });
        } catch (error) {
          console.error("Order status update failed:", error);
          
          return json({
            ok: false,
            error: "Could not update order status",
          }, 500);
        }
      }

      const paymentMatch = url.pathname.match(
        /^\/api\/payment-links\/([a-f0-9]{64})$/
      );

      if (paymentMatch && method === "GET") {
        try {
          const tokenHash = await sha256Hex(paymentMatch[1]);

          const order = await env.DB.prepare(`
            SELECT id, order_id, discord_username, item_name,
                   quantity, unit_price_toman, amount_toman,
                   status, created_at, expires_at
            FROM payment_links
            WHERE token_hash = ?
            LIMIT 1
          `).bind(tokenHash).first();

          if (!order) {
            return json({
              ok: false,
              error: "Link not found",
            }, 404);
          }

          if (
            order.status !== "pending" ||
            !order.expires_at ||
            Date.parse(order.expires_at) <= Date.now()
          ) {
            return json({
              ok: false,
              expired: true,
              error: "Link expired",
            }, 410);
          }

          return json({
            ok: true,
            order,
          });
        } catch (error) {
          console.error("Payment link lookup failed:", error);

          return json({
            ok: false,
            error: "Database query failed",
          }, 500);
        }
      }

      const payMatch = url.pathname.match(
  /^\/pay\/([a-f0-9]{64})\/?$/i
);

      if (payMatch && method === "GET") {
        if (!env.ASSETS) {
          return json({
            ok: false,
            error: "Assets binding is missing",
          }, 500);
        }

        const assetUrl = new URL("/index.html", request.url);
        return env.ASSETS.fetch(
          new Request(assetUrl.toString(), request)
        );
      }

      if (url.pathname.startsWith("/api/")) {
        return json({
          ok: false,
          error: "API endpoint not found",
        }, 404);
      }

      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return json({
        ok: false,
        error: "Not found",
      }, 404);
    } catch (error) {
      console.error("Worker error:", error);

      return json({
        ok: false,
        error: "Internal server error",
      }, 500);
    }
  },
};
