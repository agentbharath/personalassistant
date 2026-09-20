import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GmailCallNotAllowedError, assertGmailDraftCallAllowed, draftBodyText } from "./gmail-drafts";

const base = "https://gmail.googleapis.com/gmail/v1/users/me";

describe("the Gmail call allow-list (R25.2): drafts only, never a send", () => {
  it("allows exactly create, read, update and delete of a draft", () => {
    expect(() => assertGmailDraftCallAllowed("POST", `${base}/drafts`)).not.toThrow();
    expect(() => assertGmailDraftCallAllowed("GET", `${base}/drafts/r-123_abc?format=full`)).not.toThrow();
    expect(() => assertGmailDraftCallAllowed("PUT", `${base}/drafts/r-123_abc`)).not.toThrow();
    expect(() => assertGmailDraftCallAllowed("DELETE", `${base}/drafts/r-123_abc`)).not.toThrow();
  });

  it("refuses every way of sending, whatever the method or wording", () => {
    const forbidden: Array<[string, string]> = [
      ["POST", `${base}/drafts/send`],
      ["POST", `${base}/drafts/r-123/send`],
      ["POST", `${base}/messages/send`],
      ["POST", `${base}/messages/import`],
      ["POST", `${base}/messages/insert`],
      ["POST", `${base}/messages/abc/trash`],
      ["POST", `${base}/messages/abc/modify`],
      ["POST", `${base}/messages/batchDelete`],
      ["DELETE", `${base}/messages/abc`],
      ["POST", `${base}/threads/abc/trash`],
      ["PATCH", `${base}/drafts/r-123`],
      ["GET", `${base}/messages`],
      ["POST", `${base}/labels`],
      ["POST", `${base}/settings/filters`],
    ];
    for (const [method, url] of forbidden) expect(() => assertGmailDraftCallAllowed(method, url), `${method} ${url}`).toThrow(GmailCallNotAllowedError);
  });

  it("refuses look-alike hosts, other users, odd ids and smuggled query strings", () => {
    const tricky = [
      "https://gmail.googleapis.com.evil.example/gmail/v1/users/me/drafts",
      "http://gmail.googleapis.com/gmail/v1/users/me/drafts",
      "https://user:pw@gmail.googleapis.com/gmail/v1/users/me/drafts",
      "https://gmail.googleapis.com/gmail/v1/users/someone-else/drafts",
      "https://gmail.googleapis.com/gmail/v1/users/me/drafts/../messages/send",
      "https://gmail.googleapis.com/gmail/v1/users/me/drafts/abc/../send",
      `${base}/drafts/abc?alt=media`,
      `${base}/drafts?send=true`,
      `${base}/drafts/${"a".repeat(200)}`,
      "not a url",
    ];
    for (const url of tricky) expect(() => assertGmailDraftCallAllowed("POST", url), url).toThrow(GmailCallNotAllowedError);
  });
});

describe("reading the text of a draft", () => {
  const encode = (text: string) => Buffer.from(text, "utf8").toString("base64url");
  it("finds the plain-text part, nested or not", () => {
    expect(draftBodyText({ id: "1", message: { payload: { mimeType: "text/plain", body: { data: encode("Hello there") } } } })).toBe("Hello there");
    expect(draftBodyText({ id: "1", message: { payload: { mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: { data: encode("<b>x</b>") } }, { mimeType: "text/plain", body: { data: encode("Plain") } }] } } })).toBe("Plain");
    expect(draftBodyText({ id: "1" })).toBe("");
  });
});

// The structural guarantee: no file in the app can send or otherwise change mail, or ask for a send-capable permission.
function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("nothing in the source can send or change mail", () => {
  const files = sourceFiles(join(process.cwd(), "src")).map((path) => ({ path, text: readFileSync(path, "utf8") }));

  it("has no Gmail write endpoint and no send-capable permission anywhere", () => {
    const forbidden = /(messages\/send|drafts\/send|messages\/import|messages\/insert|batchDelete|batchModify|\/trash|\/untrash|\/modify\b|gmail\.send|gmail\.modify|gmail\.insert|mail\.google\.com\/["'`\s]|gmail\.settings)/;
    const offenders = files.filter((file) => forbidden.test(file.text)).map((file) => file.path.replace(process.cwd(), ""));
    expect(offenders).toEqual([]);
  });

  it("makes Gmail writes from exactly one file, and never from the read-only Gmail module", () => {
    const callers = files.filter((file) => file.text.includes("gmail.googleapis.com")).map((file) => file.path.replace(`${process.cwd()}/src/`, ""));
    expect(callers.sort()).toEqual(["lib/tools/email/gmail-drafts.ts", "lib/tools/email/google-gmail.ts"]);
    const readOnly = files.find((file) => file.path.endsWith("tools/email/google-gmail.ts"))!.text;
    expect(readOnly).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)/i);
  });

  it("names the drafts permission in only the two files that must", () => {
    const users = files.filter((file) => file.text.includes("gmail.compose")).map((file) => file.path.replace(`${process.cwd()}/src/`, ""));
    expect(users.sort()).toEqual(["lib/auth/google-credential-broker.ts", "lib/auth/google-signin.ts"]);
  });
});
