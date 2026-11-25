/** Vérification d'emails et bases B2B contre de faux serveurs HTTP : aucun appel réel. */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Req = { method: string; url: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> | null };
const requests: Req[] = [];
const routes = new Map<string, (r: Req) => unknown>();
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const r: Req = { method: req.method!, url: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : null };
      requests.push(r);
      const path = req.url!.split("?")[0];
      const handler = routes.get(path);
      res.writeHead(handler ? 200 : 404, { "content-type": "application/json" }).end(JSON.stringify(handler ? handler(r) : {}));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    ZEROBOUNCE_BASE_URL: `${url}/zb`,
    NEVERBOUNCE_BASE_URL: `${url}/nb`,
    MILLIONVERIFIER_BASE_URL: `${url}/mv`,
    APOLLO_BASE_URL: `${url}/apollo`,
    PDL_BASE_URL: `${url}/pdl`,
  });
});
afterAll(() => server?.close());

describe("correspondance des statuts", () => {
  it("traduit les réponses de chaque service", async () => {
    const { mapZeroBounce, mapNeverBounce, mapMillionVerifier } = await import("@/lib/email/verifiers");
    expect(mapZeroBounce("valid", "")).toBe("valid");
    expect(mapZeroBounce("do_not_mail", "disposable")).toBe("invalid");
    expect(mapZeroBounce("catch-all", "")).toBe("catch_all");
    expect(mapNeverBounce("catchall")).toBe("catch_all");
    expect(mapNeverBounce("disposable")).toBe("invalid");
    expect(mapMillionVerifier("ok")).toBe("valid");
    expect(mapMillionVerifier("unknown")).toBe("unknown");
  });
});

describe("vérification en cascade", () => {
  it("passe au fournisseur suivant tant que le verdict n'est pas définitif", async () => {
    process.env.ZEROBOUNCE_API_KEY = "zb";
    process.env.NEVERBOUNCE_API_KEY = "nb";
    process.env.MILLIONVERIFIER_API_KEY = "mv";
    routes.set("/zb/validate", () => ({ address: "x", status: "catch-all", sub_status: "" }));
    routes.set("/nb/single/check", () => ({ status: "success", result: "unknown" }));
    routes.set("/mv/", () => ({ result: "ok", subresult: "ok" }));
    const { verifyWithProviders } = await import("@/lib/email/verifiers");
    const v = await verifyWithProviders("jean@acme.fr");
    expect(v).toMatchObject({ provider: "MillionVerifier", status: "valid" });
    const zb = requests.find((r) => r.url.startsWith("/zb/validate"))!;
    expect(zb.url).toContain("api_key=zb");
    expect(zb.url).toContain("email=jean%40acme.fr");
  });

  it("s'arrête au premier verdict définitif et garde le catch-all à défaut", async () => {
    routes.set("/zb/validate", () => ({ status: "invalid", sub_status: "mailbox_not_found" }));
    const { verifyWithProviders } = await import("@/lib/email/verifiers");
    const before = requests.length;
    expect(await verifyWithProviders("faux@acme.fr")).toMatchObject({ provider: "ZeroBounce", status: "invalid" });
    expect(requests.length - before).toBe(1);

    routes.set("/zb/validate", () => ({ status: "catch-all", sub_status: "" }));
    routes.set("/mv/", () => ({ result: "unknown" }));
    expect(await verifyWithProviders("x@acme.fr")).toMatchObject({ provider: "ZeroBounce", status: "catch_all" });
    delete process.env.ZEROBOUNCE_API_KEY;
    delete process.env.NEVERBOUNCE_API_KEY;
    delete process.env.MILLIONVERIFIER_API_KEY;
  });
});

