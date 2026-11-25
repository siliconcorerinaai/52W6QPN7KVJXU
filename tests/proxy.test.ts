import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const req = (path: string, auth?: string) =>
  new NextRequest(`https://app.example${path}`, { headers: auth ? { authorization: auth } : {} });
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

describe("protection par mot de passe", () => {
  afterEach(() => {
    delete process.env.APP_PASSWORD;
    delete process.env.APP_USER;
  });

  it("laisse tout passer sans APP_PASSWORD (développement local)", () => {
    expect(proxy(req("/")).status).toBe(200);
  });

  it("exige le mot de passe sur les pages et l'API", () => {
    process.env.APP_PASSWORD = "s3cret";
    expect(proxy(req("/")).status).toBe(401);
    expect(proxy(req("/api/campaigns")).headers.get("www-authenticate")).toContain("Basic");
    expect(proxy(req("/", basic("admin", "faux"))).status).toBe(401);
    expect(proxy(req("/", basic("admin", "s3cret"))).status).toBe(200);
    expect(proxy(req("/", basic("n'importe", "s3cret"))).status).toBe(200);
  });

  it("vérifie l'utilisateur si APP_USER est défini", () => {
    process.env.APP_PASSWORD = "s3cret";
    process.env.APP_USER = "jean";
    expect(proxy(req("/", basic("admin", "s3cret"))).status).toBe(401);
    expect(proxy(req("/", basic("jean", "s3cret"))).status).toBe(200);
  });

  it("garde publiques la santé, la désinscription et le cron", () => {
    process.env.APP_PASSWORD = "s3cret";
    expect(proxy(req("/api/health")).status).toBe(200);
    expect(proxy(req("/api/unsubscribe?c=1&t=2")).status).toBe(200);
    expect(proxy(req("/api/cron/tick")).status).toBe(200);
    expect(proxy(req("/api/healthz")).status).toBe(401);
  });
});
