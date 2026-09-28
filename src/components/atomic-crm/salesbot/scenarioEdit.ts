import type { Scenario, Step, StepType } from "./types";

/**
 * Editing a scenario as a vertical flow: the layout (a chain of steps from
 * the start, the branches of a wait or a condition side by side) and the
 * operations of the editor (insert between two steps, delete, duplicate).
 * Pure functions, the scenario is never mutated.
 */

/** A slot of a step pointing at the next one */
export type Slot =
  | { kind: "next" }
  | { kind: "timeout_next" }
  | { kind: "else_next" }
  | { kind: "branch"; index: number };

/** Where a new step goes: first step, after a step, or into a slot */
export type Anchor =
  | { kind: "start" }
  | { kind: "slot"; stepId: string; slot: Slot };

export const isBranching = (type: StepType) =>
  type === "wait_reply" || type === "condition";
export const isTerminal = (type: StepType) =>
  type === "handoff" || type === "stop";

export const slotTarget = (step: Step, slot: Slot): string | null => {
  switch (slot.kind) {
    case "next":
      return step.next ?? null;
    case "timeout_next":
      return step.timeout_next ?? null;
    case "else_next":
      return step.else_next ?? null;
    case "branch":
      return step.branches?.[slot.index]?.next ?? null;
  }
};

const withSlot = (step: Step, slot: Slot, target: string | null): Step => {
  switch (slot.kind) {
    case "next":
      return { ...step, next: target };
    case "timeout_next":
      return { ...step, timeout_next: target };
    case "else_next":
      return { ...step, else_next: target };
    case "branch":
      return {
        ...step,
        branches: (step.branches ?? []).map((branch, index) =>
          index === slot.index ? { ...branch, next: target } : branch,
        ),
      };
  }
};

/** The slots of a step, in display order */
export const stepSlots = (step: Step): Slot[] => {
  switch (step.type) {
    case "wait_reply":
      return [{ kind: "next" }, { kind: "timeout_next" }];
    case "condition":
      return [
        ...(step.branches ?? []).map(
          (_, index): Slot => ({ kind: "branch", index }),
        ),
        { kind: "else_next" },
      ];
    case "handoff":
    case "stop":
      return [];
    default:
      return [{ kind: "next" }];
  }
};

/** Every id a step points at */
export const stepTargets = (step: Step) =>
  stepSlots(step)
    .map((slot) => slotTarget(step, slot))
    .filter((target): target is string => !!target);

/** A fresh id: s1, s2… */
export const newStepId = (scenario: Scenario) => {
  const used = new Set(scenario.steps.map((step) => step.id));
  let n = scenario.steps.length + 1;
  while (used.has(`s${n}`)) n++;
  return `s${n}`;
};

/** A new step with sensible defaults */
export const createStep = (type: StepType, id: string): Step => {
  switch (type) {
    case "send_message":
      return { id, type, text: "", buttons: [], next: null };
    case "wait_reply":
      return { id, type, timeout_minutes: 60, next: null, timeout_next: null };
    case "condition":
      return {
        id,
        type,
        branches: [{ match: "keywords", value: "", next: null }],
        else_next: null,
      };
    case "set":
      return {
        id,
        type,
        actions: [{ kind: "tag_add", tag_id: null }],
        next: null,
      };
    case "create_task":
      return {
        id,
        type,
        task_type: "call",
        text: "",
        due_minutes: 30,
        next: null,
      };
    case "handoff":
      return { id, type, text: "", create_task: false };
    case "webhook":
      return { id, type, webhook_id: null, next: null };
    case "delay":
      return { id, type, minutes: 10, next: null };
    case "stop":
      return { id, type };
  }
};

const replaceStep = (scenario: Scenario, step: Step): Scenario => ({
  ...scenario,
  steps: scenario.steps.map((s) => (s.id === step.id ? step : s)),
});

/** Where the flow of the new step continues: its main slot */
const mainSlot = (type: StepType): Slot | null =>
  type === "condition"
    ? { kind: "else_next" }
    : isTerminal(type)
      ? null
      : { kind: "next" };

/**
 * Inserts a new step at an anchor: what the anchor pointed at follows the
 * new step (through its main slot; a terminal step drops the rest of the
 * chain from this path).
 */
