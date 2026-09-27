import { transformContainsFilter } from "./transformContainsFilter";
import { transformInFilter } from "./transformInFilter";
import { transformOrFilter } from "./transformOrFilter";

export function transformFilter(filter: Record<string, any>) {
  if (!filter) {
    return undefined;
  }
  const transformedFilters: Record<string, any> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (
      key.endsWith("@eq") ||
      key.endsWith("@neq") ||
      key.endsWith("@lt") ||
      key.endsWith("@lte") ||
      key.endsWith("@gt") ||
      key.endsWith("@gte")
    ) {
      const lastIndexOfAt = key.lastIndexOf("@");
      transformedFilters[
        `${key.substring(0, lastIndexOfAt)}_${key.substring(lastIndexOfAt + 1)}`
      ] = value;
      continue;
    }

    if (key.endsWith("@is")) {
      transformedFilters[`${key.slice(0, -3)}_eq`] = value;
      continue;
    }

    if (key.endsWith("@not.is")) {
      transformedFilters[`${key.slice(0, -7)}_neq`] = value;
      continue;
    }

    if (key.endsWith("@in")) {
      transformedFilters[`${key.slice(0, -3)}_eq_any`] =
        transformInFilter(value);
      continue;
    }

    if (key.endsWith("@cs")) {
      // jsonb containment (custom_values@cs '{"12":"Инстаграм"}'): FakeRest
      // matches an object value partially, like @>
      const object = parseJsonObject(value);
      transformedFilters[`${key.slice(0, -3)}`] =
        object ?? transformContainsFilter(value);
      continue;
    }

    // Search query
    if (key.endsWith("@or")) {
      transformedFilters["q"] = transformOrFilter(value);
      continue;
    }

    transformedFilters[key] = value;
  }
  return transformedFilters;
}

/** '{"12":"a","15":true}' → the object; anything else (array literals) → null */
const parseJsonObject = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "string" || !/^\{\s*"[^"]*"\s*:/.test(value)) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
};
