import { describe, expect, it } from "vitest";
import { publicEventData, publicStats } from "@/lib/access";

describe("données montrées aux utilisateurs", () => {
  it("retire les coûts des statistiques", () => {
    const out = publicStats({ companies: 3, sent: 1, costUsd: 0.42, webSearches: 7 });
    expect(out).toEqual({ companies: 3, sent: 1 });
  });

  it("retire les détails techniques des événements", () => {
    expect(publicEventData({ contactId: "c1", tech: { via: "fournisseur", error: "HTTP 500" } })).toEqual({ contactId: "c1" });
    expect(publicEventData(null)).toBeNull();
  });
});
