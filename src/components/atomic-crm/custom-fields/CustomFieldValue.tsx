import type { CustomField, CustomValue } from "../types";
import { useCustomValueText } from "./useCustomFields";

export const CustomFieldValue = ({
  field,
  value,
}: {
  field: CustomField;
  value: CustomValue | null | undefined;
}) => {
  const text = useCustomValueText()(field, value);
  if (text == null) return null;
  if (field.type === "url" && typeof value === "string") {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="text-brand-link hover:underline"
        onClick={(event) => event.stopPropagation()}
      >
        {text}
      </a>
    );
  }
  if (field.type === "phone" && typeof value === "string") {
    return (
      <a
        href={`tel:${value}`}
        className="tabular-nums hover:underline"
        onClick={(event) => event.stopPropagation()}
      >
        {text}
      </a>
    );
  }
  return (
    <span className={field.type === "textarea" ? "whitespace-pre-line" : ""}>
      {text}
    </span>
  );
};
