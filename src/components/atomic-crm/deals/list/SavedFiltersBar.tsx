import { Building2, User, X } from "lucide-react";
import {
  useCreate,
  useDelete,
  useGetIdentity,
  useGetList,
  useListFilterContext,
  useNotify,
  useTranslate,
} from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import {
  deserializeFilter,
  displayedFiltersOf,
  FILTER_PRESETS,
  isSameFilter,
  serializeFilter,
  type FilterValues,
  type SavedFilter,
} from "./dealFilters";
import { useIsAdmin } from "./useIsAdmin";

const hasValues = (values: FilterValues) =>
  Object.values(values).some(
    (value) =>
      value !== undefined &&
      value !== null &&
      value !== "" &&
      !(Array.isArray(value) && !value.length),
  );

/**
 * «Сохранённые фильтры» of the deals (amoCRM's left panel), on the board and
 * in the list: the built-in presets, the clinic filters and my own. A click
 * applies a filter, a second click clears it; the current filters can be
 * saved under a name, for me or (owner, head) for the whole clinic.
 */
export const SavedFiltersBar = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const { identity } = useGetIdentity();
  const isAdmin = useIsAdmin();
  const { filterValues, setFilters } = useListFilterContext();
  const [saving, setSaving] = useState(false);
  const { data: saved = [] } = useGetList<SavedFilter>("saved_filters", {
    filter: { resource: "deals" },
    sort: { field: "position", order: "ASC" },
    pagination: { page: 1, perPage: 100 },
  });
  const [deleteOne] = useDelete<SavedFilter>();
  const context = { me: identity?.id ?? null, now: new Date() };
  const current = (filterValues ?? {}) as FilterValues;

  const apply = (filter: FilterValues) => {
    if (isSameFilter(filter, current, context)) {
      setFilters({}, {});
      return;
    }
    const values = deserializeFilter(filter, context);
    setFilters(values, displayedFiltersOf(values));
  };

  const matches = (filter: FilterValues) =>
    hasValues(current) && isSameFilter(filter, current, context);
  const canSave =
    hasValues(current) &&
    !FILTER_PRESETS.some((preset) => matches(preset.filter)) &&
    !saved.some((filter) => matches(filter.filter));
  const canDelete = (filter: SavedFilter) =>
    filter.sales_id == null
      ? isAdmin
      : String(filter.sales_id) === String(identity?.id);
  const clinic = saved.filter((filter) => filter.sales_id == null);
  const mine = saved.filter((filter) => filter.sales_id != null);

  return (
    <nav
      className="mb-3 flex flex-wrap items-center gap-1.5"
      aria-label={translate("deal_list.saved.title")}
    >
      <span className="mr-1 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {translate("deal_list.saved.title")}
      </span>
      {FILTER_PRESETS.map((preset) => (
        <Chip
          key={preset.id}
          active={matches(preset.filter)}
          onClick={() => apply(preset.filter)}
        >
          {translate(`deal_list.presets.${preset.id}`)}
        </Chip>
      ))}
      {[...clinic, ...mine].map((filter) => (
        <Chip
          key={filter.id}
          active={matches(filter.filter)}
          onClick={() => apply(filter.filter)}
          title={translate(
            filter.sales_id == null
              ? "deal_list.saved.clinic"
              : "deal_list.saved.personal",
          )}
          icon={
            filter.sales_id == null ? (
              <Building2 className="size-3" />
            ) : (
              <User className="size-3" />
            )
          }
          onRemove={
            canDelete(filter)
              ? () =>
                  deleteOne(
                    "saved_filters",
                    { id: filter.id, previousData: filter },
                    {
                      onSuccess: () =>
                        notify("deal_list.saved.deleted", { type: "info" }),
                      onError: (error) =>
                        notify((error as Error)?.message, { type: "error" }),
                    },
                  )
              : undefined
          }
          removeLabel={translate("deal_list.saved.delete", {
            name: filter.name,
          })}
        >
          {filter.name}
        </Chip>
      ))}
      {canSave ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 rounded-md px-2 text-xs"
          onClick={() => setSaving(true)}
        >
          {translate("deal_list.saved.save")}
        </Button>
      ) : null}
      <SaveFilterDialog
        open={saving}
        onClose={() => setSaving(false)}
        canShare={isAdmin}
        filter={serializeFilter(current, context)}
        position={saved.length}
      />
    </nav>
  );
};

const Chip = ({
  active,
  onClick,
  children,
  icon,
  title,
  onRemove,
  removeLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  title?: string;
  onRemove?: () => void;
  removeLabel?: string;
}) => (
  <span
    className={cn(
      "group inline-flex h-7 items-center rounded-md border text-xs font-medium transition-colors",
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border bg-card text-foreground hover:border-primary/50",
    )}
  >
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className="inline-flex h-full items-center gap-1 px-2.5"
    >
      {icon}
      {children}
    </button>
    {onRemove ? (
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className={cn(
          "mr-1 hidden rounded-sm p-0.5 group-hover:inline-flex",
          active ? "hover:bg-primary-foreground/20" : "hover:bg-muted",
        )}
      >
        <X className="size-3" />
      </button>
    ) : null}
  </span>
);

const SaveFilterDialog = ({
  open,
  onClose,
  canShare,
  filter,
  position,
}: {
  open: boolean;
  onClose: () => void;
  canShare: boolean;
  filter: FilterValues;
  position: number;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const { identity } = useGetIdentity();
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [create, { isPending }] = useCreate();

  const save = () =>
    create(
      "saved_filters",
      {
        data: {
          name: name.trim(),
          resource: "deals",
          filter,
          position,
          sales_id: canShare && shared ? null : (identity?.id ?? null),
        },
      },
      {
        onSuccess: () => {
          notify("deal_list.saved.created", { type: "info" });
          setName("");
          setShared(false);
          onClose();
        },
        onError: (error) =>
          notify((error as Error)?.message || "ra.notification.http_error", {
            type: "error",
          }),
      },
    );

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{translate("deal_list.saved.dialog_title")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) save();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="saved-filter-name">
              {translate("deal_list.saved.name")}
            </Label>
            <Input
              id="saved-filter-name"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {canShare ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id="saved-filter-shared"
                checked={shared}
                onCheckedChange={(checked) => setShared(checked === true)}
              />
              <Label htmlFor="saved-filter-shared">
                {translate("deal_list.saved.for_clinic")}
              </Label>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {translate("ra.action.cancel")}
            </Button>
            <Button type="submit" disabled={!name.trim() || isPending}>
              {translate("ra.action.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
