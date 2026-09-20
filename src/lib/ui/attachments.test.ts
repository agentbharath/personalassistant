import { describe, expect, it } from "vitest";
import { attachmentProblem, formatBytes } from "./attachments";

const file = (over: Partial<{ type: string; size: number; name: string }> = {}) => ({ type: "application/pdf", size: 200_000, name: "receipt.pdf", ...over });

describe("attachment validation", () => {
  it("accepts PDFs and common images within 5 MB", () => {
    for (const type of ["application/pdf", "image/jpeg", "image/png", "image/webp"]) expect(attachmentProblem(file({ type }))).toBeNull();
  });
  it("rejects other types, oversize and empty files with a plain reason", () => {
    expect(attachmentProblem(file({ type: "text/plain", name: "notes.txt" }))).toMatch(/isn’t a PDF or image/);
    expect(attachmentProblem(file({ size: 6 * 1024 * 1024 }))).toMatch(/5 MB or smaller/);
    expect(attachmentProblem(file({ size: 0 }))).toMatch(/empty/);
  });
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
