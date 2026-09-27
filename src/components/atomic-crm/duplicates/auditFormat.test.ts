import { beforeAll, describe, expect, it } from "vitest";

import {
  auditActionLabel,
  auditSummary,
  type AuditLookups,
} from "../audit/format";
import { i18nProvider } from "../providers/commons/i18nProvider";

const t = (key: string, options?: any) => i18nProvider.translate(key, options);

const lookups: AuditLookups = {
  currency: "KZT",
  sales: [],
  stages: [],
  pipelines: [],
  lostReasons: [],
  doctors: [],
  sources: [
    { id: 1, name: "WhatsApp" },
    { id: 2, name: "Сайт" },
  ],
  services: [],
  tags: [],
};

beforeAll(async () => {
  await i18nProvider.changeLocale("ru");
});

/** The audit rows of stage 18 read as people read them */
describe("audit of stage 18", () => {
  it("shows a merge of patients with both patients", () => {
    const entry = {
      action: "merge",
      changes: {
        merged_patient_id: [12, 7] as [unknown, unknown],
        merged_patient: ["Ахметов Даулет (#12)", "Ахметов Даулет (#7)"] as [
          unknown,
          unknown,
        ],
      },
    };
    expect(auditActionLabel(entry, t)).toBe("Объединение");
    expect(auditSummary(entry, lookups, t)).toBe(
      "Объединён пациент: Ахметов Даулет (#12) → Ахметов Даулет (#7)",
    );
  });
  it("shows the settings of «Неразобранное»", () => {
    expect(
      auditSummary(
        {
          action: "update",
          changes: {
            unsorted_enabled: [false, true],
            unsorted_source_ids: [[], [1, 2]],
          },
        },
        lookups,
        t,
      ),
    ).toBe(
      "Неразобранное: Нет → Да; Источники «Неразобранного»: — → WhatsApp, Сайт",
    );
  });
});
