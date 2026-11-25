import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`https://app.example${path}`, { method: init.method ?? "GET", headers: { host: "app.example", ...init.headers } });
const withSession = { cookie: "ciblora_session=jeton" };

describe("accès par compte", () => {
  it("laisse publiques l'accueil, la connexion, l'inscription, la santé, la désinscription et le cron", () => {
    for (const path of ["/", "/login", "/signup", "/api/auth/login", "/api/health", "/api/unsubscribe?c=1&t=2", "/api/cron/tick"]) {
      expect(proxy(req(path)).status, path).toBe(200);
    }
  });

  it("redirige les pages vers la connexion et refuse l'API sans session", () => {
    const page = proxy(req("/campaigns/abc?tab=leads"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("https://app.example/login?next=%2Fcampaigns%2Fabc%3Ftab%3Dleads");
    expect(proxy(req("/api/campaigns")).status).toBe(401);
    expect(proxy(req("/admin")).status).toBe(307);
  });

  it("laisse passer une requête avec cookie de session et transmet le chemin", () => {
    const res = proxy(req("/settings", { headers: withSession }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-request-x-pathname")).toBe("/settings");
  });

  it("refuse les modifications venant d'un autre site", () => {
    expect(proxy(req("/api/campaigns", { method: "POST", headers: { ...withSession, origin: "https://evil.example" } })).status).toBe(403);
    expect(proxy(req("/api/auth/login", { method: "POST", headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect(proxy(req("/api/campaigns", { method: "POST", headers: { ...withSession, origin: "https://app.example" } })).status).toBe(200);
    // Désinscription en un clic (RFC 8058) : appelée par les messageries, d'une autre origine
    expect(proxy(req("/api/unsubscribe?c=1&t=2", { method: "POST", headers: { origin: "https://mail.example" } })).status).toBe(200);
  });
});
