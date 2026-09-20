import { Container } from "@cloudflare/containers";

export class SlugfetchApi extends Container {
  defaultPort = 8080;
  sleepAfter = "15m";
  enableInternet = true;
  pingEndpoint = "/api/health";
  envVars = {
    SLUGFETCH_HOST: "0.0.0.0",
    SLUGFETCH_PORT: "8080",
    SLUGFETCH_PUBLIC_URL: "https://slugfetch.asdwwas233.workers.dev",
    NODE_ENV: "production",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api")) {
      return new Response("Not found", { status: 404 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Accept, X-Request-Id",
          "Access-Control-Expose-Headers": "X-Request-Id",
        },
      });
    }

    const container = env.SLUGFETCH_API.getByName("api");
    await container.startAndWaitForPorts({
      startOptions: {
        envVars: {
          SLUGFETCH_HOST: "0.0.0.0",
          SLUGFETCH_PORT: "8080",
          SLUGFETCH_PUBLIC_URL: env.SLUGFETCH_PUBLIC_URL || "https://slugfetch.asdwwas233.workers.dev",
          STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY || "",
          STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET || "",
          NODE_ENV: "production",
        },
      },
    });
    return container.fetch(request);
  },
};
