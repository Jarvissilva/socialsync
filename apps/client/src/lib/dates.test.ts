import { describe, it, expect } from "vitest";
import { dateTimeInput, zonedInputToIso, dayKey } from "./dates";
import { validateContent, targetInputSchema } from "@social/shared";
describe("project time zones", () => {
  it("converts independently of the computer time zone", () => {
    expect(zonedInputToIso("2026-10-22T18:30", "Asia/Kolkata")).toBe(
      "2026-10-22T13:00:00.000Z",
    );
    expect(
      dateTimeInput(new Date("2026-10-22T13:00:00Z"), "Asia/Kolkata"),
    ).toBe("2026-10-22T18:30");
  });
  it("rejects daylight-saving gaps and ambiguous times", () => {
    expect(() =>
      zonedInputToIso("2026-03-08T02:30", "America/New_York"),
    ).toThrow("does not exist");
    expect(() =>
      zonedInputToIso("2026-11-01T01:30", "America/New_York"),
    ).toThrow("occurs twice");
  });
  it("groups posts by the project day", () => {
    expect(dayKey(new Date("2026-10-22T23:00:00Z"), "Asia/Kolkata")).toBe(
      "2026-10-23",
    );
  });
});
describe("publishing validation", () => {
  const base = {
    accountId: "11111111-1111-4111-8111-111111111111",
    format: "text",
  };
  it("permits Facebook text but requires media for Instagram", () => {
    expect(
      validateContent("facebook", targetInputSchema.parse(base), [], "Hello"),
    ).toEqual([]);
    expect(
      validateContent(
        "instagram",
        targetInputSchema.parse({ ...base, format: "image" }),
        [],
        "Hello",
      ).length,
    ).toBeGreaterThan(0);
  });
  it("requires a board for Pinterest and a title for YouTube", () => {
    expect(
      validateContent(
        "pinterest",
        targetInputSchema.parse({ ...base, format: "pin" }),
        [{ mime: "image/jpeg", size: 10 }],
        "Hello",
      ),
    ).toContain("Select a Pinterest board.");
    expect(
      validateContent(
        "youtube",
        targetInputSchema.parse({ ...base, format: "video" }),
        [{ mime: "video/mp4", size: 10 }],
        "Hello",
      ),
    ).toContain("Add a YouTube video title.");
  });
});
