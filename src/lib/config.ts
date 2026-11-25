/** Configuration centralisée, lue depuis les variables d'environnement. */
const env = (k: string, d = "") => (process.env[k] ?? d).trim();
const bool = (k: string, d = false) => {
  const v = env(k);
  return v ? ["1", "true", "yes", "on"].includes(v.toLowerCase()) : d;
};
const num = (k: string, d: number) => {
  const v = Number(env(k));
  return Number.isFinite(v) && env(k) !== "" ? v : d;
};

export type AiProvider = "anthropic" | "openrouter";

export const config = {
  get demoMode() {
    return bool("DEMO_MODE") || config.ai.provider === null;
  },
  ai: {
    /** Anthropic si sa clé est présente, sinon OpenRouter. AI_PROVIDER force le choix. */
    get provider(): AiProvider | null {
      const forced = env("AI_PROVIDER").toLowerCase();
      if (forced === "openrouter" && env("OPENROUTER_API_KEY")) return "openrouter";
      if (forced === "anthropic" && env("ANTHROPIC_API_KEY")) return "anthropic";
      if (env("ANTHROPIC_API_KEY")) return "anthropic";
      if (env("OPENROUTER_API_KEY")) return "openrouter";
      return null;
    },
    get model() {
      return config.ai.provider === "openrouter"
        ? env("OPENROUTER_MODEL", "anthropic/claude-opus-5.5")
        : env("AI_MODEL", "claude-opus-5-5");
    },
    get fastModel() {
      return config.ai.provider === "openrouter"
        ? env("OPENROUTER_MODEL_FAST") || config.ai.model
        : env("AI_MODEL_FAST") || config.ai.model;
    },
  },
  openrouter: {
    get apiKey() {
      return env("OPENROUTER_API_KEY");
    },
    get baseUrl() {
      return env("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").replace(/\/$/, "");
    },
  },
  search: {
    get serper() {
      return env("SERPER_API_KEY");
    },
    get brave() {
      return env("BRAVE_API_KEY");
    },
    get tavily() {
      return env("TAVILY_API_KEY");
    },
  },
  email: {
    get hunter() {
      return env("HUNTER_API_KEY");
    },
    get zerobounce() {
      return env("ZEROBOUNCE_API_KEY");
    },
    get neverbounce() {
      return env("NEVERBOUNCE_API_KEY");
    },
    get millionverifier() {
      return env("MILLIONVERIFIER_API_KEY");
    },
    get smtpVerify() {
      return bool("SMTP_VERIFY");
    },
    get smtpVerifyFrom() {
      return env("SMTP_VERIFY_FROM", "verify@example.com");
    },
  },
  data: {
    get apollo() {
      return env("APOLLO_API_KEY");
    },
    get pdl() {
      return env("PDL_API_KEY");
    },
  },
  imap: {
    get host() {
      return env("IMAP_HOST");
    },
    get port() {
      return num("IMAP_PORT", 993);
    },
    get secure() {
      return bool("IMAP_SECURE", true);
    },
    get user() {
      return env("IMAP_USER") || env("SMTP_USER");
    },
    get pass() {
      return env("IMAP_PASS") || env("SMTP_PASS");
    },
  },
  smtp: {
    get host() {
      return env("SMTP_HOST");
    },
    get port() {
      return num("SMTP_PORT", 587);
    },
    get secure() {
      return bool("SMTP_SECURE");
    },
    get user() {
      return env("SMTP_USER");
    },
    get pass() {
      return env("SMTP_PASS");
    },
    get senderName() {
      return env("SENDER_NAME");
    },
    get senderEmail() {
      return env("SENDER_EMAIL") || env("SMTP_USER");
    },
    get senderAddress() {
      return env("SENDER_ADDRESS");
    },
    get dailyLimit() {
      return num("DAILY_SEND_LIMIT", 40);
    },
    get configured() {
      return Boolean(env("SMTP_HOST") && (env("SENDER_EMAIL") || env("SMTP_USER")));
    },
  },
  get appUrl() {
    return env("APP_URL", "http://localhost:3000").replace(/\/$/, "");
  },
  worker: {
    get embedded() {
      return bool("EMBEDDED_WORKER", true);
    },
    get concurrency() {
      return Math.max(1, Math.min(32, num("WORKER_CONCURRENCY", 4)));
    },
  },
  get cronSecret() {
    return env("CRON_SECRET");
  },
  get encryptionSecret() {
    return env("ENCRYPTION_KEY") || env("UNSUBSCRIBE_SECRET") || env("CRON_SECRET") || "prospecta-dev-encryption";
  },
  get unsubscribeSecret() {
    return (
      env("UNSUBSCRIBE_SECRET") || env("CRON_SECRET") || env("ANTHROPIC_API_KEY") || env("OPENROUTER_API_KEY") || "prospecta-dev-secret"
    );
  },
};

