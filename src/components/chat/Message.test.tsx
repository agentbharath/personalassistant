import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UserMessage } from "./Message";

describe("the buttons under your own message (free)", () => {
  it("offers Copy and Ask again", () => {
    const html = renderToStaticMarkup(<UserMessage onResend={() => undefined}>suggest some chinese cuisines near me</UserMessage>);
    expect(html).toContain("suggest some chinese cuisines near me");
    expect(html).toContain('aria-label="Copy message"');
    expect(html).toContain('aria-label="Ask again"');
  });

  it("leaves out Ask again when there is nothing to send it with, and disables it while Daylark is busy", () => {
    expect(renderToStaticMarkup(<UserMessage>hi</UserMessage>)).not.toContain("Ask again");
    expect(renderToStaticMarkup(<UserMessage busy onResend={() => undefined}>hi</UserMessage>)).toMatch(/aria-label="Ask again"[^>]*disabled|disabled[^>]*aria-label="Ask again"/);
  });
});
