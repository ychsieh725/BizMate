import { describe, it, expect } from "vitest";
import { statusPillClassName } from "./StatusPill.tsx";

describe("statusPillClassName", () => {
  it("draft 回灰底樣式", () => {
    expect(statusPillClassName("draft")).toContain("bg-surface-line");
  });

  it("awaiting_review 回黃底樣式", () => {
    expect(statusPillClassName("awaiting_review")).toContain("bg-status-review-bg");
  });

  it("confirmed 回藍底樣式", () => {
    expect(statusPillClassName("confirmed")).toContain("bg-status-confirmed-bg");
  });

  it("sent 回綠底樣式", () => {
    expect(statusPillClassName("sent")).toContain("bg-status-sent-bg");
  });
});
