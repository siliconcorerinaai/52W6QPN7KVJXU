import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import "./globals.css";
import { Sidebar, MobileNav } from "@/components/Sidebar";
import { RoleProvider } from "@/components/RoleContext";
import { config } from "@/lib/config";
import { BRAND } from "@/lib/brand";
import { currentUser } from "@/lib/session";
import { isPublicPath } from "@/lib/session-cookie";

export const metadata: Metadata = {
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description: BRAND.description,
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const path = (await headers()).get("x-pathname") ?? "/";

  // Page d'un visuel offert : vue par le prospect, jamais dans l'interface de l'application.
  if (/^\/v\//.test(path)) {
    return (
      <html lang="fr">
        <body>{children}</body>
      </html>
    );
  }

  // Visiteur : pages publiques seulement (accueil, connexion, inscription), sans l'interface de l'application.
  if (!user) {
    if (!isPublicPath(path)) redirect(`/login?next=${encodeURIComponent(path)}`);
    return (
      <html lang="fr">
        <body>{children}</body>
      </html>
    );
  }
  if (path === "/login" || path === "/signup") redirect("/");

  const admin = user.role === "admin";
  return (
    <html lang="fr">
      <body>
        <RoleProvider admin={admin}>
          <div className="flex min-h-screen">
            <Sidebar demo={config.demoMode} admin={admin} account={{ email: user.email, name: user.name }} />
            <div className="min-w-0 flex-1">
              <MobileNav admin={admin} />
              <main className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</main>
            </div>
          </div>
        </RoleProvider>
      </body>
    </html>
  );
}
