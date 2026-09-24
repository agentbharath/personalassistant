type Mail = { subject: string; from?: string; snippet?: string; text?: string };

/** Owner preference: exclude UPI records before selection and again after reading. */
export function isUpiEmail(mail: Mail) {
  return /\bUPI\b/i.test(`${mail.subject} ${mail.snippet ?? ""} ${mail.text ?? ""}`);
}

export function isRemitlyEmail(mail: Mail) {
  return /@(?:[\w-]+\.)*remitly\.com(?:[>\s]|$)/i.test(mail.from ?? "");
}

/** Only reconcile remittance updates with an explicit reference and a labeled sender amount. */
export function remitlyTransfer(mail: Mail): { reference: string; amountMinor: number; currency: string } | { reason: string } | null {
  if (!isRemitlyEmail(mail)) return null;
  const text = `${mail.subject} ${mail.text ?? ""}`;
  const reference = /\b(?:(?:transfer|transaction)\s*(?:number|no\.?|id|code|#)|reference(?:\s*(?:number|no\.?|id|code|#))?)\s*[:#-]?\s*([a-z0-9][a-z0-9-]{5,})\b/i.exec(text)?.[1];
  if (!reference || !/\d/.test(reference)) return { reason: "Remitly transfer reference missing; cannot safely reconcile its currency updates" };
  const money = /\b(?:you sent|amount sent|send amount|sending amount|transfer amount)\s*[:=-]?\s*(?:([A-Z]{3})\s*)?([$₹€£])?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*([A-Z]{3})?\b/gi;
  const matches = [...text.matchAll(money)].flatMap((match) => {
    const code = [match[1], match[4]].find((value) => value && /^(USD|INR|EUR|GBP|CAD|AUD|NZD|SGD|HKD)$/i.test(value))?.toUpperCase();
    // A bare dollar sign is ambiguous; never assume USD for a remittance.
    const currency = code ?? ({ "₹": "INR", "€": "EUR", "£": "GBP" } as Record<string, string>)[match[2]];
    const amountMinor = Math.round(Number(match[3].replaceAll(",", "")) * 100);
    return currency && Number.isSafeInteger(amountMinor) && amountMinor > 0 ? [{ currency, amountMinor }] : [];
  });
  const unique = [...new Map(matches.map((value) => [`${value.currency}:${value.amountMinor}`, value])).values()];
  if (unique.length !== 1) return { reason: "Remitly sender amount or currency is unclear; recipient-side amounts are not imported separately" };
  return { reference: reference.toUpperCase(), ...unique[0] };
}

export function transferLabel(candidate: { note?: string | null }) {
  return candidate.note === "Credit card payment" ? "card payment" : "transfer";
}
