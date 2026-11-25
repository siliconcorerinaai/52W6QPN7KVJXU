import type { Metadata } from "next";
import "./globals.css";
import { Sidebar, MobileNav } from "@/components/Sidebar";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Prospecta — Agent de prospection IA",
  description: "Décrivez votre client idéal en une phrase : l'IA trouve les entreprises, les décideurs, leurs emails vérifiés et rédige des séquences personnalisées.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <div className="flex min-h-screen">
          <Sidebar demo={config.demoMode} />
          <div className="min-w-0 flex-1">
            <MobileNav />
            <main className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
