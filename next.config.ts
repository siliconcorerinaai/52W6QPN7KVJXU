import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pas d'en-tête « X-Powered-By » : l'application ne révèle pas sa technologie.
  poweredByHeader: false,
  // PGlite charge ses fichiers WASM depuis node_modules : on ne le bundle pas.
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "nodemailer", "imapflow"],
  // Les migrations SQL sont lues au démarrage : on les embarque dans le build serverless.
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*"] },
};

export default nextConfig;
