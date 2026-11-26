/** Règles d'envoi : heures de bureau dans le fuseau des destinataires, pied d'email dans leur langue. */
import { describe, expect, it } from "vitest";
import { footerText, nextSendSlot, timeZoneFor } from "@/lib/outreach/mailer";

const hourIn = (d: Date, timeZone: string) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(d));
const dayIn = (d: Date, timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(d);

describe("fuseau des destinataires", () => {
  it("reconnaît les pays, en français comme en anglais", () => {
    expect(timeZoneFor("États-Unis")).toBe("America/Chicago");
    expect(timeZoneFor("Austin, Texas, États-Unis")).toBe("America/Chicago");
    expect(timeZoneFor("United States")).toBe("America/Chicago");
    expect(timeZoneFor("Côte d'Ivoire")).toBe("Africa/Abidjan");
    expect(timeZoneFor("France")).toBe("Europe/Paris");
    expect(timeZoneFor("Canada")).toBe("America/Toronto");
    expect(timeZoneFor("inconnu")).toBeNull();
    expect(timeZoneFor(null)).toBeNull();
  });

  it("n'envoie qu'en heures de bureau locales, en semaine", () => {
    const tz = "America/Chicago";
    // Jeudi 26 novembre 2026, 16:00 UTC = 10:00 à Austin : ouvert, envoi immédiat.
    const open = new Date("2026-11-26T16:00:00Z");
    expect(nextSendSlot(open, tz).getTime()).toBe(open.getTime());
    // 08:00 UTC = 02:00 à Austin : on attend 8 h locales.
    const night = nextSendSlot(new Date("2026-11-26T08:00:00Z"), tz);
    expect(hourIn(night, tz)).toBe(8);
    expect(dayIn(night, tz)).toBe("Thu");
    // Vendredi 19:00 à Austin : on attend lundi 8 h.
    const weekend = nextSendSlot(new Date("2026-11-28T01:00:00Z"), tz);
    expect(dayIn(weekend, tz)).toBe("Mon");
    expect(hourIn(weekend, tz)).toBe(8);
  });
});

describe("pied d'email", () => {
  it("suit la langue du message (anglais par défaut pour une langue inconnue)", () => {
    expect(footerText("en").link).toBe("Unsubscribe");
    expect(footerText("fr").link).toBe("Se désinscrire");
    expect(footerText("en-US").stop).toBe("To stop receiving these emails:");
    expect(footerText("sw").link).toBe("Unsubscribe");
  });
});
