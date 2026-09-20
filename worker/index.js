import { Container } from "@cloudflare/containers";

export class SlugfetchApi extends Container {
  defaultPort = 8080;
  sleepAfter = "15m";
  enableInternet = true;
  pingEndpoint = "/api/health";
  envVars = {
    SLUGFETCH_HOST: "0.0.0.0",
    SLUGFETCH_PORT: "8080",
    NODE_ENV: "production",
  };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, X-Request-Id, X-Account-Token",
  "Access-Control-Expose-Headers": "X-Request-Id",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api")) {
      return new Response("Not found", { status: 404 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const origin = env.SLUGFETCH_PUBLIC_URL || url.origin;

    try {
      const container = env.SLUGFETCH_API.getByName("api");
      await container.startAndWaitForPorts({
        startOptions: {
          envVars: {
            SLUGFETCH_HOST: "0.0.0.0",
            SLUGFETCH_PORT: "8080",
            SLUGFETCH_PUBLIC_URL: origin,
            SLUGFETCH_CURRENCY: env.SLUGFETCH_CURRENCY || "usd",
            STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY || "",
            STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET || "",
            NODE_ENV: "production",
          },
        },
      });
      return await container.fetch(request);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return new Response(
        JSON.stringify({
          ok: false,
          error: "the download engine is starting up or unavailable, try again shortly",
          detail: detail.slice(0, 300),
        }),
        { status: 503, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } }
      );
    }
  },
};
