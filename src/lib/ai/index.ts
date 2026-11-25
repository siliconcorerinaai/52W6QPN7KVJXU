import { config } from "@/lib/config";
import type { Intelligence } from "./intelligence";
import { LlmIntelligence } from "./llm-intelligence";
import { DemoIntelligence } from "./demo-intelligence";

let llm: LlmIntelligence | undefined;
let demo: DemoIntelligence | undefined;

export function intelligence(): Intelligence {
  if (config.demoMode) return (demo ??= new DemoIntelligence());
  return (llm ??= new LlmIntelligence());
}

export type { Intelligence } from "./intelligence";
