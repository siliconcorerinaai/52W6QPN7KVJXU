/**
 * Comptes et sessions.
 * - Mots de passe : scrypt (sel aléatoire), comparaison à temps constant.
 * - Sessions : jeton aléatoire dans un cookie httpOnly ; la base ne stocke que son empreinte SHA-256.
 * - Le premier compte créé (ou une adresse listée dans ADMIN_EMAILS) devient administrateur.
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appState, sessions, users, type User } from "@/lib/db/schema";
import { newId } from "@/lib/util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

export { SESSION_COOKIE } from "./session-cookie";
import { SESSION_COOKIE } from "./session-cookie";
const SESSION_DAYS = 30;
const MAX_FAILED_LOGINS = 10;
const FAILED_WINDOW_MIN = 15;

/** Erreur d'accès (401 sans session, 403 sans droit) : traduite en réponse HTTP par handle(). */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 429 = 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export type SessionUser = Pick<User, "id" | "email" | "name" | "role" | "monthlyCompanyLimit">;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function validatePassword(password: string): string | null {
  if (password.length < 10) return "Le mot de passe doit contenir au moins 10 caractères.";
  if (password.length > 200) return "Le mot de passe est trop long.";
  return null;
}

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(/[\s,;]+/)
    .map(normalizeEmail)
    .filter(Boolean);
}

/** Limite mensuelle d'un nouveau compte (DEFAULT_MONTHLY_COMPANY_LIMIT, 50 par défaut ; modifiable par l'administrateur). */
function defaultMonthlyLimit(): number {
  const n = Number(process.env.DEFAULT_MONTHLY_COMPANY_LIMIT ?? 50);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 50;
}

/** Frein aux inscriptions en masse : au plus `max` comptes par heure depuis une même adresse IP. */
export async function checkSignupRate(ip: string | null, max = 5): Promise<void> {
  if (!ip) return;
  const db = await getDb();
  const key = `signup-ip:${ip}`;
  const [row] = await db.select().from(appState).where(eq(appState.key, key));
  const state = (row?.value ?? {}) as { count?: number; since?: number };
  const fresh = !state.since || Date.now() - state.since > 3_600_000;
  if (!fresh && (state.count ?? 0) >= max) throw new AuthError("Trop d'inscriptions depuis cette connexion. Réessayez plus tard.", 429);
  const value = fresh ? { count: 1, since: Date.now() } : { count: (state.count ?? 0) + 1, since: state.since };
  await db.insert(appState).values({ key, value }).onConflictDoUpdate({ target: appState.key, set: { value, updatedAt: new Date() } });
}

function publicUser(u: User): SessionUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role, monthlyCompanyLimit: u.monthlyCompanyLimit };
}

export async function createUser(input: { email: string; name?: string; password: string }): Promise<SessionUser> {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("Adresse email invalide.", 403);
  const problem = validatePassword(input.password);
  if (problem) throw new AuthError(problem, 403);
  const db = await getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) throw new AuthError("Un compte existe déjà avec cette adresse.", 403);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  const role = n === 0 || adminEmails().includes(email) ? "admin" : "user";
  const [row] = await db
    .insert(users)
    .values({
      id: newId(),
      email,
      name: (input.name ?? "").trim().slice(0, 120),
      passwordHash: await hashPassword(input.password),
      role,
      monthlyCompanyLimit: defaultMonthlyLimit(),
    })
    .returning();
  return publicUser(row);
}

/** Vérifie les identifiants, avec un frein après plusieurs échecs sur la même adresse. */
export async function authenticate(emailInput: string, password: string): Promise<SessionUser> {
  const email = normalizeEmail(emailInput);
  const db = await getDb();
  const key = `login-fail:${email}`;
  const [fails] = await db.select().from(appState).where(eq(appState.key, key));
  const state = (fails?.value ?? {}) as { count?: number; since?: number };
  const recent = state.since && Date.now() - state.since < FAILED_WINDOW_MIN * 60_000;
  if (recent && (state.count ?? 0) >= MAX_FAILED_LOGINS) {
    throw new AuthError("Trop de tentatives. Réessayez dans quelques minutes.", 429);
  }
  const [user] = await db.select().from(users).where(eq(users.email, email));
  // Même coût de calcul que le compte existe ou non (pas d'indice sur les adresses inscrites).
  const ok = user ? await verifyPassword(password, user.passwordHash) : (await hashPassword(password), false);
  if (!ok || !user) {
    const value = recent ? { count: (state.count ?? 0) + 1, since: state.since } : { count: 1, since: Date.now() };
    await db.insert(appState).values({ key, value }).onConflictDoUpdate({ target: appState.key, set: { value, updatedAt: new Date() } });
    throw new AuthError("Email ou mot de passe incorrect.", 401);
  }
  if (user.disabled) throw new AuthError("Ce compte est désactivé.", 403);
  if (fails) await db.delete(appState).where(eq(appState.key, key));
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return publicUser(user);
}

export async function createSession(userId: string, userAgent?: string | null): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const db = await getDb();
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt, userAgent: userAgent?.slice(0, 300) ?? null });
  return { token, expiresAt };
}

export async function userFromSessionToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const db = await getDb();
  const id = sha256(token);
  const [row] = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())));
  if (!row || row.user.disabled) return null;
  // Session glissante : prolongée quand elle a plus de la moitié de son âge.
  if (row.expiresAt.getTime() - Date.now() < (SESSION_DAYS / 2) * 86_400_000) {
    await db.update(sessions).set({ expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) }).where(eq(sessions.id, id));
  }
  return publicUser(row.user);
}

export async function deleteSession(token: string | undefined | null) {
  if (!token) return;
  const db = await getDb();
  await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

export async function deleteUserSessions(userId: string) {
  const db = await getDb();
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
