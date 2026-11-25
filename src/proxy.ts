import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath, SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * Accès par compte : sans cookie de session, les pages redirigent vers /login et l'API répond 401.
 * La validité de la session est vérifiée en base par chaque page et route (src/lib/session.ts).
 * Les requêtes qui modifient des données doivent venir du site lui-même (protection CSRF, en plus
 * du cookie SameSite=Lax). Le chemin demandé est transmis au layout (x-pathname).
 */
const CROSS_ORIGIN_OK = [/^\/api\/unsubscribe(\/|$)/, /^\/api\/cron\//];

function forward(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const writes = !["GET", "HEAD", "OPTIONS"].includes(request.method);

  if (writes && pathname.startsWith("/api/") && !CROSS_ORIGIN_OK.some((re) => re.test(pathname))) {
    const origin = request.headers.get("origin");
    if (origin) {
      let sameHost = false;
      try {
        sameHost = new URL(origin).host === (request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
      } catch {
        /* origine invalide */
      }
      if (!sameHost) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
    }
  }

  if (isPublicPath(pathname) || request.cookies.get(SESSION_COOKIE)?.value) return forward(request);
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
