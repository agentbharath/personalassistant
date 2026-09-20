import { describe, expect, it } from "vitest";
import { isOneTimeSecretMail, redactSecrets } from "./email-secrets";

describe("one-time codes and sign-in links never reach the user (R24)", () => {
  it("hides a code near a code word, whichever side it is on", () => {
    expect(redactSecrets("Your verification code is 482913. It expires in 10 minutes.")).toBe("Your verification code is [code hidden]. It expires in 10 minutes.");
    expect(redactSecrets("482913 is your Google verification code")).toBe("[code hidden] is your Google verification code");
    expect(redactSecrets("OTP: 90211")).toBe("OTP: [code hidden]");
    expect(redactSecrets("Your security code: 123 456")).toBe("Your security code: [code hidden]");
    expect(redactSecrets("Use passcode A1B2C3 to sign in")).not.toContain("A1B2C3");
  });

  it("hides links that sign someone in, reset a password, confirm an address or carry a token", () => {
    for (const link of ["https://example.com/reset-password?token=abc123", "https://accounts.example.com/verify/email/9f8e", "https://app.example.com/magic-link/xyz", "https://x.example.com/login?code=778899", "https://x.example.com/confirm?ticket=1"]) {
      expect(redactSecrets(`Click here: ${link} to continue`), link).toBe("Click here: [link hidden] to continue");
    }
  });

  it("leaves ordinary text, amounts, order numbers and normal links alone", () => {
    const text = "Your order #947597212 for $48.20 shipped. Track it at https://www.ups.com/track?loc=en_US. Ref 2026-09-15.";
    expect(redactSecrets(text)).toBe(text);
    expect(redactSecrets("Invoice total 1234.56 due 2026-10-01")).toBe("Invoice total 1234.56 due 2026-10-01");
  });

  it("recognises a one-time or sign-in email by its subject or opening text, so its body is not shown at all", () => {
    expect(isOneTimeSecretMail("Your verification code", "")).toBe(true);
    expect(isOneTimeSecretMail("Reset your password", "")).toBe(true);
    expect(isOneTimeSecretMail("Sign in to Notion", "Click the magic link below to sign in")).toBe(true);
    expect(isOneTimeSecretMail("Your Amazon order has shipped", "Arriving Friday")).toBe(false);
    expect(isOneTimeSecretMail("Receipt from iHerb", "Thanks for your order")).toBe(false);
  });
});
