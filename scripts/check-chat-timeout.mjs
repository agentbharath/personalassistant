// Browser regression for R48: all chat/feedback responses are fixtures; no provider calls.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const base = process.env.UI_BASE ?? "http://localhost:3000";
const conversationId = "00000000-0000-4000-8000-000000000048";
const message = "This is taking longer than expected, so I stopped safely. Nothing unconfirmed was changed.";
const output = "ui-shots/chat-timeout";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const problems = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  page.on("pageerror", error => problems.push(error.message));
  await page.route("**/api/**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ feedback: {} }) }));
  await page.route("**/api/chat", route => route.fulfill({ contentType: "application/x-ndjson", body: [
    { type: "progress", agents: [] },
    { type: "progress", agents: ["general"] },
    { type: "result", status: 504, body: { error: "QUERY_TIMED_OUT", message, retryable: true, conversationId, persistenceWarning: "This notice couldn’t be saved to chat history." } },
  ].map(event => JSON.stringify(event)).join("\n") + "\n" }));
  await page.goto(`${base}/design/app`, { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Message Daylark", exact: true }).fill("any recent sports news?");
  await page.getByRole("textbox", { name: "Message Daylark", exact: true }).press("Enter");
  await page.getByRole("article", { name: "Daylark notice" }).waitFor();
  assert.ok(await page.getByRole("article", { name: "Daylark notice" }).getByText(message, { exact: true }).isVisible());
  assert.ok(await page.getByRole("button", { name: "Try again", exact: true }).isVisible());
  assert.equal(new URL(page.url()).pathname, "/design/app", "Unsaved notice must not be remounted out of existence");
  await page.screenshot({ path: `${output}/unsaved-notice.png` });

  // Reopening a saved conversation initializes Chat from persisted notice/retry metadata.
  await page.goto(`${base}/design/app?view=timeout`, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  assert.ok(await page.getByRole("article", { name: "Daylark notice" }).getByText(message, { exact: true }).isVisible());
  assert.ok(await page.getByRole("button", { name: "Try again", exact: true }).isEnabled());
  await page.screenshot({ path: `${output}/reopened-notice.png` });
  await page.unroute("**/api/chat");
  let retryPayload;
  await page.route("**/api/chat", route => {
    retryPayload = route.request().postDataJSON();
    return route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "result", status: 200, body: { answer: "The retry completed successfully.", conversationId, sequence: "4" } }) + "\n" });
  });
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByText("The retry completed successfully.", { exact: true }).waitFor();
  assert.equal(retryPayload.conversationId, conversationId);
  assert.equal(retryPayload.isRetry, true);
  assert.deepEqual(problems, []);
  console.log("Passed: streamed timeout visible, unsaved notice retained, saved notice survives reload, retry uses the same conversation; no browser errors.");
} finally {
  await browser.close();
}
