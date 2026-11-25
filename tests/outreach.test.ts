import { describe, expect, it } from "vitest";
import { nextSendSlot, unsubscribeToken, verifyUnsubscribeToken } from "@/lib/outreach/mailer";
import { toCsv } from "@/lib/pipeline/export";

describe("créneaux d'envoi", () => {
  const at = (s: string) => new Date(s);
  it("garde l'heure si on est dans la fenêtre (mardi 10h)", () => {
    const d = at("2026-11-24T10:00:00");
    expect(nextSendSlot(d).getTime()).toBe(d.getTime());
  });
  it("reporte au lundi 8h depuis un vendredi soir ou un samedi", () => {
    for (const s of ["2026-11-27T19:00:00", "2026-11-28T11:00:00", "2026-11-29T23:00:00"]) {
      const r = nextSendSlot(at(s));
      expect(r.getDay()).toBe(1);
      expect(r.getHours()).toBe(8);
      expect(r > at(s)).toBe(true);
    }
  });
  it("reporte à 8h le jour même si trop tôt", () => {
    const r = nextSendSlot(at("2026-11-24T06:30:00"));
    expect(r.getDate()).toBe(24);
    expect(r.getHours()).toBe(8);
  });
});

describe("désinscription", () => {
  it("signe et vérifie les jetons", () => {
    const t = unsubscribeToken("contact-123");
    expect(verifyUnsubscribeToken("contact-123", t)).toBe(true);
    expect(verifyUnsubscribeToken("contact-124", t)).toBe(false);
    expect(verifyUnsubscribeToken("contact-123", "faux")).toBe(false);
  });
});

describe("CSV", () => {
  it("échappe virgules, guillemets et retours à la ligne", () => {
    const csv = toCsv(["a", "b"], [["x,y", 'il dit "oui"'], [["l1", "l2"], null]]);
    expect(csv).toBe('﻿a,b\n"x,y","il dit ""oui"""\nl1 | l2,');
  });
});
