import type { Metadata } from "next";
import "./globals.css";
import { Sidebar, MobileNav } from "@/components/Sidebar";
import { RoleProvider } from "@/components/RoleContext";
import { config } from "@/lib/config";
import { isAdmin } from "@/lib/access";

export const metadata: Metadata = {
  title: "Prospecta — Agent de prospection IA",
  description: "Décrivez votre client idéal en une phrase : l'IA trouve les entreprises, les décideurs, leurs emails vérifiés et rédige des séquences personnalisées.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const admin = await isAdmin();
  return (
    <html lang="fr">
      <body>
        <RoleProvider admin={admin}>
          <div className="flex min-h-screen">
            <Sidebar demo={config.demoMode} admin={admin} />
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
