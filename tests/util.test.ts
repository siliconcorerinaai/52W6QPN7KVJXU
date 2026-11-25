import { describe, expect, it } from "vitest";
import { isNonCompanyDomain, normalizeDomain, slugifyName, splitName } from "@/lib/util";

describe("normalizeDomain", () => {
  it.each([
    ["https://www.Acme.fr/contact?x=1", "acme.fr"],
    ["http://sub.example.co.uk/", "sub.example.co.uk"],
    ["acme.io", "acme.io"],
    ["www2.acme.com", "acme.com"],
    ["  ACME.COM.  ", "acme.com"],
  ])("%s → %s", (input, out) => expect(normalizeDomain(input)).toBe(out));

  it("rejette les valeurs invalides", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("pas un domaine")).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
  });
});

describe("isNonCompanyDomain", () => {
  it("écarte réseaux sociaux, annuaires et médias", () => {
    expect(isNonCompanyDomain("linkedin.com")).toBe(true);
    expect(isNonCompanyDomain("fr.linkedin.com")).toBe(true);
    expect(isNonCompanyDomain("pappers.fr")).toBe(true);
    expect(isNonCompanyDomain("acme.fr")).toBe(false);
  });
});

describe("noms", () => {
  it("découpe prénom / nom", () => {
    expect(splitName("Jean-Pierre de la Tour")).toEqual({ first: "Jean-Pierre", last: "de la Tour" });
    expect(splitName("Dr. Marie Curie")).toEqual({ first: "Marie", last: "Curie" });
    expect(splitName("Camille Martin (CEO)")).toEqual({ first: "Camille", last: "Martin" });
    expect(splitName("Madonna")).toEqual({ first: "Madonna", last: "" });
  });
  it("normalise accents et caractères spéciaux", () => {
    expect(slugifyName("Émilie")).toBe("emilie");
    expect(slugifyName("Jean-Pierre")).toBe("jeanpierre");
    expect(slugifyName("Lætitia")).toBe("laetitia");
  });
});
