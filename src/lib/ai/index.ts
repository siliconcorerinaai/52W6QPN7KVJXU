import { config } from "@/lib/config";
import type { Intelligence } from "./intelligence";
import { ClaudeIntelligence } from "./claude-intelligence";
import { DemoIntelligence } from "./demo-intelligence";

let claude: ClaudeIntelligence | undefined;
let demo: DemoIntelligence | undefined;

export function intelligence(): Intelligence {
  if (config.demoMode) return (demo ??= new DemoIntelligence());
  return (claude ??= new ClaudeIntelligence());
}

export type { Intelligence } from "./intelligence";
