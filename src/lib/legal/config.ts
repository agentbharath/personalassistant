/**
 * Who the legal pages speak for. Set these in the environment before publishing; until then the pages show the bracketed
 * placeholders so it is obvious they are unfinished.
 */
export const legal = {
  product: "Daylark",
  operator: process.env.NEXT_PUBLIC_LEGAL_OPERATOR || "[Operator name]",
  contactEmail: process.env.NEXT_PUBLIC_LEGAL_EMAIL || "[contact email]",
  jurisdiction: process.env.NEXT_PUBLIC_LEGAL_JURISDICTION || "[State or country]",
  effective: "September 19, 2026",
};

/** Names of the placeholders still unset, for the warning shown outside production. */
export function unsetLegalFields() {
  return Object.entries({ operator: legal.operator, contactEmail: legal.contactEmail, jurisdiction: legal.jurisdiction })
    .filter(([, value]) => value.startsWith("["))
    .map(([name]) => name);
}
