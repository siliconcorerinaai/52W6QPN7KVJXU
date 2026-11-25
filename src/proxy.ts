import { NextResponse, type NextRequest } from "next/server";

/**
 * Accès par mot de passe (HTTP Basic) :
 * - APP_PASSWORD : mot de passe des utilisateurs ;
 * - ADMIN_PASSWORD : mot de passe du propriétaire, seul à voir l'administration (fournisseurs, coûts,
 *   erreurs détaillées). Sans ADMIN_PASSWORD, APP_PASSWORD donne l'accès administrateur.
 * Sans aucun des deux (développement local), tout est ouvert en administrateur.
 * Restent publics : la sonde de santé, la désinscription (liens dans les emails) et le cron (protégé
 * par son propre secret). Le rôle est transmis à l'application dans un en-tête que le navigateur ne
 * peut pas imposer : il est toujours réécrit ici.
 */
const PUBLIC_PATHS = [/^\/api\/health$/, /^\/api\/unsubscribe(\/|$)/, /^\/api\/cron\//];
const ROLE_HEADER = "x-prospecta-role";

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function credentials(request: NextRequest): { user: string; pass: string } | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return null;
  try {
    const decoded = atob(header.slice(6));
    const sep = decoded.indexOf(":");
    return sep >= 0 ? { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) } : null;
  } catch {
    return null;
  }
}

/** Rôle correspondant aux identifiants, ou null s'ils sont absents ou faux. */
export function roleFor(request: NextRequest): "admin" | "user" | null {
  const appPass = process.env.APP_PASSWORD?.trim();
  const adminPass = process.env.ADMIN_PASSWORD?.trim();
  if (!appPass && !adminPass) return "admin";
  const c = credentials(request);
  if (!c) return null;
  const adminUser = process.env.ADMIN_USER?.trim();
  if (adminPass && safeEqual(c.pass, adminPass) && (!adminUser || c.user === adminUser)) return "admin";
  const appUser = process.env.APP_USER?.trim();
  if (appPass && safeEqual(c.pass, appPass) && (!appUser || c.user === appUser)) return adminPass ? "user" : "admin";
  return null;
}

function withRole(request: NextRequest, role: "admin" | "user") {
  const headers = new Headers(request.headers);
  headers.set(ROLE_HEADER, role);
  return NextResponse.next({ request: { headers } });
}

export function proxy(request: NextRequest) {
  if (PUBLIC_PATHS.some((re) => re.test(request.nextUrl.pathname))) return withRole(request, "user");
  const role = roleFor(request);
  if (role) return withRole(request, role);
  return new NextResponse("Authentification requise", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Prospecta", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
