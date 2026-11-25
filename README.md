# Prospecta — agent de prospection B2B propulsé par l'IA

Décrivez votre client idéal **en une phrase**. Prospecta s'occupe du reste :

1. **Plan de ciblage** : l'IA transforme votre phrase en ICP structuré (secteurs, zones, taille, décideurs, signaux d'achat, exclusions, requêtes de recherche), que vous pouvez ajuster.
2. **Découverte** : un agent fait de la recherche web en direct (au-delà de LinkedIn) pour trouver des entreprises réelles, par tours successifs et sous des angles variés, jusqu'à atteindre l'objectif.
3. **Qualification** : chaque site est exploré (accueil, à propos, équipe, contact, mentions légales, carrières). L'IA attribue une note d'adéquation de 0 à 100 avec ses raisons, détecte les signaux d'achat (recrutements, levées, expansion…) et les technologies utilisées.
4. **Décideurs** : identification des bons interlocuteurs selon vos personas (site, mentions légales, recherche web, profils LinkedIn publics indexés).
5. **Emails** : extraction des adresses publiées, déduction du format de l'entreprise (`prenom.nom@`, `pnom@`…), vérification (syntaxe, domaines jetables, MX, SMTP en option, détection catch-all) et score de confiance.
6. **Séquences personnalisées** : 1 à 5 emails par prospect, rédigés à partir de la recherche réelle (signal, actualité), dans la langue du prospect.
7. **Envoi maîtrisé** : validation humaine, SMTP, envoi les jours ouvrés de 8 h à 18 h, plafond quotidien, étalement, relances en fil, arrêt automatique en cas de réponse, désinscription en un clic, liste d'exclusion.
8. **Export** : CSV (compatible Excel) et webhook JSON (n8n, Make, Zapier, CRM).

Le tout est piloté par un **fil d'activité en direct**, avec un **entonnoir** (trouvées → qualifiées → décideurs → emails → contactés → réponses) et une **estimation du coût IA** par campagne.

> 💡 Sans clé IA (Anthropic ou OpenRouter), l'application démarre en **mode démo** : entreprises et personnes fictives (domaines en `.example`), aucun email réellement envoyé. Idéal pour découvrir l'interface.

---

## Démarrage rapide

Prérequis : Node.js 22 ou plus.

```bash
npm install
cp .env.example .env.local   # puis renseignez ANTHROPIC_API_KEY ou OPENROUTER_API_KEY
npm run dev                  # http://localhost:3000
```

Aucune base de données à installer : Prospecta embarque un PostgreSQL (PGlite) stocké dans `./data/pglite`. Les migrations s'appliquent au démarrage et le worker de tâches tourne dans le serveur.

En production : `npm run build && npm start`.

## Configuration

Toutes les options sont décrites dans [`.env.example`](.env.example). Les principales :

