import type { ReactNode } from "react";
import { useRecordContext } from "ra-core";

/**
 * Renders an edit form once its record is loaded. ra-core's <Form> puts its
 * fields in a record context only when there is a record, so a form shown
 * before would be mounted again when the record arrives: an open list closes
 * and what was typed is lost.
 */
export const RecordReady = ({ children }: { children: ReactNode }) => {
  const record = useRecordContext();
  return record ? <>{children}</> : null;
};
