import { promises as dns } from "node:dns";
import net from "node:net";
import { config } from "@/lib/config";
import type { EmailStatus } from "@/lib/db/schema";
import { isRoleEmail } from "./patterns";
import { verifyWithProviders } from "./verifiers";

export type Verification = { status: EmailStatus; confidence: number; reason: string; mx?: string | null };

const SYNTAX = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const DISPOSABLE = new Set([
  "mailinator.com", "yopmail.com", "yopmail.fr", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "temp-mail.org", "trashmail.com", "getnada.com", "sharklasers.com", "dispostable.com", "maildrop.cc",
  "throwawaymail.com", "jetable.org", "mailnesia.com", "fakeinbox.com", "mohmal.com", "emailondeck.com",
]);

const FREE_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr", "live.com", "live.fr",
  "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "laposte.net",
  "gmx.com", "gmx.fr", "aol.com", "proton.me", "protonmail.com",
]);

export function isValidSyntax(email: string) {
  return SYNTAX.test(email) && email.length <= 254;
}

const mxCache = new Map<string, Promise<string | null>>();

/** Renvoie le serveur MX prioritaire du domaine (ou le domaine lui-même s'il a un enregistrement A), null sinon. */
export function resolveMx(domain: string): Promise<string | null> {
  if (!mxCache.has(domain)) {
    mxCache.set(
      domain,
      (async () => {
        try {
          const records = await dns.resolveMx(domain);
          const best = records.filter((r) => r.exchange).sort((a, b) => a.priority - b.priority)[0];
          if (best) return best.exchange;
        } catch {
          /* pas de MX */
        }
        try {
          const a = await dns.resolve4(domain);
          return a.length ? domain : null;
        } catch {
          return null;
        }
      })(),
    );
  }
  return mxCache.get(domain)!;
}

type SmtpProbe = "accepted" | "rejected" | "unknown";

/** Dialogue SMTP minimal (EHLO / MAIL FROM / RCPT TO), sans envoyer de message. */
export function smtpProbe(mx: string, rcpts: string[], timeoutMs = 12_000): Promise<SmtpProbe[]> {
  return new Promise((resolve) => {
    const results: SmtpProbe[] = rcpts.map(() => "unknown");
    const from = config.email.smtpVerifyFrom;
    const heloDomain = from.split("@")[1] ?? "example.com";
    const socket = net.createConnection({ host: mx, port: 25 });
    let buffer = "";
    let stage = 0; // 0 banner, 1 ehlo, 2 mail from, 3+ rcpt
    let rcptIndex = 0;
    const done = () => {
      try {
        socket.write("QUIT\r\n");
      } catch {
        /* ignore */
      }
      socket.destroy();
      resolve(results);
    };
    socket.setTimeout(timeoutMs, done);
    socket.on("error", done);
    socket.on("close", () => resolve(results));
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      // Une réponse est complète quand sa dernière ligne est "NNN " (sans tiret)
      const lines = buffer.split("\r\n").filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last || !/^\d{3} /.test(last) || !buffer.endsWith("\r\n")) return;
      buffer = "";
      const code = Number(last.slice(0, 3));
      if (stage === 0) {
        if (code !== 220) return done();
        stage = 1;
        socket.write(`EHLO ${heloDomain}\r\n`);
      } else if (stage === 1) {
        if (code !== 250) return done();
        stage = 2;
        socket.write(`MAIL FROM:<${from}>\r\n`);
      } else if (stage === 2) {
        if (code !== 250) return done();
        stage = 3;
        socket.write(`RCPT TO:<${rcpts[0]}>\r\n`);
      } else {
        results[rcptIndex] = code >= 200 && code < 300 ? "accepted" : code >= 500 ? "rejected" : "unknown";
        rcptIndex++;
        if (rcptIndex >= rcpts.length) return done();
        socket.write(`RCPT TO:<${rcpts[rcptIndex]}>\r\n`);
      }
    });
  });
}

const catchAllCache = new Map<string, Promise<boolean | null>>();

/** Le domaine accepte-t-il n'importe quelle adresse ? (null = indéterminé) */
export function detectCatchAll(domain: string): Promise<boolean | null> {
  if (!catchAllCache.has(domain)) {
    catchAllCache.set(
      domain,
      (async () => {
        const mx = await resolveMx(domain);
        if (!mx || !config.email.smtpVerify) return null;
        const random = `zz-${Math.random().toString(36).slice(2, 12)}@${domain}`;
        const [r] = await smtpProbe(mx, [random]);
        return r === "accepted" ? true : r === "rejected" ? false : null;
      })(),
    );
  }
  return catchAllCache.get(domain)!;
}

/**
 * Vérification d'une adresse : syntaxe → domaine jetable → MX → (optionnel) SMTP.
 * `prior` = confiance a priori (motif déduit du site, adresse publiée…).
 */
export async function verifyEmail(email: string, prior = 50): Promise<Verification> {
  const e = email.trim().toLowerCase();
  if (!isValidSyntax(e)) return { status: "invalid", confidence: 0, reason: "Syntaxe invalide" };
  const domain = e.split("@")[1];
  if (DISPOSABLE.has(domain)) return { status: "invalid", confidence: 0, reason: "Domaine jetable" };
  const mx = await resolveMx(domain);
  if (!mx) return { status: "invalid", confidence: 0, reason: "Aucun serveur mail (MX) pour ce domaine", mx: null };

  const role = isRoleEmail(e);
  const free = FREE_PROVIDERS.has(domain);

  // Services de vérification spécialisés (si configurés) : verdict prioritaire
  const verdict = await verifyWithProviders(e);
  if (verdict && verdict.status !== "unknown") {
    const confidence =
      verdict.status === "valid" ? (role ? 88 : 97) : verdict.status === "catch_all" ? Math.min(80, Math.max(prior, 60)) : 0;
    const label = { valid: "Boîte confirmée", invalid: "Adresse refusée", catch_all: "Domaine catch-all" }[verdict.status as "valid" | "invalid" | "catch_all"];
    // Le nom du service n'apparaît pas : ce texte est montré aux utilisateurs.
    return { status: verdict.status, confidence, reason: `${label} par un service de vérification`, mx };
  }

  if (config.email.smtpVerify && !free) {
    const catchAll = await detectCatchAll(domain);
    if (catchAll === true) {
      return { status: "catch_all", confidence: Math.min(80, prior), reason: "Domaine catch-all : accepte toute adresse", mx };
    }
    const [r] = await smtpProbe(mx, [e]);
    if (r === "accepted") return { status: "valid", confidence: role ? 85 : 95, reason: "Boîte confirmée par le serveur SMTP", mx };
    if (r === "rejected") return { status: "invalid", confidence: 0, reason: "Adresse refusée par le serveur SMTP", mx };
  }
  return {
    status: prior >= 85 ? "valid" : "risky",
    confidence: Math.min(prior, 90),
    reason: prior >= 85 ? "Adresse publiée, domaine joignable" : "Domaine joignable, adresse non confirmée (motif probable)",
    mx,
  };
}

export async function domainHasMx(domain: string): Promise<boolean> {
  return (await resolveMx(domain)) !== null;
}