| Variable | Rôle |
| --- | --- |
| `ANTHROPIC_API_KEY` | Active l'agent réel avec Claude et sa recherche web côté serveur (multi-étapes). Prioritaire si présente. |
| `AI_MODEL` | Modèle principal (plan, découverte, rédaction). Par défaut `claude-opus-5-5`. |
| `AI_MODEL_FAST` | Modèle des tâches de masse (analyse de sites, classement des décideurs). Mettez `claude-haiku-5-5` pour réduire fortement les coûts. |
| `OPENROUTER_API_KEY` | Alternative : l'agent passe par OpenRouter (utilisé si aucune clé Anthropic, ou si `AI_PROVIDER=openrouter`). |
| `OPENROUTER_MODEL` / `OPENROUTER_MODEL_FAST` | Identifiants de modèles OpenRouter (par défaut `anthropic/claude-opus-5.5` ; vérifiez l'identifiant exact sur openrouter.ai/models). |
| `DATABASE_URL` | Postgres externe (Supabase, Neon, RDS…). Vide → PGlite embarqué. Les tables sont créées dans un schéma dédié `prospecta`. |
| `SERPER_API_KEY` / `BRAVE_API_KEY` / `TAVILY_API_KEY` | Moteur de recherche complémentaire (optionnel) : plus de résultats et moins de recherches facturées par Claude. |
| `HUNTER_API_KEY` | Format d'email et recherche d'adresses via Hunter.io (optionnel). |
| `SMTP_VERIFY` | Vérification des boîtes par dialogue SMTP (`RCPT TO`). Nécessite le port 25 sortant, souvent bloqué chez les hébergeurs cloud. |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SENDER_EMAIL`, `SENDER_NAME` | Envoi des emails. |
| `SENDER_ADDRESS` | Adresse postale affichée en pied d'email. |
| `DAILY_SEND_LIMIT` | Plafond d'envois par jour (40 par défaut). |
| `APP_URL` | URL publique, utilisée pour les liens de désinscription. |

Les appels à Claude activent le **repli côté serveur** (`fallbacks: "default"`) : si le modèle principal décline une requête, l'API la relance automatiquement sur un modèle de repli.

**Anthropic ou OpenRouter ?** Avec Anthropic, Claude enchaîne lui-même plusieurs recherches web et affine ses requêtes : c'est le mode le plus précis. Avec OpenRouter, chaque étape fait une recherche web (plugin `web`) dont les résultats sont fournis au modèle choisi : plus simple, un peu moins exhaustif. Les deux produisent des sorties JSON validées.

## Comment ça marche

```
« Agences web en France qui vendent du Shopify »
        │  /api/plan (Claude, sortie structurée)
        ▼
  Plan ICP éditable ──► Lancer
        │
        ▼                      file de tâches persistée (table jobs, SKIP LOCKED, reprises)
 campaign.discover ──► company.research ──► company.contacts ──► contact.email ──► contact.write
  (recherche web)      (exploration du site    (décideurs +       (format, MX,      (séquence
                        + score ICP)            signaux)           SMTP, catch-all)  personnalisée)
        ▲                                                                              │
        └──── campaign.supervise : relance la découverte jusqu'à l'objectif           ▼
                                                                    validation ──► message.send
                                                              (créneaux, plafond, relances, désinscription)
```

- **Agent de recherche** (`src/lib/ai/claude.ts`) : Claude utilise l'outil serveur `web_search`, puis rend ses résultats via un outil strict `submit_results` validé par Zod (gestion de `pause_turn`, correction automatique d'une sortie invalide, collecte des sources).
- **Sorties structurées** pour le plan, l'analyse d'entreprise, le classement des décideurs et la rédaction.
- **Tâches idempotentes et reprenables** : un redémarrage remet en file les tâches interrompues, les échecs sont retentés avec backoff exponentiel, et une campagne en pause ne consomme plus rien.

### Arborescence

```
src/
  app/                    pages (tableau de bord, nouvelle recherche, campagne, paramètres) + routes API
  components/             interface (fil d'activité, tableau des leads, fiche lead, éditeur de plan…)
  lib/
    ai/                   fournisseurs IA (Anthropic, OpenRouter), intelligence de démo, schémas, prompts
    db/                   schéma Drizzle + connexion PGlite / Postgres
    email/                formats d'email, vérification MX/SMTP, Hunter
    jobs/                 file de tâches et worker
    outreach/             envoi SMTP, désinscription, créneaux
    pipeline/             étapes de l'agent, services de campagne, exports
    scrape/               exploration des sites d'entreprise
    search/               Serper, Brave, Tavily
drizzle/                  migrations SQL
scripts/worker.ts         worker autonome
tests/                    tests unitaires + pipeline de bout en bout + faux serveurs Claude et OpenRouter
```

## Déploiement

### Railway + Supabase (recommandé)

Railway fait tourner l'application en continu : l'interface et le worker de l'agent vivent dans le même service. La configuration est fournie dans [`railway.json`](railway.json) (build, démarrage, sonde de santé `/api/health`).

1. **Supabase** : ouvrez votre projet → bouton **Connect** → copiez la chaîne **Session pooler** (compatible IPv4) et remplacez `[YOUR-PASSWORD]` par le mot de passe de la base. Les tables sont créées automatiquement au premier démarrage, dans le schéma `prospecta` (aucun conflit avec vos tables existantes, et non exposé par l'API REST publique de Supabase).
2. **Railway** : *New Project* → *Deploy from GitHub repo* → choisissez ce dépôt.
3. Dans **Variables**, ajoutez au minimum :
   - `DATABASE_URL` : la chaîne Supabase de l'étape 1 ;
   - `ANTHROPIC_API_KEY` **ou** `OPENROUTER_API_KEY` ;
   - `UNSUBSCRIBE_SECRET` : une longue chaîne aléatoire ;
   - `APP_PASSWORD` : le mot de passe d'accès à l'application (sans lui, elle est ouverte à quiconque connaît son adresse) ;
   - `APP_URL` : l'URL publique du service (après l'étape 4).
   Puis, pour envoyer des emails : `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SENDER_EMAIL`, `SENDER_NAME`, `SENDER_ADDRESS`.
4. **Settings → Networking → Generate Domain**, reportez l'URL dans `APP_URL`, puis redéployez.

Gardez une seule instance (le worker est embarqué ; plusieurs instances fonctionnent aussi grâce au verrouillage `SKIP LOCKED`, mais ne sont pas nécessaires).

### Autres hébergements

**Serveur classique (VPS, Docker, Render…)** :

```bash
DATABASE_URL=postgres://… npm run build && npm start
```

Pour séparer le web et le traitement : `EMBEDDED_WORKER=false` sur le serveur web, et `npm run worker` dans un second process (Postgres obligatoire dans ce cas).

### Vercel + Supabase

Sur Vercel il n'y a pas de processus permanent : la file de tâches avance après chaque requête de l'interface (tant qu'une page de campagne est ouverte) et grâce à un appel de `/api/cron/tick` chaque minute. Comme les crons Vercel à la minute exigent un plan Pro, le plus simple est de les confier à **Supabase** (`pg_cron` + `pg_net`) :

```sql
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select vault.create_secret('<CRON_SECRET>', 'prospecta_cron_secret');
select cron.schedule('prospecta-tick', '* * * * *', $$
  select net.http_get(
    url := 'https://<votre-app>.vercel.app/api/cron/tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'prospecta_cron_secret')),
    timeout_milliseconds := 10000
  );
$$);
```

Variables Vercel : `DATABASE_URL` (Supabase, **Transaction pooler**, port 6543), `APP_PASSWORD`, `CRON_SECRET`, `UNSUBSCRIBE_SECRET`, `APP_URL`, la clé IA, et les variables SMTP pour l'envoi.

## Coûts

Le coût IA estimé (tokens + recherches web) s'affiche pour chaque campagne et sur le tableau de bord. Pour le réduire :

- `AI_MODEL_FAST=claude-haiku-5-5` pour l'analyse de masse ;
- désactiver la « recherche approfondie » d'une campagne : l'agent se contente du site et de votre moteur de recherche quand ils suffisent à trouver les décideurs ;
- ajouter une clé Serper, Brave ou Tavily : la découverte interroge d'abord ce moteur, et la recherche web de Claude ne complète que si nécessaire ;
- relever le score minimum pour ne chercher des décideurs que dans les entreprises les mieux notées.

## Prospection responsable

Prospecta est conçu pour une prospection B2B ciblée et respectueuse. Il ne remplace pas un avis juridique ; vérifiez les règles applicables dans vos pays cibles (en France et dans l'UE : RGPD et recommandations de la CNIL sur la prospection B2B).

- Le message doit concerner la fonction professionnelle du destinataire ; identifiez-vous clairement et renseignez `SENDER_ADDRESS`.
- Chaque email contient un lien de désinscription en un clic (en-têtes `List-Unsubscribe`), qui alimente automatiquement la liste d'exclusion.
- Les relances s'arrêtent dès qu'un prospect répond ou se désinscrit.
- Envoyez depuis un domaine secondaire configuré (SPF, DKIM, DMARC) et respectez des volumes modestes (40 par jour par défaut).
- L'outil n'utilise que des informations publiques : sites des entreprises et résultats de moteurs de recherche. Il ne se connecte à aucun compte LinkedIn.

## Tests

```bash
npm test          # unitaires + pipeline complet en mode démo + fournisseurs IA simulés
npm run typecheck
```

Les tests des fournisseurs IA utilisent de faux serveurs (flux SSE pour Claude, JSON pour OpenRouter) : aucun appel réel, aucun coût.

## Pistes d'évolution

- Détection automatique des réponses (IMAP / Gmail / Outlook) et classification par l'IA.
- Rotation de plusieurs boîtes d'envoi et préchauffage.
- Synchronisation native avec HubSpot, Pipedrive et Salesforce.
- Enrichissement par des fournisseurs de données (registres d'entreprises, technographie).
- Comptes utilisateurs et espaces d'équipe.
