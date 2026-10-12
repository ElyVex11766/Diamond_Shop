
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        service: "Diamond Shop API",
      }, { headers });
    }

    if (url.pathname === "/api/order" && request.method === "GET") {
      return Response.json({
        ok: false,
        message: "Order lookup will be enabled after database setup.",
      }, { status: 503, headers });
    }

    return Response.json({
      ok: false,
      message: "Route not found",
    }, { status: 404, headers });
  },
};
