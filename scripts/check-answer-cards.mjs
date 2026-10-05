// Local-only visual checks against the supplied DaylarkCards stylesheet. Uses development fixtures, never live tools.
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const base = process.env.UI_BASE ?? "http://localhost:3000";
const output = "ui-shots/answer-cards";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const problems = [];
const results = [];
const axe = readFileSync("node_modules/axe-core/axe.min.js", "utf8");
try {
  for (const theme of ["light", "dark"]) for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1100 }, colorScheme: theme, reducedMotion: "reduce", deviceScaleFactor: 1 });
    await context.addInitScript(t => localStorage.setItem("daylark-theme", t), theme);
    const page = await context.newPage();
    page.on("pageerror", error => problems.push(error.message));
    for (const view of ["suggestion", "verdict", "sports-news", "score", "digest"]) {
      await page.goto(`${base}/design/app?view=${view}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const cards = page.locator('section[class*="DaylarkCards"][aria-label]');
      const count = await cards.count();
      assert.ok(count > 0, `No cards rendered for ${view}`);
      for (let index = 0; index < count; index++) {
        const card = cards.nth(index);
        await card.scrollIntoViewIfNeeded();
        const metrics = await card.evaluate(el => {
          const css = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const mono = el.querySelector('[class*="heroMetric"], [class*="teamScore"], [class*="cell"]');
          const hero = el.querySelector('[class*="heroName"]');
          return { padding: css.paddingTop, radius: css.borderRadius, border: css.borderTopWidth, surface: css.backgroundColor, font: css.fontFamily, mono: mono ? getComputedStyle(mono).fontFamily : null, heroSize: hero ? getComputedStyle(hero).fontSize : null, animation: css.animationName, overflow: el.scrollWidth > el.clientWidth + 1, viewportOverflow: rect.right > innerWidth + 1 || rect.left < -1 };
        });
        assert.equal(metrics.padding, width <= 480 ? "16px" : "24px");
        assert.equal(metrics.radius, "16px");
        assert.equal(metrics.border, "1px");
        assert.equal(metrics.animation, "none");
        assert.equal(metrics.overflow, false, `${view} has internal overflow at ${width}`);
        assert.equal(metrics.viewportOverflow, false, `${view} overflows viewport at ${width}`);
        if (metrics.heroSize) assert.equal(metrics.heroSize, "20px");
        assert.match(metrics.font, /Geist/);
        if (metrics.mono) assert.match(metrics.mono, /Geist.*Mono/);
        const filename = `${view}-${index}-${width}-${theme}`;
        // Capture the rendered card and its chips without sticky app chrome covering tall mobile cards.
        await card.evaluate(el => {
          const capture = document.createElement("div");
          capture.dataset.cardCapture = "true";
          Object.assign(capture.style, { position: "absolute", top: "0", left: "0", width: `${el.getBoundingClientRect().width}px`, zIndex: "2147483647", background: "var(--bg)" });
          capture.append(el.cloneNode(true));
          if (el.nextElementSibling?.getAttribute("aria-label") === "Follow-up options") capture.append(el.nextElementSibling.cloneNode(true));
          document.body.append(capture);
        });
        await page.locator('[data-card-capture]').screenshot({ path: `${output}/${filename}.png` });
        await page.locator('[data-card-capture]').evaluate(el => el.remove());
        results.push({ view, theme, width, index, ...metrics });
      }
      await page.evaluate(axe);
      const violations = await page.evaluate(() => window.axe.run('section[class*="DaylarkCards"]', { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }));
      for (const violation of violations.violations) if (["serious", "critical"].includes(violation.impact)) problems.push(`${view}/${width}/${theme}: ${violation.id}`);
      assert.ok(await page.locator('[class*="DaylarkCards_chipAct"]').count() <= count, "More than one blue action chip per card");
      if (view === "verdict") assert.equal(await page.getByText("Replying to: fleece jacket offers", { exact: false }).count(), 1);
      if (view === "score") assert.equal(await page.getByLabel("This over", { exact: true }).count(), 1);
    }
    await context.close();
  }
  // Check normal motion separately so reduced-motion testing cannot hide a missing animation.
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, reducedMotion: "no-preference" });
  await page.goto(`${base}/design/app?view=score`, { waitUntil: "networkidle" });
  const motion = await page.locator('section[class*="DaylarkCards"]').last().evaluate(el => ({ card: getComputedStyle(el).animationName, dot: getComputedStyle(el.querySelector('[class*="liveDot"]')).animationName, parent: getComputedStyle(el.closest('article')).animationName }));
  assert.match(motion.card, /arrive/);
  assert.match(motion.dot, /pulse/);
  assert.equal(motion.parent, "none");
  await page.close();
} finally {
  await browser.close();
  writeFileSync(`${output}/audit.json`, JSON.stringify({ results, problems }, null, 2));
}
console.log(`${results.length} card screenshots checked; ${problems.length} browser/accessibility problems.`);
if (problems.length) { console.error(problems.join("\n")); process.exitCode = 1; }
