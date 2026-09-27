import { useQueryClient } from "@tanstack/react-query";
import {
  useCreate,
  useDelete,
  useNotify,
  useUpdate,
  type Identifier,
  type RaRecord,
} from "ra-core";

/**
 * Create / update / delete for settings screens: pessimistic, errors of the
 * database shown as is (e.g. "a stage with deals cannot be deleted"), and
 * the dictionary caches refreshed everywhere.
 */
export const useDictionaryMutations = (
  resource: string,
  { inUseMessage }: { inUseMessage?: string } = {},
) => {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const [create] = useCreate();
  const [update] = useUpdate();
  const [remove] = useDelete();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [resource] });
    if (resource === "stages") {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
    }
  };
  const onError = (error: any) => {
    const message = explainError(error);
    notify(
      inUseMessage && message === IN_USE_MESSAGE ? inUseMessage : message,
      { type: "error" },
    );
  };
  const options = {
    onSuccess: refresh,
    onError,
    mutationMode: "pessimistic" as const,
  };

  return {
    create: (data: Record<string, unknown>) =>
      create(resource, { data }, options),
    update: (record: RaRecord, data: Record<string, unknown>) =>
      update(resource, { id: record.id, data, previousData: record }, options),
    remove: (record: RaRecord) =>
      remove(resource, { id: record.id, previousData: record }, options),
    refresh,
  };
};

const IN_USE_MESSAGE = "crm.settings.errors.in_use";

/** Human message for the constraint errors of the database */
export const explainError = (error: any): string => {
  const message: string = error?.message ?? "";
  if (/foreign key|violates foreign key|_fkey/i.test(message)) {
    return IN_USE_MESSAGE;
  }
  return message || "ra.notification.http_error";
};

export type WithPosition = RaRecord & { position: number };

/** Swaps an item with its neighbour, returns the two updates to make */
export const moveItem = <T extends WithPosition>(
  items: T[],
  id: Identifier,
  direction: -1 | 1,
): [T, number][] => {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const index = sorted.findIndex((item) => item.id === id);
  const other = sorted[index + direction];
  if (index < 0 || !other) return [];
  const current = sorted[index];
  // Positions may be equal: fall back to the indexes
  const [a, b] =
    current.position === other.position
      ? [index + direction, index]
      : [other.position, current.position];
  return [
    [current, a],
    [other, b],
  ];
};
