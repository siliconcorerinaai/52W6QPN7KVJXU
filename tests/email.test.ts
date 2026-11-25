import { describe, expect, it } from "vitest";
import { buildEmail, candidateEmails, fromHunterPattern, inferPattern, isRoleEmail } from "@/lib/email/patterns";
import { isValidSyntax, verifyEmail } from "@/lib/email/verify";
import { extractEmails } from "@/lib/scrape/site";

describe("motifs d'email", () => {
  it("construit les adresses selon le motif", () => {
    expect(buildEmail("first.last", "Émilie Dubois", "acme.fr")).toBe("emilie.dubois@acme.fr");
    expect(buildEmail("flast", "Émilie Dubois", "acme.fr")).toBe("edubois@acme.fr");
    expect(buildEmail("first", "Émilie Dubois", "acme.fr")).toBe("emilie@acme.fr");
    expect(buildEmail("f.last", "Jean-Pierre Martin", "acme.fr")).toBe("j.martin@acme.fr");
  });

  it("place le motif connu en premier", () => {
    const c = candidateEmails("Paul Durand", "acme.fr", "flast");
    expect(c[0]).toBe("pdurand@acme.fr");
    expect(c).toContain("paul.durand@acme.fr");
    expect(new Set(c).size).toBe(c.length);
  });

  it("déduit le motif à partir d'une adresse et d'un nom connus", () => {
    const r = inferPattern(["contact@acme.fr", "pdurand@acme.fr"], [{ name: "Paul Durand" }], "acme.fr");
    expect(r?.pattern).toBe("flast");
  });

  it("déduit first.last de la forme de l'adresse, ignore les adresses génériques et autres domaines", () => {
    expect(inferPattern(["marie.curie@acme.fr"], [], "acme.fr")?.pattern).toBe("first.last");
    expect(inferPattern(["contact@acme.fr", "info@acme.fr"], [], "acme.fr")).toBeNull();
    expect(inferPattern(["marie.curie@gmail.com"], [], "acme.fr")).toBeNull();
  });

  it("reconnaît les adresses génériques", () => {
    expect(isRoleEmail("contact@acme.fr")).toBe(true);
    expect(isRoleEmail("recrutement@acme.fr")).toBe(true);
    expect(isRoleEmail("paul.durand@acme.fr")).toBe(false);
  });

  it("convertit les motifs Hunter", () => {
    expect(fromHunterPattern("{first}.{last}")).toBe("first.last");
    expect(fromHunterPattern("{f}{last}")).toBe("flast");
    expect(fromHunterPattern("bizarre")).toBeNull();
  });
});

describe("vérification", () => {
  it("valide la syntaxe", () => {
    expect(isValidSyntax("paul.durand@acme.fr")).toBe(true);
    expect(isValidSyntax("paul..@acme")).toBe(false);
    expect(isValidSyntax("pas-un-email")).toBe(false);
  });
  it("refuse syntaxe invalide et domaines jetables sans requête réseau", async () => {
    expect((await verifyEmail("nope")).status).toBe("invalid");
    expect((await verifyEmail("x@yopmail.com")).status).toBe("invalid");
  });
});

describe("extraction d'emails", () => {
  it("trouve les adresses, y compris obfusquées, et filtre les faux positifs", () => {
    const text = "Écrivez à jean.dupont@acme.fr ou marie [at] acme [dot] fr. Logo: logo@2x.png. contact(at)acme.fr";
    const found = extractEmails(text);
    expect(found).toContain("jean.dupont@acme.fr");
    expect(found).toContain("marie@acme.fr");
    expect(found).toContain("contact@acme.fr");
    expect(found).not.toContain("logo@2x.png");
  });
});
