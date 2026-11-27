/**
 * API vidéo d'OpenRouter (asynchrone) : on soumet un job (POST /videos), on le suit (GET /videos/{id}),
 * puis on télécharge le clip (GET /videos/{id}/content). Ici : image vers vidéo, le visuel offert
 * servant de première image (`frame_images` → `first_frame`).
 */
import { config } from "@/lib/config";

export type VideoModelInfo = {
  id: string;
  supported_durations: number[] | null;
  supported_resolutions: string[] | null;
  supported_aspect_ratios: string[] | null;
  supported_frame_images: string[] | null;
};

export type VideoJob = {
  id: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired";
  error?: string | null;
  unsigned_urls?: string[];
  usage?: { cost?: number };
};

export const TERMINAL = new Set(["completed", "failed", "cancelled", "expired"]);

const headers = () => ({
  Authorization: `Bearer ${config.openrouter.apiKey}`,
  "Content-Type": "application/json",
  "HTTP-Referer": config.appUrl,
  "X-Title": "Ciblora",
});

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${config.openrouter.baseUrl}${path}`, { ...init, headers: headers(), signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenRouter vidéo ${res.status} : ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

let modelsCache: { at: number; models: VideoModelInfo[] } | null = null;

/** Capacités des modèles vidéo (durées, résolutions, formats), gardées une heure. */
export async function videoModels(): Promise<VideoModelInfo[]> {
  if (modelsCache && Date.now() - modelsCache.at < 3_600_000) return modelsCache.models;
  const json = await call<{ data: VideoModelInfo[] }>("/videos/models");
  modelsCache = { at: Date.now(), models: json.data };
  return json.data;
}

const pick = <T>(supported: T[] | null | undefined, wanted: T[]): T | undefined =>
  supported?.length ? wanted.find((w) => supported.includes(w)) ?? supported[0] : wanted[0];

/** Réglages du clip selon ce que le modèle accepte : 5 s, carré (comme le visuel), 720p. */
export function clipSettings(info: VideoModelInfo | undefined) {
  const durations = info?.supported_durations?.filter((d) => d > 0);
  return {
    duration: pick(durations, [5, 6, 4, 8]),
    aspect_ratio: pick(info?.supported_aspect_ratios, ["1:1", "4:3", "3:4", "9:16", "16:9"]),
    resolution: pick(info?.supported_resolutions, ["720p", "768p", "480p", "1080p"]),
  };
}

/** Consigne d'animation : du mouvement, sans toucher au produit ni au texte du visuel. */
export const MOTION_PROMPT =
  "Animate this promotional image into a short, premium social media clip. Slow cinematic camera push-in with gentle, " +
  "natural motion that fits the scene (soft light shimmer, steam, subtle particles, small product movement). " +
  "Keep the product, brand name, logo and every piece of text exactly as they are: do not add, remove or rewrite any text. " +
  "No people speaking, no cuts, no transitions. Smooth and polished, suitable for Instagram Reels and Stories.";

/** Soumet le job : le visuel (URL publique) devient la première image du clip. */
export async function submitImageToVideo(imageUrl: string, model = config.openrouter.videoModel): Promise<{ id: string; model: string }> {
  if (!config.openrouter.apiKey) throw new Error("Vidéo indisponible : clé OpenRouter manquante");
  const info = (await videoModels().catch(() => [])).find((m) => m.id === model);
  if (info?.supported_frame_images && !info.supported_frame_images.includes("first_frame")) {
    throw new Error(`Le modèle vidéo ${model} n'accepte pas d'image de départ`);
  }
  const job = await call<{ id: string }>("/videos", {
    method: "POST",
    body: JSON.stringify({
      model,
      prompt: MOTION_PROMPT,
      ...clipSettings(info),
      generate_audio: false,
      frame_images: [{ type: "image_url", image_url: { url: imageUrl }, frame_type: "first_frame" }],
    }),
  });
  if (!job?.id) throw new Error("OpenRouter vidéo : job sans identifiant");
  return { id: job.id, model };
}

export async function getVideoJob(id: string): Promise<VideoJob> {
  return call<VideoJob>(`/videos/${encodeURIComponent(id)}`);
}

/** Télécharge le clip terminé (MP4). */
export async function downloadVideo(job: VideoJob, maxBytes = 15 * 1024 * 1024): Promise<{ data: Buffer; mime: string }> {
  const url = job.unsigned_urls?.[0] ?? `${config.openrouter.baseUrl}/videos/${encodeURIComponent(job.id)}/content?index=0`;
  // Les adresses « unsigned » d'OpenRouter demandent la clé ; on ne l'envoie à aucun autre domaine.
  const sameHost = new URL(url).host === new URL(config.openrouter.baseUrl).host;
  const res = await fetch(url, { headers: sameHost ? { Authorization: `Bearer ${config.openrouter.apiKey}` } : {}, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Téléchargement de la vidéo impossible (${res.status})`);
  const mime = (res.headers.get("content-type") ?? "video/mp4").split(";")[0].trim();
  if (!mime.startsWith("video/")) throw new Error(`Contenu inattendu (${mime})`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > maxBytes) throw new Error(`Vidéo trop lourde (${Math.round(data.length / 1e6)} Mo)`);
  return { data, mime };
}
