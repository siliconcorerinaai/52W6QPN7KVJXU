/** Conversions du plan (rédigé en français) vers les filtres des bases de données B2B. */

const COUNTRIES: Record<string, string> = {
  france: "france", belgique: "belgium", belgium: "belgium", suisse: "switzerland", switzerland: "switzerland",
  luxembourg: "luxembourg", monaco: "monaco", canada: "canada", quebec: "canada", "québec": "canada",
  allemagne: "germany", germany: "germany", espagne: "spain", spain: "spain", italie: "italy", italy: "italy",
  portugal: "portugal", "pays-bas": "netherlands", netherlands: "netherlands", "royaume-uni": "united kingdom",
  "united kingdom": "united kingdom", uk: "united kingdom", irlande: "ireland", ireland: "ireland",
  autriche: "austria", austria: "austria", suede: "sweden", "suède": "sweden", sweden: "sweden",
  norvege: "norway", "norvège": "norway", danemark: "denmark", finlande: "finland", pologne: "poland",
  "etats-unis": "united states", "états-unis": "united states", usa: "united states", "united states": "united states",
  maroc: "morocco", morocco: "morocco", algerie: "algeria", "algérie": "algeria", tunisie: "tunisia",
  senegal: "senegal", "sénégal": "senegal", "cote d'ivoire": "ivory coast", "côte d'ivoire": "ivory coast",
  cameroun: "cameroon", cameroon: "cameroon", gabon: "gabon", mali: "mali", "burkina faso": "burkina faso",
  benin: "benin", "bénin": "benin", togo: "togo", guinee: "guinea", "guinée": "guinea", niger: "niger",
  congo: "republic of the congo", rdc: "democratic republic of the congo", madagascar: "madagascar",
  nigeria: "nigeria", ghana: "ghana", kenya: "kenya", "afrique du sud": "south africa", egypte: "egypt", "égypte": "egypt",
  "emirats arabes unis": "united arab emirates", "émirats arabes unis": "united arab emirates", inde: "india", chine: "china",
  japon: "japan", bresil: "brazil", "brésil": "brazil", mexique: "mexico", australie: "australia",
};

/** Régions françaises courantes → pays (les bases filtrent au niveau du pays). */
const FR_REGIONS = /(île-de-france|ile-de-france|paris|lyon|marseille|bordeaux|toulouse|nantes|lille|rennes|grenoble|strasbourg|montpellier|nice|bretagne|normandie|occitanie|auvergne|provence|grand est|hauts-de-france|nouvelle-aquitaine|pays de la loire|centre-val de loire|bourgogne|corse)/i;

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Pays en anglais minuscule (format People Data Labs). */
export function toCountries(geographies: string[]): string[] {
  const out = new Set<string>();
  for (const g of geographies) {
    const raw = g.toLowerCase().trim();
    const hit = COUNTRIES[raw] ?? COUNTRIES[strip(raw)];
    if (hit) out.add(hit);
    else if (FR_REGIONS.test(raw)) out.add("france");
    else if (/europe/i.test(raw)) ["france", "belgium", "switzerland", "germany", "spain", "italy", "netherlands"].forEach((c) => out.add(c));
  }
  return [...out];
}

/** « united states » → « United States » (format Apollo). */
export const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

const BUCKETS: [number, number][] = [
  [1, 10], [11, 50], [51, 200], [201, 500], [501, 1000], [1001, 5000], [5001, 10000], [10001, Infinity],
];

/** Tranches d'effectif qui recoupent la taille décrite (« 10 à 50 salariés », « PME », « 200+ »…). */
export function employeeBuckets(sizeText: string): [number, number][] {
  const t = sizeText.toLowerCase();
  let [min, max] = [0, Infinity];
  const nums = (t.match(/\d[\d\s.]*/g) ?? []).map((n) => Number(n.replace(/[\s.]/g, ""))).filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length >= 2) [min, max] = [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])];
  else if (nums.length === 1) {
    if (/(\+|plus de|more than|au moins|>)/.test(t)) min = nums[0];
    else if (/(moins de|less than|<|jusqu)/.test(t)) max = nums[0];
    else [min, max] = [nums[0], nums[0]];
  } else if (/\bpme\b|sme|petite/.test(t)) [min, max] = [10, 250];
  else if (/\beti\b|mid-?market|moyenne/.test(t)) [min, max] = [250, 5000];
  else if (/grand(e)? (groupe|entreprise)|enterprise|large/.test(t)) [min, max] = [5000, Infinity];
  else if (/tpe|startup|start-up/.test(t)) [min, max] = [1, 50];
  if (min === 0 && max === Infinity) return [];
  return BUCKETS.filter(([a, b]) => a <= max && b >= Math.max(1, min));
}

/** Formats des tranches : Apollo « 11,50 », PDL « 11-50 » / « 10001+ ». */
export const apolloRange = ([a, b]: [number, number]) => `${a},${b === Infinity ? 1000000 : b}`;
export const pdlSize = ([a, b]: [number, number]) => (b === Infinity ? `${a}+` : `${a}-${b}`);

/** Mots-clés de recherche : mots-clés du plan, puis secteurs (dédoublonnés, au plus 10). */
export function searchKeywords(keywords: string[], industries: string[]): string[] {
  const seen = new Set<string>();
  return [...keywords, ...industries]
    .map((k) => k.trim())
    .filter((k) => k.length > 2 && !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()))
    .slice(0, 10);
}
