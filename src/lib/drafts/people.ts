import type { EmailSearchResult } from "@/lib/tools/email/google-gmail";

export type Person = { name: string; address: string };

/** Splits an address header ("Sam Lee <sam@x.com>, other@y.com") into people. Form parsing only. */
export function parsePeople(header: string): Person[] {
  const out: Person[] = [];
  for (const part of header.match(/(?:"[^"]*"|[^,"])+/g) ?? []) {
    const angle = part.match(/^\s*"?([^"<]*?)"?\s*<([^<>\s]+@[^<>\s]+)>\s*$/);
    const bare = part.trim().match(/^([^\s<>@,;]+@[^\s<>@,;]+)$/);
    if (angle) out.push({ name: angle[1].trim(), address: angle[2].toLowerCase() });
    else if (bare) out.push({ name: "", address: bare[1].toLowerCase() });
  }
  return out;
}

const tokens = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}@.' -]/gu, " ").split(/\s+/).filter((token) => token.length >= 2);

/** Gmail search text for a person's name: letters, digits and a few joiners only, so a name can never change what the search means. */
export function searchTerm(name: string) {
  return tokens(name).join(" ").replace(/['"]/g, "").trim();
}

/** Does this person match what the owner called them ("sarah", "sarah lee", "the landlord")? Every word must appear in the display name or the address. */
function matches(person: Person, wanted: string[]) {
  if (!wanted.length) return false;
  const haystack = `${person.name} ${person.address}`.toLowerCase();
  return wanted.every((token) => haystack.includes(token));
}

export type PersonLookup = { status: "one"; person: Person } | { status: "many"; options: Person[] } | { status: "none" };

/**
 * Who does the owner mean? Looks at the people in the mail already found (senders of received mail, recipients of sent mail), keeps those whose
 * name or address contains every word the owner used, and ranks by how often they appear. One clear match is used; several are asked about.
 */
export function lookupPerson(name: string, messages: EmailSearchResult[], ownAddress: string | null): PersonLookup {
  const wanted = tokens(name);
  const counts = new Map<string, { person: Person; count: number }>();
  for (const message of messages) {
    for (const person of [...parsePeople(message.from), ...parsePeople(message.to ?? "")]) {
      if (person.address === ownAddress || !matches(person, wanted)) continue;
      const entry = counts.get(person.address) ?? { person, count: 0 };
      counts.set(person.address, { person: entry.person.name ? entry.person : person, count: entry.count + 1 });
    }
  }
  const ranked = [...counts.values()].sort((left, right) => right.count - left.count);
  if (!ranked.length) return { status: "none" };
  // One person, or one who clearly appears most (twice as often as the next), is used without asking.
  if (ranked.length === 1 || ranked[0].count >= ranked[1].count * 2) return { status: "one", person: ranked[0].person };
  return { status: "many", options: ranked.slice(0, 4).map((entry) => entry.person) };
}

export const formatPerson = (person: Person) => (person.name ? `${person.name} <${person.address}>` : person.address);
