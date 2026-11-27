/**
 * Vidéo offerte : réglages du clip, job OpenRouter (soumission, suivi, téléchargement) simulé,
 * diffusion avec requêtes partielles, échec, et attente de la vidéo avant la rédaction du premier email.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Job } from "@/lib/db/schema";

// La rédaction utilise l'IA de démonstration ; seule l'API vidéo est « réelle » (et simulée ci-dessous).
vi.mock("@/lib/ai", async () => {
  const { DemoIntelligence } = await import("@/lib/ai/demo-intelligence");
  const demo = new DemoIntelligence();
  return { intelligence: () => demo };
});

const C = "camp-video";
const MP4 = Buffer.from("....ftypisom-fake-mp4-bytes-0123456789");

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let jobStatus: Record<string, unknown> = { status: "in_progress" };

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  calls.push({ url, init });
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  if (url.endsWith("/videos/models")) {
    return json({
      data: [
        {
          id: "x-ai/grok-imagine-video-1.5-lite",
          supported_durations: [1, 2, 3, 4, 5, 6, 8, 10],
          supported_resolutions: ["480p", "720p", "1080p"],
          supported_aspect_ratios: ["16:9", "9:16", "1:1"],
          supported_frame_images: ["first_frame", "last_frame"],
        },
      ],
    });
  }
  if (url.endsWith("/videos") && init?.method === "POST") return json({ id: `job-${calls.length}`, status: "pending" }, 202);
  if (/\/videos\/[^/]+\/content/.test(url)) return Promise.resolve(new Response(new Uint8Array(MP4), { headers: { "content-type": "video/mp4" } }));
  if (/\/videos\/[^/?]+$/.test(url)) return json({ id: url.split("/").pop(), ...jobStatus });
  return Promise.resolve(new Response("not found", { status: 404 }));
}

async function addSample(id: string, companyId: string) {
  const { getDb } = await import("@/lib/db");
  const { companies, samples } = await import("@/lib/db/schema");
  const db = await getDb();
  await db.insert(companies).values({ id: companyId, campaignId: C, domain: `${companyId}.example`, name: `Bakery ${companyId}`, status: "qualified", language: "en" });
  const [s] = await db.insert(samples).values({ id, campaignId: C, companyId, status: "ready", mime: "image/jpeg", data: Buffer.from("jpeg") }).returning();
  return s;
}

async function campaign() {
  const { getCampaign } = await import("@/lib/pipeline/campaigns");
  return (await getCampaign(C))!;
}

async function videoJob(sampleId: string): Promise<Job> {
  const { getDb } = await import("@/lib/db");
  const { jobs } = await import("@/lib/db/schema");
  const rows = await (await getDb()).select().from(jobs).where(eq(jobs.type, "sample.video"));
  const job = rows.find((j) => j.payload.sampleId === sampleId)!;
  await (await getDb()).update(jobs).set({ status: "running" }).where(eq(jobs.id, job.id));
  return { ...job, status: "running" };
}

beforeAll(async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.APP_URL = "https://tryciblora.com";
  process.env.DEMO_MODE = "false";
  const { getDb } = await import("@/lib/db");
  const { campaigns } = await import("@/lib/db/schema");
  await (await getDb()).insert(campaigns).values({
    id: C,
    name: "Boulangeries Austin",
    prompt: "test",
    status: "running",
    plan: { summary: "", industries: [], geographies: ["United States"], companySize: "", keywords: [], personas: [], signals: [], exclusions: [], searchQueries: ["x"], qualificationCriteria: [] },
    offer: { senderCompany: "Ciblora Studio", senderName: "Franck", product: "Visuels", valueProposition: "", callToAction: "un échange", bookingUrl: "", tone: "", language: "auto" },
    settings: { targetCompanies: 3, contactsPerCompany: 1, minScore: 50, autoWrite: false, deepResearch: false, sequenceSteps: 1, followUpDays: 3, seedDomains: [], webhookUrl: "", visualSample: true, visualVideo: true },
  });
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(() => {
  calls = [];
});

describe("réglages du clip", () => {
  it("choisit 5 s, carré et 720p quand le modèle les accepte, sinon ce qu'il propose", async () => {
    const { clipSettings } = await import("@/lib/ai/video-api");
    expect(clipSettings({ id: "m", supported_durations: [4, 5, 8], supported_resolutions: ["480p", "720p"], supported_aspect_ratios: ["16:9", "1:1"], supported_frame_images: ["first_frame"] })).toEqual({
      duration: 5,
      aspect_ratio: "1:1",
      resolution: "720p",
    });
    expect(clipSettings({ id: "veo", supported_durations: [8, 4, 6], supported_resolutions: ["1080p", "720p"], supported_aspect_ratios: ["16:9", "9:16"], supported_frame_images: ["first_frame"] })).toEqual({
      duration: 6,
      aspect_ratio: "9:16",
      resolution: "720p",
    });
  });

  it("décide si la rédaction attend la vidéo", async () => {
    const { videoGate } = await import("@/lib/videos");
    const now = Date.now();
    const at = (minAgo: number) => new Date(now - minAgo * 60_000);
    expect(videoGate(null, now)).toBe("start");
    expect(videoGate({ status: "pending", error: null, startedAt: at(3), updatedAt: at(3) }, now)).toBe("wait");
    expect(videoGate({ status: "pending", error: null, startedAt: at(30), updatedAt: at(30) }, now)).toBe("skip");
    expect(videoGate({ status: "ready", error: null, startedAt: at(5), updatedAt: at(1) }, now)).toBe("ready");
    expect(videoGate({ status: "failed", error: "x", startedAt: at(5), updatedAt: at(1) }, now)).toBe("skip");
  });
});

describe("accès public", () => {
  it("la page, l'image et la vidéo d'un visuel s'ouvrent sans compte (lien dans l'email du prospect)", async () => {
    const { isPublicPath } = await import("@/lib/session-cookie");
    expect(isPublicPath("/v/smp-video-ok-0001")).toBe(true);
    expect(isPublicPath("/v/smp-video-ok-0001/image")).toBe(true);
    expect(isPublicPath("/v/smp-video-ok-0001/video")).toBe(true);
    expect(isPublicPath("/v/smp-video-ok-0001/autre")).toBe(false);
    expect(isPublicPath("/campaigns/x")).toBe(false);
  });
});

describe("génération de la vidéo", () => {
  it("anime le visuel : job soumis, suivi, puis clip enregistré et servi", async () => {
    const { startSampleVideo, pollSampleVideo, videoOf } = await import("@/lib/videos");
    const sample = await addSample("smp-video-ok-0001", "co-v1");
    expect(await startSampleVideo(sample, await campaign(), { name: "Bakery co-v1" })).toBe("started");

    const submit = calls.find((c) => c.init?.method === "POST")!;
    const body = JSON.parse(String(submit.init!.body));
    expect(body).toMatchObject({
      model: "x-ai/grok-imagine-video-1.5-lite",
      duration: 5,
      aspect_ratio: "1:1",
      resolution: "720p",
      generate_audio: false,
      frame_images: [{ type: "image_url", image_url: { url: "https://tryciblora.com/v/smp-video-ok-0001/image" }, frame_type: "first_frame" }],
    });
    // Une seule vidéo par visuel
    expect(await startSampleVideo(sample, await campaign(), { name: "Bakery co-v1" })).toBe("exists");

    // En cours : le job repasse plus tard, sans être perdu
    const job = await videoJob(sample.id);
    jobStatus = { status: "in_progress" };
    await pollSampleVideo(job);
    const { getDb } = await import("@/lib/db");
    const { jobs, aiUsage } = await import("@/lib/db/schema");
    const [again] = await (await getDb()).select().from(jobs).where(eq(jobs.id, job.id));
    expect(again.status).toBe("queued");
    expect(again.runAt.getTime()).toBeGreaterThan(Date.now());

    // Terminé : téléchargé avec la clé (même domaine qu'OpenRouter), enregistré, coût compté
    jobStatus = { status: "completed", unsigned_urls: ["https://openrouter.ai/api/v1/videos/job-x/content?index=0"], usage: { cost: 0.16 } };
    await pollSampleVideo({ ...again, status: "running" });
    const download = calls.find((c) => c.url.includes("/content"))!;
    expect((download.init?.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect((await videoOf(sample.id))?.status).toBe("ready");
    const usage = await (await getDb()).select().from(aiUsage).where(and(eq(aiUsage.campaignId, C), eq(aiUsage.operation, "visual.video")));
    expect(usage[0].costUsd).toBeCloseTo(0.16);

    // Diffusion : fichier entier, puis requêtes partielles (Safari / iOS)
    const { GET } = await import("@/app/v/[id]/video/route");
    const params = { params: Promise.resolve({ id: sample.id }) };
    const full = await GET(new Request("https://tryciblora.com/v/x/video"), params);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/mp4");
    expect(full.headers.get("cache-control")).toMatch(/^private/);
    expect(Buffer.from(await full.arrayBuffer()).equals(MP4)).toBe(true);
    const part = await GET(new Request("https://tryciblora.com/v/x/video", { headers: { range: "bytes=0-9" } }), params);
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-9/${MP4.length}`);
    expect((await part.arrayBuffer()).byteLength).toBe(10);
    const tail = await GET(new Request("https://tryciblora.com/v/x/video", { headers: { range: "bytes=-5" } }), params);
    expect(Buffer.from(await tail.arrayBuffer()).equals(MP4.subarray(-5))).toBe(true);
    const bad = await GET(new Request("https://tryciblora.com/v/x/video", { headers: { range: `bytes=${MP4.length + 10}-` } }), params);
    expect(bad.status).toBe(416);
    const none = await GET(new Request("https://tryciblora.com/v/x/video"), { params: Promise.resolve({ id: "inconnu-0000000" }) });
    expect(none.status).toBe(404);
  });

  it("abandonne proprement si la génération échoue", async () => {
    const { startSampleVideo, pollSampleVideo, videoOf, videoGate } = await import("@/lib/videos");
    const sample = await addSample("smp-video-ko-0002", "co-v2");
    await startSampleVideo(sample, await campaign(), { name: "Bakery co-v2" });
    jobStatus = { status: "failed", error: "content policy" };
    await pollSampleVideo(await videoJob(sample.id));
    const v = await videoOf(sample.id);
    expect(v).toMatchObject({ status: "failed", error: "content policy" });
    expect(videoGate(v)).toBe("skip");
    // Pas de nouvel essai immédiat (crédits)
    expect(await startSampleVideo(sample, await campaign(), { name: "Bakery co-v2" })).toBe("failed");
  });
});

describe("rédaction du premier email", () => {
  it("attend la vidéo, puis la cite une fois prête", async () => {
    const { getDb } = await import("@/lib/db");
    const { contacts, messages, jobs, sampleVideos } = await import("@/lib/db/schema");
    const { runJob } = await import("@/lib/pipeline/handlers");
    const db = await getDb();
    const sample = await addSample("smp-video-wr-0003", "co-v3");
    await db.insert(contacts).values({ id: "ct-v3", campaignId: C, companyId: "co-v3", fullName: "Mia Baker", email: "mia@co-v3.example", emailStatus: "valid", status: "ready" });
    const { enqueue } = await import("@/lib/jobs/queue");
    const id = await enqueue("contact.write", { contactId: "ct-v3" }, { campaignId: C });
    const write = async () => {
      await db.update(jobs).set({ status: "running" }).where(eq(jobs.id, id));
      const [j] = await db.select().from(jobs).where(eq(jobs.id, id));
      await runJob(j);
      return (await db.select().from(jobs).where(eq(jobs.id, id)))[0];
    };

    // 1) Pas encore de vidéo : elle est lancée, la rédaction attend
    let j = await write();
    expect(j.status).toBe("queued");
    expect(await db.select().from(messages).where(eq(messages.contactId, "ct-v3"))).toHaveLength(0);
    expect((await db.select().from(sampleVideos).where(eq(sampleVideos.sampleId, sample.id)))[0].status).toBe("pending");

    // 2) Toujours en cours : on attend encore
    j = await write();
    expect(j.status).toBe("queued");

    // 3) Prête : l'email est rédigé et cite la vidéo, avec le lien de la page
    await db.update(sampleVideos).set({ status: "ready", mime: "video/mp4", data: MP4 }).where(eq(sampleVideos.sampleId, sample.id));
    await write();
    const [first] = await db.select().from(messages).where(and(eq(messages.contactId, "ct-v3"), eq(messages.step, 1)));
    expect(first.body).toContain("https://tryciblora.com/v/smp-video-wr-0003");
    expect(first.body).toMatch(/vidéo/);
  });
});
