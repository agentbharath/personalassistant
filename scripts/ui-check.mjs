// Screenshots and accessibility checks for the UI, using mock data (no account needed).
// Needs the dev server: `npm run dev`. Run: `npm run ui:check`. Output: ui-shots/ (git-ignored) and a summary here.
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.UI_BASE ?? "http://localhost:3000";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const axeSource = readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");

const viewports = { desktop: { width: 1280, height: 800 }, tablet: { width: 820, height: 1100 }, phone: { width: 390, height: 844 } };
const pages = [
  ["login", "/login"],
  ["chat-empty", "/design/app"],
  ["chat-thread", "/design/app?view=thread"],
  ["history", "/design/history"],
  ["perch", "/design/perch"],
  ["perch-empty", "/design/perch?state=connect"],
  ["privacy", "/privacy"],
  ["design", "/design"],
];

mkdirSync("ui-shots", { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const failures = [];
const consoleProblems = new Set();
const watch = (page, where) => {
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") consoleProblems.add(`${where}: ${message.type()}: ${message.text().slice(0, 300)}`); });
  page.on("pageerror", (error) => consoleProblems.add(`${where}: pageerror: ${String(error.message).slice(0, 300)}`));
};
const rows = [];

async function audit(page, label) {
  await page.evaluate(axeSource);
  const result = await page.evaluate(() => window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }));
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  rows.push({ label, violations: result.violations.length, serious: serious.length });
  for (const v of result.violations) {
    const line = `${label}: [${v.impact}] ${v.id} (${v.nodes.length}) ${v.help} :: ${v.nodes[0].target.join(" ")}`;
    console.log(`  ${line}`);
    if (v.impact === "serious" || v.impact === "critical") failures.push(line);
  }
}

for (const theme of ["light", "dark"]) {
  for (const [vpName, viewport] of Object.entries(viewports)) {
    const context = await browser.newContext({ viewport, colorScheme: theme, deviceScaleFactor: 1 });
    await context.addInitScript((value) => { try { localStorage.setItem("daylark-theme", value); } catch {} }, theme);
    const page = await context.newPage();
    watch(page, `${vpName}/${theme}`);
    for (const [name, path] of pages) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      const label = `${name}/${vpName}/${theme}`;
      await page.screenshot({ path: `ui-shots/${label.replaceAll("/", "-")}.png`, fullPage: name === "privacy" ? false : false });
      await audit(page, label);
    }
    await context.close();
  }
}

// Interactions, on desktop and phone.
for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({ viewport: viewports.desktop, colorScheme: theme });
  await context.addInitScript((value) => { try { localStorage.setItem("daylark-theme", value); } catch {} }, theme);
  const page = await context.newPage();
  watch(page, `ix/${theme}`);
  const shot = async (name) => { await page.waitForTimeout(300); await page.screenshot({ path: `ui-shots/ix-${name}-${theme}.png` }); await audit(page, `ix-${name}/${theme}`); };

  await page.goto(BASE + "/design/app?view=thread", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  await shot("shortcuts");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Find in this chat" }).click();
  await page.getByRole("searchbox", { name: "Find in this chat" }).fill("total");
  await shot("find");
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: /Total spending so far/ }).hover();
  await page.getByRole("button", { name: /Actions for Total spending so far/ }).click();
  await shot("row-menu");
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await shot("delete-dialog");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Bad answer" }).first().click();
  await shot("bad-answer-note");

  // Delete -> confirm -> Undo toast, then undo.
  await page.goto(BASE + "/design/app?view=thread", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /Total spending so far/ }).hover();
  await page.getByRole("button", { name: /Actions for Total spending so far/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await shot("undo-toast");
  const focusedOnUndo = await page.evaluate(() => document.activeElement?.textContent === "Undo");
  if (!focusedOnUndo) failures.push(`ix-undo-toast/${theme}: focus did not move to Undo`);
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(300);
  const backOnTrigger = await page.evaluate(() => document.activeElement?.getAttribute("aria-label")?.startsWith("Actions for Total spending"));
  if (!backOnTrigger) failures.push(`ix-undo/${theme}: focus did not return to the chat's menu button after Undo`);

  // Collapse and restore the sidebar.
  await page.keyboard.press("Control+b");
  await shot("sidebar-collapsed");
  await page.keyboard.press("Control+b");

  // Attachments: a valid image shows a preview, a text file shows a reason.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.locator("input[type=file]").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: png });
  await shot("attachment-preview");
  await page.getByRole("button", { name: /Remove receipt.png/ }).click();
  await page.locator("input[type=file]").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await shot("attachment-rejected");

  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Privacy Policy" }).click();
  await shot("legal-dialog");
  await context.close();
}

await browser.close();
console.log("\nSummary (label: violations / serious+critical)");
for (const row of rows) if (row.violations) console.log(`  ${row.label}: ${row.violations} / ${row.serious}`);
console.log("\nBrowser console errors and warnings:");
for (const problem of consoleProblems) console.log(`  ${problem}`);
if (!consoleProblems.size) console.log("  none");
console.log(`\n${rows.length} checks, ${failures.length} serious or critical violation(s).`);
process.exit(failures.length ? 1 : 0);