/**
 * Hébergement serverless (Vercel, Lambda…) : pas de worker permanent ni de disque inscriptible.
 * Détection indépendante des variables système de Vercel, qui ne sont pas toujours exposées.
 */
export function isServerless(): boolean {
  if (process.env.SERVERLESS === "true") return true;
  if (process.env.SERVERLESS === "false") return false;
  return (
    Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT) ||
    process.cwd().startsWith("/var/task")
  );
}

export type ProviderStatus = { id: string; label: string; enabled: boolean; detail: string };

export function providerStatus(): ProviderStatus[] {
  const provider = config.demoMode ? null : config.ai.provider;
  const models = `Modèles : ${config.ai.model}${config.ai.fastModel !== config.ai.model ? ` / ${config.ai.fastModel}` : ""}`;
  return [
    {
      id: "anthropic",
      label: "Anthropic — Claude + recherche web native",
      enabled: provider === "anthropic",
      detail: provider === "anthropic" ? models : env("ANTHROPIC_API_KEY") ? "Clé présente (non utilisée)" : "ANTHROPIC_API_KEY",
    },
    {
      id: "openrouter",
      label: "OpenRouter — modèle au choix + recherche web",
      enabled: provider === "openrouter",
      detail:
        provider === "openrouter"
          ? models
          : env("OPENROUTER_API_KEY")
            ? "Clé présente — utilisée seulement sans clé Anthropic (ou AI_PROVIDER=openrouter)"
            : "OPENROUTER_API_KEY",
    },
    { id: "serper", label: "Serper (Google Search)", enabled: !!config.search.serper, detail: "SERPER_API_KEY" },
    { id: "brave", label: "Brave Search", enabled: !!config.search.brave, detail: "BRAVE_API_KEY" },
    { id: "tavily", label: "Tavily", enabled: !!config.search.tavily, detail: "TAVILY_API_KEY" },
    { id: "apollo", label: "Apollo.io (base B2B)", enabled: !!config.data.apollo, detail: "APOLLO_API_KEY — entreprises et décideurs" },
    { id: "pdl", label: "People Data Labs (base B2B)", enabled: !!config.data.pdl, detail: "PDL_API_KEY — entreprises et décideurs" },
    { id: "hunter", label: "Hunter.io (emails)", enabled: !!config.email.hunter, detail: "HUNTER_API_KEY" },
    { id: "zerobounce", label: "ZeroBounce (vérification)", enabled: !!config.email.zerobounce, detail: "ZEROBOUNCE_API_KEY" },
    { id: "neverbounce", label: "NeverBounce (vérification)", enabled: !!config.email.neverbounce, detail: "NEVERBOUNCE_API_KEY" },
    { id: "millionverifier", label: "MillionVerifier (vérification)", enabled: !!config.email.millionverifier, detail: "MILLIONVERIFIER_API_KEY" },
    {
      id: "smtp-verify",
      label: "Vérification SMTP",
      enabled: config.email.smtpVerify,
      detail: "SMTP_VERIFY=true (port 25 sortant requis)",
    },
    {
      id: "smtp",
      label: "Envoi SMTP",
      enabled: config.smtp.configured,
      detail: config.smtp.configured ? `${config.smtp.host} — ${config.smtp.dailyLimit}/jour` : "SMTP_HOST, SENDER_EMAIL…",
    },
  ];
}
