export type DraftSpec = {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  /** For a reply: the message being answered, so Gmail threads the draft under it. */
  inReplyTo?: { messageId: string; references?: string[]; threadId?: string };
};

const ADDRESS = new RegExp("^[^\\s@<>,;\"'()\\[\\]\\\\]+@[^\\s@<>,;\"'()\\[\\]\\\\]+\\.[^\\s@<>,;\"'()\\[\\]\\\\]{2,}$");
const LINE_BREAK = new RegExp("[\\r\\n]");
const NON_ASCII = new RegExp("[^\\x20-\\x7e]");
const MAX_RECIPIENTS = 20;
const MAX_SUBJECT = 300;
const MAX_BODY = 50_000;

/** Reasons a draft cannot be built. Form only: it never judges what the person meant, only whether the pieces are safe and well-formed. */
export function draftProblems(spec: DraftSpec): string[] {
  const problems: string[] = [];
  const addresses = [...spec.to, ...(spec.cc ?? [])];
  if (spec.to.length === 0) problems.push("A draft needs at least one recipient.");
  if (addresses.length > MAX_RECIPIENTS) problems.push(`A draft can have at most ${MAX_RECIPIENTS} recipients.`);
  for (const address of addresses) if (!ADDRESS.test(address) || address.length > 254) problems.push(`“${address.slice(0, 60)}” is not a valid email address.`);
  if (LINE_BREAK.test(spec.subject)) problems.push("The subject cannot contain a line break.");
  if (spec.subject.length > MAX_SUBJECT) problems.push("The subject is too long.");
  if (!spec.body.trim()) problems.push("The draft has no text.");
  if (spec.body.length > MAX_BODY) problems.push("The draft is too long.");
  const reply = spec.inReplyTo;
  if (reply) for (const id of [reply.messageId, ...(reply.references ?? [])]) if (!id || /[\s\r\n]/.test(id.replace(/^<|>$/g, "")) || id.length > 998) problems.push("A reply reference is not valid.");
  return problems;
}

/** RFC 2047 encoding for a subject with non-ASCII characters, split so no word is longer than 75 characters. */
function encodeSubject(subject: string) {
  if (!NON_ASCII.test(subject)) return subject;
  const words: string[] = [];
  let chunk = "";
  for (const character of subject) {
    if (Buffer.byteLength(chunk + character) > 42) { words.push(chunk); chunk = ""; }
    chunk += character;
  }
  if (chunk) words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word, "utf8").toString("base64")}?=`).join("\r\n ");
}

const bracket = (id: string) => (id.startsWith("<") ? id : `<${id}>`);
const base64Lines = (text: string) => (Buffer.from(text, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");

/** The message as Gmail's API wants it: RFC 2822 text, base64url encoded. Throws if the spec has any problem. */
export function buildRawMessage(spec: DraftSpec): string {
  const problems = draftProblems(spec);
  if (problems.length) throw new Error(`DRAFT_INVALID: ${problems.join(" ")}`);
  const headers = [
    `To: ${spec.to.join(", ")}`,
    ...(spec.cc?.length ? [`Cc: ${spec.cc.join(", ")}`] : []),
    `Subject: ${encodeSubject(spec.subject)}`,
    ...(spec.inReplyTo ? [`In-Reply-To: ${bracket(spec.inReplyTo.messageId)}`, `References: ${[...(spec.inReplyTo.references ?? []), spec.inReplyTo.messageId].map(bracket).join(" ")}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const message = `${headers.join("\r\n")}\r\n\r\n${base64Lines(spec.body)}\r\n`;
  return Buffer.from(message, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Line endings and trailing spaces do not count as an edit when checking whether the person changed a draft in Gmail. */
export const normalizeBody = (text: string) => text.replace(/\r\n/g, "\n").split("\n").map((line) => line.replace(/\s+$/, "")).join("\n").trim();
