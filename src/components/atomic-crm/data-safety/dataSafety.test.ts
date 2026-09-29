import { describe, expect, it } from "vitest";

import {
  applyArchivedFilter,
  attachmentPath,
  cardCounterStart,
  isSignedUrl,
  nextCardNumber,
  operationLocked,
  patientHasHistory,
} from "./dataSafety";

const params = (filter: Record<string, unknown>) => ({
  filter,
  pagination: { page: 1, perPage: 25 },
  sort: { field: "id", order: "ASC" as const },
});

describe("the patient archive filter", () => {
  it("hides archived patients by default", () => {
    expect(applyArchivedFilter(params({ q: "Иван" })).filter).toEqual({
      q: "Иван",
      "archived_at@is": null,
    });
  });
  it("shows the archive when asked", () => {
    expect(applyArchivedFilter(params({ archived: true })).filter).toEqual({
      "archived_at@not.is": null,
    });
    expect(applyArchivedFilter(params({ archived: "true" })).filter).toEqual({
      "archived_at@not.is": null,
    });
  });
  it("shows everybody with «all», an explicit filter or ids", () => {
    expect(applyArchivedFilter(params({ archived: "all" })).filter).toEqual({});
    expect(
      applyArchivedFilter(params({ "archived_at@gte": "2026-01-01" })).filter,
    ).toEqual({ "archived_at@gte": "2026-01-01" });
    expect(applyArchivedFilter(params({ id: [1, 2] })).filter).toEqual({
      id: [1, 2],
    });
  });
});

describe("attachment paths", () => {
  const bucket = "attachments";
  it("reads the path first", () => {
    expect(attachmentPath({ path: "7/a.png", src: "x" }, bucket)).toBe(
      "7/a.png",
    );
  });
  it("reads a public URL of the time the bucket was public", () => {
    expect(
      attachmentPath(
        {
          src: "https://x.supabase.co/storage/v1/object/public/attachments/7/0.12%20a.png",
        },
        bucket,
      ),
    ).toBe("7/0.12 a.png");
  });
  it("reads a signed URL without its token", () => {
    const src =
      "https://x.supabase.co/storage/v1/object/sign/attachments/7/b.pdf?token=abc";
    expect(attachmentPath({ src }, bucket)).toBe("7/b.pdf");
    expect(isSignedUrl(src)).toBe(true);
    expect(
      isSignedUrl(
        "https://x.supabase.co/storage/v1/object/public/attachments/7/b.pdf",
      ),
    ).toBe(false);
  });
  it("ignores files elsewhere", () => {
    expect(attachmentPath({ src: "data:image/png;base64,AAA" }, bucket)).toBe(
      null,
    );
    expect(
      attachmentPath(
        { src: "https://x.supabase.co/storage/v1/object/public/other/7/a" },
        bucket,
      ),
    ).toBe(null);
    expect(attachmentPath(null, bucket)).toBe(null);
  });
});

describe("closed cash shifts", () => {
  const shifts = [
    { id: 1, closed_at: "2026-09-28T15:00:00Z" },
    { id: 2, closed_at: null },
  ];
  it("locks the operations of a closed shift only", () => {
    expect(operationLocked({ shift_id: 1 }, shifts)).toBe(true);
    expect(operationLocked({ shift_id: 2 }, shifts)).toBe(false);
    expect(operationLocked({ shift_id: null }, shifts)).toBe(false);
    expect(operationLocked(null, shifts)).toBe(false);
  });
});

describe("what keeps a patient from being deleted", () => {
  it("money, visits and medical rows; payments through the deals", () => {
    expect(patientHasHistory(1, {})).toBe(false);
    expect(patientHasHistory(1, { visits: [{ patient_id: 2 }] })).toBe(false);
    expect(patientHasHistory(1, { visits: [{ patient_id: 1 }] })).toBe(true);
    expect(patientHasHistory(1, { patient_teeth: [{ patient_id: "1" }] })).toBe(
      true,
    );
    expect(
      patientHasHistory(1, { deal_payments: [{ deal_id: 10 }] }, [10]),
    ).toBe(true);
    expect(
      patientHasHistory(1, { deal_payments: [{ deal_id: 10 }] }, [11]),
    ).toBe(false);
  });
});

describe("card numbers", () => {
  it("continue the counter and skip the numbers in use", () => {
    expect(nextCardNumber(0, [])).toEqual({ number: "1", counter: 1 });
    expect(nextCardNumber(3, ["4", "5", "A-7"])).toEqual({
      number: "6",
      counter: 6,
    });
  });
  it("start after the highest numeric card number", () => {
    expect(cardCounterStart(["12", "A-15", null, "1024"])).toBe(1024);
    expect(cardCounterStart([])).toBe(0);
  });
});
