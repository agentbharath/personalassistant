/**
 * R24: one-time passcodes, verification codes, password-reset links and sign-in links in email belong to the service that sent them and
 * are used straight away, so Daylark never shows, quotes or acts on them.
 *
 * This is a DATA SAFETY filter on email text that is about to be displayed. It does not read or classify what the user asked for (that is
 * the model's job, R20.5); it only removes secrets from content on its way out. It errs on the side of hiding.
 */
const CODE_WORDS = "(?:verification|security|confirmation|one[- ]?time|login|log-in|sign[- ]?in|access|authentication|passcode|pass code|otp|2fa|pin|code)";
// A number or short code near a code word: "your code is 482913", "482913 is your verification code", "OTP: A1B2C3".
const AFTER_WORD = new RegExp(`(\\b${CODE_WORDS}\\b[^\\n.]{0,40}?)(\\b(?=[A-Z0-9-]*\\d)[A-Z0-9]{4,8}\\b|\\b\\d{3}[- ]\\d{3}\\b)`, "gi");
const BEFORE_WORD = new RegExp(`(\\b(?=[A-Z0-9-]*\\d)[A-Z0-9]{4,8}\\b|\\b\\d{3}[- ]\\d{3}\\b)([^\\n.]{0,20}?\\b(?:is|as)\\b[^\\n.]{0,30}?\\b${CODE_WORDS}\\b)`, "gi");
// Links that sign someone in, reset a password or confirm an address, and any link carrying a token or code.
const URL = /https?:\/\/[^\s<>"')\]]+/gi;
const AUTH_LINK = /(reset|verify|verification|confirm|magic|passwordless|sign-?in|log-?in|activate|auth|otp|token=|code=|key=|ticket=|session=)/i;

const HIDDEN_CODE = "[code hidden]";
const HIDDEN_LINK = "[link hidden]";

export function redactSecrets(text: string): string {
  return text
    .replace(URL, (link) => (AUTH_LINK.test(link) ? HIDDEN_LINK : link))
    .replace(AFTER_WORD, (_all, lead: string) => `${lead}${HIDDEN_CODE}`)
    .replace(BEFORE_WORD, (_all, _code: string, tail: string) => `${HIDDEN_CODE}${tail}`);
}

const ONE_TIME_MAIL = new RegExp(`\\b(?:${CODE_WORDS}\\s+code|verification|one[- ]?time|passcode|otp|2fa|password reset|reset (?:your )?password|magic link|sign[- ]?in link|log[- ]?in link|confirm your (?:email|account|sign[- ]?in))\\b`, "i");

/** Whether an email is, by its subject or opening text, a one-time code or sign-in mail, so its body is not shown at all. */
export function isOneTimeSecretMail(subject: string, snippet: string): boolean {
  return ONE_TIME_MAIL.test(`${subject} ${snippet.slice(0, 240)}`);
}

export const ONE_TIME_MAIL_NOTE = "This looks like a one-time code or sign-in email, so I've left its contents alone: those belong to the service that sent them. Open it in Gmail.";
