/** Nom du cookie de session (module léger, importable par le proxy). */
export const SESSION_COOKIE = "ciblora_session";

/** Chemins accessibles sans être connecté. */
export const PUBLIC_PATHS = [
  /^\/$/,
  /^\/login$/,
  /^\/signup$/,
  /^\/api\/auth\//,
  /^\/api\/health$/,
  /^\/api\/unsubscribe(\/|$)/,
  /^\/api\/cron\//,
  // Visuels offerts aux prospects (lien dans les emails).
  /^\/v\/[\w-]+(\/(image|video))?$/,
];

export const isPublicPath = (pathname: string) => PUBLIC_PATHS.some((re) => re.test(pathname));
