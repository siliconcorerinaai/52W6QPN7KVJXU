import { NextResponse, type NextRequest } from "next/server";

/**
 * Protection par mot de passe (HTTP Basic) dès que APP_PASSWORD est défini.
 * Restent publics : la sonde de santé, la désinscription (liens dans les emails)
 * et le cron (protégé par son propre secret).
 */
const PUBLIC_PATHS = [/^\/api\/health$/, /^\/api\/unsubscribe(\/|$)/, /^\/api\/cron\//];

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD?.trim();
  if (!password || PUBLIC_PATHS.some((re) => re.test(request.nextUrl.pathname))) return NextResponse.next();

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const sep = decoded.indexOf(":");
      const user = decoded.slice(0, sep);
      const pass = decoded.slice(sep + 1);
      const expectedUser = process.env.APP_USER?.trim();
      if (sep >= 0 && safeEqual(pass, password) && (!expectedUser || user === expectedUser)) return NextResponse.next();
    } catch {
      /* en-tête invalide */
    }
  }
  return new NextResponse("Authentification requise", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Prospecta", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
