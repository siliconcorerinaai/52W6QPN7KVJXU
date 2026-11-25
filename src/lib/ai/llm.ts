/**
 * Point d'entrée unique des appels IA : route vers Anthropic (Claude, recherche web native)
 * ou vers OpenRouter selon la configuration (voir `config.ai.provider`).
 */
import { config } from "@/lib/config";
import * as anthropic from "./claude";
import * as openrouter from "./openrouter";

export type { AiContext } from "./usage";

const impl = () => (config.ai.provider === "openrouter" ? openrouter : anthropic);

export const structured: typeof anthropic.structured = (opts) => impl().structured(opts);
export const research: typeof anthropic.research = (opts) => impl().research(opts);
