import { ChevronDown, ChevronUp, Columns3 } from "lucide-react";
import { useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  DEFAULT_COLUMN_SETTINGS,
  LOCKED_COLUMNS,
  moveColumn,
  toggleColumn,
  type ColumnSettings,
} from "./columns";

/** Column chooser of the deal list: show / hide, move up / down, reset */
export const ColumnsMenu = ({
  settings,
  onChange,
}: {
  settings: ColumnSettings;
  onChange: (settings: ColumnSettings) => void;
}) => {
  const translate = useTranslate();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-md">
          <Columns3 className="size-4" />
          {translate("deal_list.columns_menu.button")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <ul
          className="flex max-h-96 flex-col overflow-y-auto"
          aria-label={translate("deal_list.columns_menu.button")}
        >
          {settings.order.map((column, index) => {
            const label = translate(`deal_list.columns.${column}`);
            const locked = LOCKED_COLUMNS.includes(column);
            return (
              <li
                key={column}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
              >
                <Checkbox
                  id={`deal-column-${column}`}
                  checked={!settings.hidden.includes(column)}
                  disabled={locked}
                  onCheckedChange={() =>
                    onChange(toggleColumn(settings, column))
                  }
                />
                <label
                  htmlFor={`deal-column-${column}`}
                  className="flex-1 truncate text-sm"
                >
                  {label}
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  disabled={index === 0}
                  aria-label={translate("deal_list.columns_menu.up", {
                    name: label,
                  })}
                  onClick={() => onChange(moveColumn(settings, column, -1))}
                >
                  <ChevronUp className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  disabled={index === settings.order.length - 1}
                  aria-label={translate("deal_list.columns_menu.down", {
                    name: label,
                  })}
                  onClick={() => onChange(moveColumn(settings, column, 1))}
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 w-full"
          onClick={() => onChange(DEFAULT_COLUMN_SETTINGS)}
        >
          {translate("deal_list.columns_menu.reset")}
        </Button>
      </PopoverContent>
    </Popover>
  );
};
