import { cache } from "react";
import { cookies } from "next/headers";
import { AuthError, SESSION_COOKIE, userFromSessionToken, type SessionUser } from "@/lib/auth";

/** Utilisateur connecté pour la requête en cours (une seule lecture en base par requête). */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  try {
    const jar = await cookies();
    return await userFromSessionToken(jar.get(SESSION_COOKIE)?.value);
  } catch {
    return null; // hors requête HTTP (worker, scripts)
  }
});

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new AuthError("Connexion requise.", 401);
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new AuthError("Réservé à l'administrateur.", 403);
  return user;
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}
