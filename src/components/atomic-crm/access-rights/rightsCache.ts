import type { MyAccessRights } from "./accessRights";

/**
 * The rights of the signed-in employee, kept for a short while: canAccess is
 * asked many times per screen, the rights change rarely (the database
 * enforces them anyway). One request at a time; cleared on login, logout
 * and after a change of rights.
 */
export const createRightsCache = (
  load: () => Promise<MyAccessRights | null>,
  ttlMs = 30_000,
  now: () => number = Date.now,
) => {
  let cached: { at: number; value: Promise<MyAccessRights | null> } | null =
    null;
  return {
    get(): Promise<MyAccessRights | null> {
      if (cached && now() - cached.at < ttlMs) return cached.value;
      const value = load().catch(() => null);
      cached = { at: now(), value };
      return value;
    },
    clear() {
      cached = null;
    },
  };
};
