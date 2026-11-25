import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite charge ses fichiers WASM depuis node_modules : on ne le bundle pas.
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "nodemailer"],
  // Les migrations SQL sont lues au démarrage : on les embarque dans le build serverless.
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*"] },
};

export default nextConfig;
