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
    get smtpVerify() {
      return bool("SMTP_VERIFY");
    },
    get smtpVerifyFrom() {
      return env("SMTP_VERIFY_FROM", "verify@example.com");
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
  get unsubscribeSecret() {
    return (
      env("UNSUBSCRIBE_SECRET") || env("CRON_SECRET") || env("ANTHROPIC_API_KEY") || env("OPENROUTER_API_KEY") || "prospecta-dev-secret"
    );
  },
};

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
    { id: "hunter", label: "Hunter.io (emails)", enabled: !!config.email.hunter, detail: "HUNTER_API_KEY" },
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
