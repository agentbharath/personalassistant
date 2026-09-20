import { describe, expect, it } from "vitest";
import type { EmailSearchResult } from "@/lib/tools/email/google-gmail";
import { formatPerson, lookupPerson, parsePeople, searchTerm } from "./people";

const mail = (from: string, to = ""): EmailSearchResult => ({ id: "m", threadId: "t", subject: "s", from, date: "", receivedAt: 1, snippet: "", to });

describe("finding who an email is for (free)", () => {
  it("splits address headers into names and addresses", () => {
    expect(parsePeople('"Lee, Sam" <Sam@X.com>, other@y.com, Priya Nair <priya@z.org>')).toEqual([
      { name: "Lee, Sam", address: "sam@x.com" }, { name: "", address: "other@y.com" }, { name: "Priya Nair", address: "priya@z.org" },
    ]);
  });

  it("keeps a search term to plain lower-case words, so a name can never turn into a Gmail search operator", () => {
    expect(searchTerm('Sarah" OR in:anywhere')).toBe("sarah or in anywhere");
    expect(searchTerm("  Sam   Lee ")).toBe("sam lee");
  });

  it("uses the one person whose name or address has every word", () => {
    const result = lookupPerson("sarah", [mail("Sarah Kim <sarah@kim.com>"), mail("Sarah Kim <sarah@kim.com>"), mail("Bob <bob@x.com>")], "me@x.com");
    expect(result).toEqual({ status: "one", person: { name: "Sarah Kim", address: "sarah@kim.com" } });
  });

  it("finds a recipient from mail the owner sent", () => {
    expect(lookupPerson("landlord", [mail("me@x.com", "Green Street Landlord <landlord@greenstreet.com>")], "me@x.com")).toMatchObject({ status: "one", person: { address: "landlord@greenstreet.com" } });
  });

  it("asks when two different people are about equally likely, and lists them", () => {
    const result = lookupPerson("sam", [mail("Sam Lee <sam@lee.com>"), mail("Sam Park <sam@park.com>")], null);
    expect(result.status).toBe("many");
    if (result.status === "many") expect(result.options.map((person) => person.address)).toEqual(["sam@lee.com", "sam@park.com"]);
  });

  it("uses the person who appears far more often, and never the owner's own address", () => {
    const messages = [mail("Sam Lee <sam@lee.com>"), mail("Sam Lee <sam@lee.com>"), mail("Sam Lee <sam@lee.com>"), mail("Sam Park <sam@park.com>"), mail("Sam Me <sam@me.com>")];
    expect(lookupPerson("sam", messages, "sam@me.com")).toMatchObject({ status: "one", person: { address: "sam@lee.com" } });
  });

  it("finds no one when nothing matches, or when no name was given", () => {
    expect(lookupPerson("zed", [mail("Sam Lee <sam@lee.com>")], null)).toEqual({ status: "none" });
    expect(lookupPerson("", [mail("Sam Lee <sam@lee.com>")], null)).toEqual({ status: "none" });
  });

  it("shows a person with their address", () => {
    expect(formatPerson({ name: "Sam Lee", address: "sam@lee.com" })).toBe("Sam Lee <sam@lee.com>");
    expect(formatPerson({ name: "", address: "sam@lee.com" })).toBe("sam@lee.com");
  });
});