describe("conversion du plan en filtres", () => {
  it("convertit pays, régions et tailles", async () => {
    const { toCountries, employeeBuckets, apolloRange, pdlSize, searchKeywords } = await import("@/lib/data/mapping");
    expect(toCountries(["France", "Belgique", "Île-de-France", "Côte d'Ivoire"])).toEqual(["france", "belgium", "ivory coast"]);
    expect(employeeBuckets("10 à 50 salariés").map(pdlSize)).toEqual(["1-10", "11-50"]);
    expect(employeeBuckets("plus de 1000 salariés").map(apolloRange)).toEqual(["501,1000", "1001,5000", "5001,10000", "10001,1000000"]);
    expect(employeeBuckets("PME").map(pdlSize)).toEqual(["1-10", "11-50", "51-200", "201-500"]);
    expect(employeeBuckets("toutes tailles")).toEqual([]);
    expect(searchKeywords(["Shopify", "shopify", "ab"], ["E-commerce"])).toEqual(["Shopify", "E-commerce"]);
  });
});

describe("bases de données B2B", () => {
  const plan = {
    summary: "Agences web",
    industries: ["Agences web"],
    geographies: ["France"],
    companySize: "11-50 salariés",
    keywords: ["Shopify"],
    personas: ["CEO", "Directeur commercial"],
    signals: [],
    exclusions: [],
    searchQueries: ["agences shopify"],
    qualificationCriteria: [],
  };

  it("interroge Apollo et People Data Labs et fusionne les entreprises", async () => {
    process.env.APOLLO_API_KEY = "ap";
    process.env.PDL_API_KEY = "pd";
    routes.set("/apollo/mixed_companies/search", () => ({
      organizations: [
        { name: "Acme Studio", primary_domain: "acme.fr", city: "Lyon", country: "France", estimated_num_employees: 25 },
        { name: "Déjà connue", primary_domain: "known.fr" },
      ],
    }));
    routes.set("/pdl/company/search", () => ({
      status: 200,
      data: [
        { name: "acme studio", website: "acme.fr" },
        { name: "beta web", website: "www.beta-web.fr", size: "11-50", industry: "internet", location: { name: "nantes, france" } },
      ],
    }));
    const { searchCompaniesInDatabases } = await import("@/lib/data/providers");
    const out = await searchCompaniesInDatabases(plan, 10, new Set(["known.fr"]), 0);
    expect(out.map((c) => c.domain)).toEqual(["acme.fr", "beta-web.fr"]);
    expect(out[1]).toMatchObject({ name: "Beta Web", provider: "pdl", employees: "11-50 salariés" });

    const apolloReq = requests.findLast((r) => r.url === "/apollo/mixed_companies/search")!;
    expect(apolloReq.headers["x-api-key"]).toBe("ap");
    expect(apolloReq.body).toMatchObject({ organization_locations: ["France"], organization_num_employees_ranges: ["11,50"], q_organization_keyword_tags: ["Shopify", "Agences web"] });
    const pdlReq = requests.findLast((r) => r.url === "/pdl/company/search")!;
    expect(JSON.stringify(pdlReq.body)).toContain('"location_country":["france"]');
  });

  it("ignore les noms masqués et les emails non débloqués", async () => {
    routes.set("/apollo/mixed_people/api_search", () => ({
      people: [
        { first_name: "Camille", last_name: "Martin", title: "CEO", linkedin_url: "https://linkedin.com/in/cm", email: "email_not_unlocked@domain.com" },
        { first_name: "Paul", last_name: "D***", title: "CTO" },
      ],
    }));
    routes.set("/pdl/person/search", () => ({
      status: 200,
      data: [
        { full_name: "sophie bernard", job_title: "directrice commerciale", work_email: "sophie.bernard@acme.fr" },
        { full_name: "camille martin", job_title: "ceo" },
      ],
    }));
    const { searchPeopleInDatabases } = await import("@/lib/data/providers");
    const people = await searchPeopleInDatabases("acme.fr", ["CEO"], 3);
    expect(people.map((p) => p.name)).toEqual(["Camille Martin", "Sophie Bernard"]);
    expect(people[0].email).toBeUndefined();
    expect(people[1].email).toBe("sophie.bernard@acme.fr");
    delete process.env.APOLLO_API_KEY;
    delete process.env.PDL_API_KEY;
  });
});
