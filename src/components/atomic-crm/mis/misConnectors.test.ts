import { describe, expect, it } from "vitest";

import type { Stage } from "../types";
import {
  defaultStatusMap,
  isMisConnected,
  isMisKind,
  logOperationKey,
  mappableStages,
  misWebhookUrl,
  parseTargetValue,
  targetValue,
  withTarget,
} from "./misConnectors";

const stage = (
  id: number,
  name: string,
  position: number,
  kind: Stage["kind"] = "open",
): Stage => ({ id, name, position, kind, pipeline_id: 1, color: "#fff" });

const stages = [
  stage(1, "Новый лид", 0),
  stage(3, "Записан", 2),
  stage(4, "Пришёл на консультацию", 3),
  stage(6, "В лечении", 5),
  stage(7, "Лечение завершено", 6, "won"),
  stage(8, "Отказ", 7, "lost"),
];

describe("MIS connectors", () => {
  it("builds the webhook address", () => {
    expect(
      misWebhookUrl("https://x.supabase.co/functions/v1/", "macdent", "t k"),
    ).toBe(
      "https://x.supabase.co/functions/v1/mis_webhook?kind=macdent&token=t%20k",
    );
  });

  it("knows the kinds and the connected states", () => {
    expect(isMisKind("dentist_plus")).toBe(true);
    expect(isMisKind("ident")).toBe(false);
    expect(isMisConnected({ status: "connected" })).toBe(true);
    expect(isMisConnected({ status: "error" })).toBe(true);
    expect(isMisConnected({ status: "requested" })).toBe(false);
    expect(isMisConnected(null)).toBe(false);
  });

  it("reads and writes the values of the mapping table", () => {
    expect(targetValue({ stage_id: 3 })).toBe("stage:3");
    expect(targetValue({ tag_id: 9 })).toBe("tag:9");
    expect(targetValue(undefined)).toBe("");
    expect(parseTargetValue("stage:3")).toEqual({ stage_id: 3 });
    expect(parseTargetValue("tag:9")).toEqual({ tag_id: 9 });
    expect(parseTargetValue("")).toBeNull();
    const map = withTarget(
      { scheduled: { stage_id: 3 } },
      "cancelled",
      "tag:9",
    );
    expect(map).toEqual({
      scheduled: { stage_id: 3 },
      cancelled: { tag_id: 9 },
    });
    expect(withTarget(map, "scheduled", "")).toEqual({
      cancelled: { tag_id: 9 },
    });
  });

  it("offers every stage but the refusals", () => {
    expect(mappableStages(stages).map((s) => s.name)).toEqual([
      "Новый лид",
      "Записан",
      "Пришёл на консультацию",
      "В лечении",
      "Лечение завершено",
    ]);
  });

  it("suggests the mapping of the clinic template", () => {
    expect(defaultStatusMap(stages)).toEqual({
      scheduled: { stage_id: 3 },
      confirmed: { stage_id: 3 },
      arrived: { stage_id: 4 },
      completed: { stage_id: 4 },
      in_treatment: { stage_id: 6 },
    });
    expect(defaultStatusMap([])).toEqual({});
  });

  it("names the log operations it knows", () => {
    expect(logOperationKey("payment")).toBe(
      "mis_connectors.log.operations.payment",
    );
    expect(logOperationKey("something")).toBeNull();
  });
});
