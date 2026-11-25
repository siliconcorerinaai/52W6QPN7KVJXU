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

export const config = {
  get demoMode() {
    return bool("DEMO_MODE") || !env("ANTHROPIC_API_KEY");
  },
  ai: {
    get model() {
      return env("AI_MODEL", "claude-opus-5-5");
    },
    get fastModel() {
      return env("AI_MODEL_FAST") || env("AI_MODEL", "claude-opus-5-5");
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
    return env("UNSUBSCRIBE_SECRET") || env("CRON_SECRET") || env("ANTHROPIC_API_KEY") || "prospecta-dev-secret";
  },
};

export type ProviderStatus = { id: string; label: string; enabled: boolean; detail: string };

export function providerStatus(): ProviderStatus[] {
  return [
    {
      id: "claude",
      label: "Claude (IA + recherche web)",
      enabled: !config.demoMode,
      detail: config.demoMode ? "Mode démo — données simulées" : `Modèles : ${config.ai.model} / ${config.ai.fastModel}`,
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