export const insertStep = (
  scenario: Scenario,
  anchor: Anchor,
  type: StepType,
): { scenario: Scenario; id: string } => {
  const id = newStepId(scenario);
  const previousTarget =
    anchor.kind === "start"
      ? scenario.start
      : slotTarget(
          scenario.steps.find((s) => s.id === anchor.stepId)!,
          anchor.slot,
        );
  let step = createStep(type, id);
  const slot = mainSlot(type);
  if (slot && previousTarget) step = withSlot(step, slot, previousTarget);
  let result: Scenario = { ...scenario, steps: [...scenario.steps, step] };
  if (anchor.kind === "start") {
    result = { ...result, start: id };
  } else {
    const parent = result.steps.find((s) => s.id === anchor.stepId)!;
    result = replaceStep(result, withSlot(parent, anchor.slot, id));
  }
  return { scenario: result, id };
};

/** Points a slot of a step at another step (or nowhere) */
export const linkSlot = (
  scenario: Scenario,
  stepId: string,
  slot: Slot,
  target: string | null,
): Scenario => {
  const step = scenario.steps.find((s) => s.id === stepId);
  return step ? replaceStep(scenario, withSlot(step, slot, target)) : scenario;
};

/**
 * Removes a step: what pointed at it now points where it went (a linear
 * step), or nowhere (a branching or terminal step).
 */
export const removeStep = (scenario: Scenario, stepId: string): Scenario => {
  const removed = scenario.steps.find((s) => s.id === stepId);
  if (!removed) return scenario;
  const follow =
    isBranching(removed.type) || isTerminal(removed.type)
      ? null
      : (removed.next ?? null);
  const steps = scenario.steps
    .filter((s) => s.id !== stepId)
    .map((step) =>
      stepSlots(step).reduce(
        (current, slot) =>
          slotTarget(current, slot) === stepId
            ? withSlot(current, slot, follow)
            : current,
        step,
      ),
    );
  return {
    start: scenario.start === stepId ? follow : scenario.start,
    steps,
  };
};

/** A copy of a step right after it (a linear step) or next to it */
export const duplicateStep = (
  scenario: Scenario,
  stepId: string,
): { scenario: Scenario; id: string } => {
  const original = scenario.steps.find((s) => s.id === stepId);
  if (!original) return { scenario, id: stepId };
  const id = newStepId(scenario);
  const copy: Step = structuredClone({ ...original, id });
  let steps = [...scenario.steps, copy];
  if (!isBranching(original.type) && !isTerminal(original.type)) {
    steps = steps.map((s) => (s.id === stepId ? { ...s, next: id } : s));
  }
  return { scenario: { ...scenario, steps }, id };
};

export const updateStep = (scenario: Scenario, step: Step): Scenario =>
  replaceStep(scenario, step);

// --- layout ----------------------------------------------------------------

export type FlowItem =
  | { kind: "step"; step: Step; columns: FlowColumn[] }
  /** Points at a step shown elsewhere (a loop, a merge) */
  | { kind: "jump"; target: string }
  /** Points at no step: the scenario ends here */
  | { kind: "end" }
  /** Points at an id that does not exist */
  | { kind: "missing"; target: string };

export type FlowColumn = { stepId: string; slot: Slot; items: FlowItem[] };

/**
 * The flow of the editor: the chain from the start; a wait or a condition
 * ends its chain with one column per slot. A step reached twice is drawn
 * once, the other paths show a jump. Steps not reachable from the start
 * are returned apart.
 */
export const buildFlow = (
  scenario: Scenario,
): { items: FlowItem[]; orphans: Step[] } => {
  const byId = new Map(scenario.steps.map((step) => [step.id, step]));
  const seen = new Set<string>();
  const chain = (from: string | null | undefined): FlowItem[] => {
    const items: FlowItem[] = [];
    let id = from ?? null;
    while (id) {
      if (seen.has(id)) {
        items.push({ kind: "jump", target: id });
        return items;
      }
      const step = byId.get(id);
      if (!step) {
        items.push({ kind: "missing", target: id });
        return items;
      }
      seen.add(id);
      if (isBranching(step.type)) {
        const columns = stepSlots(step).map((slot) => ({
          stepId: step.id,
          slot,
          items: chain(slotTarget(step, slot)),
        }));
        items.push({ kind: "step", step, columns });
        return items;
      }
      items.push({ kind: "step", step, columns: [] });
      if (isTerminal(step.type)) return items;
      id = step.next ?? null;
    }
    items.push({ kind: "end" });
    return items;
  };
  const items = chain(scenario.start);
  return {
    items,
    orphans: scenario.steps.filter((step) => !seen.has(step.id)),
  };
};
