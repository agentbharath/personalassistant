import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";
import type { WaitingResult } from "@/lib/replies/waiting";

vi.mock("@/app/perch/actions", () => ({ dismissReply: async () => undefined, savePerchChoices: async () => undefined }));
import { WaitingCard } from "./WaitingCard";

const NOW = Date.parse("2026-09-21T18:00:00Z");
const prefs = { saved: true, perchEnabled: true, remindersEnabled: true, kinds: ["person", "business", "recruiter"] as const };
const item = (id: string, kind: "person" | "invitation") => ({ threadId: `t${id}`, messageId: id, from: "Sam <sam@x.com>", subject: `Subject ${id}`, receivedAt: NOW - 86_400_000, reason: "Asks something.", kind });
const render = (result: WaitingResult) => renderToStaticMarkup(<ToastProvider><WaitingCard result={result} now={NOW} /></ToastProvider>);
const ok = (over: Partial<Extract<WaitingResult, { state: "ok" }>>): WaitingResult => ({ state: "ok", items: [], checked: 0, total: 0, prefs: { ...prefs, kinds: [...prefs.kinds] }, ...over });

describe("what the Waiting card says (free)", () => {
  it("says plainly that everything is handled when nothing waits and everything was checked", () => {
    const html = render(ok({ checked: 5, total: 5 }));
    expect(html).toContain("You’re all caught up. Nothing from the last 7 days looks like it needs a reply.");
    expect(html).not.toContain("Refresh to check the rest");
  });

  it("says how many messages it has looked at when it has not looked at all of them", () => {
    const html = render(ok({ checked: 30, total: 48 }));
    expect(html).toContain("Nothing so far. I’ve checked 30 of your 48 recent messages.");
    expect(html).toContain("Checked 30 of 48 recent messages so far. Refresh to check the rest.");
    expect(html).not.toContain("all caught up");
  });

  it("names the kinds it is hiding because of the owner's choices, instead of a vague count", () => {
    const html = render(ok({ items: [item("1", "invitation"), item("2", "invitation")], checked: 2, total: 2 }));
    expect(html).toContain("2 more need a reply but are hidden by your choices (Invitations and RSVPs). You can change that below.");
    expect(html).toContain("All caught up");
  });

  it("lists what is shown and does not mention hidden mail when nothing is hidden", () => {
    const html = render(ok({ items: [item("1", "person")], checked: 1, total: 1 }));
    expect(html).toContain("Subject 1");
    expect(html).toContain("1 waiting");
    expect(html).not.toContain("hidden by your choices");
  });

  it("asks first, and offers no reminders, before anything is chosen", () => {
    const html = render({ state: "setup", prefs: { ...prefs, saved: false, kinds: [...prefs.kinds] } });
    expect(html).toContain("What should I remind you about?");
    expect(html).toContain("Remind me about these");
    expect(html).toContain("No reminders");
  });

  it("is absent when reminders are off", () => {
    expect(render({ state: "off" })).not.toContain("Waiting on your reply");
  });
});
