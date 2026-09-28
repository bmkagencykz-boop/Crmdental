import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCanAccess,
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useOrganizationSettings } from "../dictionaries/useDictionaries";
import type { CrmDataProvider } from "../providers/types";
import type { Sale } from "../types";
import {
  ACCESS_ACTIONS,
  ACCESS_ENTITIES,
  accessMatrix,
  accessScopes,
  isConfigurable,
  overridesFromMatrix,
  type AccessAction,
  type AccessMatrix,
  type AccessRightsRow,
  type AccessScope,
} from "./accessRights";
import { ACCESS_RIGHTS_KEY, MY_ACCESS_RIGHTS_KEY } from "./useAccessRights";
import { useBranches } from "../branches/useBranches";

type Draft = { matrix: AccessMatrix; settings: boolean };
// Stable empty lists: the draft is reset when its sources change
const NO_SALES: Sale[] = [];
const NO_ROWS: AccessRightsRow[] = [];

const sameDraft = (a: Draft | null, b: Draft | null) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Settings → «Права доступа» (stage 30), like amoCRM: the employees on the
 * left, the matrix of the chosen one on the right (rows: sections; columns:
 * actions; each cell a scope). The owner edits, the head reads.
 */
export const AccessRightsSettings = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { canAccess: canEdit = false } = useCanAccess({
    resource: "access_rights",
    action: "edit",
  });
  const { data: sales = NO_SALES } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "last_name", order: "ASC" },
  });
  const { data: rows = NO_ROWS } = useQuery({
    queryKey: ACCESS_RIGHTS_KEY,
    queryFn: () => dataProvider.getAccessRights(),
  });
  const { data: settings } = useOrganizationSettings();
  const visibility = settings?.manager_deal_visibility ?? "all";

  const staff = sales.filter((sale) => isConfigurable(sale.role));
  const owners = sales.filter((sale) => sale.role === "owner");
  const hasIntegrators = sales.some((sale) => sale.role === "integrator");
  const [selectedId, setSelectedId] = useState<Identifier | null>(null);
  const selected =
    staff.find((sale) => String(sale.id) === String(selectedId)) ?? staff[0];
  const customized = (sale: Sale) =>
    rows.some((row) => String(row.sales_id) === String(sale.id));

  const initial = useMemo<Draft | null>(() => {
    if (!selected) return null;
    const row = rows.find((r) => String(r.sales_id) === String(selected.id));
    return {
      matrix: accessMatrix(selected.role, row?.rights, visibility),
      settings: selected.role === "head",
    };
  }, [selected, rows, visibility]);
  const [draft, setDraft] = useState<Draft | null>(initial);
  useEffect(() => setDraft(initial), [initial]);
  const dirty = !sameDraft(draft, initial);

  const save = useMutation({
    mutationFn: async (value: Draft) => {
      if (!selected) return null;
      const role = value.settings ? "head" : "manager";
      return dataProvider.saveAccessRights(
        selected.id,
        overridesFromMatrix(role, value.matrix, visibility),
        value.settings !== (selected.role === "head") ? value.settings : null,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCESS_RIGHTS_KEY });
      queryClient.invalidateQueries({ queryKey: MY_ACCESS_RIGHTS_KEY });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      notify("access_rights.saved", { type: "info" });
    },
    onError: (error: Error) =>
      notify(error.message || "access_rights.errors.invalid", {
        type: "error",
      }),
  });

  const setCell = (
    entity: keyof AccessMatrix,
    action: string,
    scope: AccessScope,
  ) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            matrix: {
              ...current.matrix,
              [entity]: { ...current.matrix[entity], [action]: scope },
            },
          }
        : current,
    );
  const preset = (role: "head" | "manager") =>
    setDraft((current) =>
      current
        ? { ...current, matrix: accessMatrix(role, null, visibility) }
        : current,
    );

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        {owners.map((o) => `${o.first_name} ${o.last_name}`).join(", ")}
        {owners.length ? " — " : ""}
        {translate("access_rights.owner_note")}
      </p>
      {staff.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("access_rights.empty")}
        </p>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[11rem_minmax(0,1fr)]">
          <nav
            aria-label={translate("access_rights.employees")}
            className="flex flex-col gap-0.5"
          >
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {translate("access_rights.employees")}
            </p>
            {staff.map((sale) => (
              <button
                key={sale.id}
                type="button"
                aria-current={sale.id === selected?.id ? "true" : undefined}
                onClick={() => setSelectedId(sale.id)}
                className={cn(
                  "flex flex-col rounded-sm px-3 py-1.5 text-left text-sm transition-colors",
                  sale.id === selected?.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-[var(--surface-strong)]",
                  sale.disabled && "opacity-60",
                )}
              >
                <span className="font-medium">
                  {sale.first_name} {sale.last_name}
                </span>
                <span
                  className={cn(
                    "text-xs",
                    sale.id === selected?.id
                      ? "text-primary-foreground/80"
                      : "text-muted-foreground",
                  )}
                >
                  {translate(`crm.roles.${sale.role}`)} ·{" "}
                  {translate(
                    customized(sale)
                      ? "access_rights.custom"
                      : "access_rights.by_role",
                  )}
                </span>
              </button>
            ))}
          </nav>
          {selected && draft ? (
            <section
              className="flex min-w-0 flex-col gap-4"
              aria-label={`${translate("access_rights.matrix")}: ${selected.first_name} ${selected.last_name}`}
            >
              {!canEdit ? (
                <p className="text-sm text-muted-foreground">
                  {translate("access_rights.read_only")}
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {translate("access_rights.presets.title")}:
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-sm"
                    onClick={() => preset("head")}
                  >
                    {translate("access_rights.presets.head")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-sm"
                    onClick={() => preset("manager")}
                  >
                    {translate("access_rights.presets.manager")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 rounded-sm"
                    onClick={() => preset(draft.settings ? "head" : "manager")}
                  >
                    {translate("access_rights.presets.reset")}
                  </Button>
                </div>
              )}
              <div className="overflow-x-auto rounded-sm border">
                <table className="w-full min-w-max text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">
                        {translate("access_rights.entity")}
                      </th>
                      {ACCESS_ACTIONS.map((action) => (
                        <th key={action} className="px-2 py-2 font-medium">
                          {translate(`access_rights.actions.${action}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ACCESS_ENTITIES.map((entity) => (
                      <tr key={entity} className="border-b">
                        <th
                          scope="row"
                          className="px-3 py-1 text-left font-medium"
                        >
                          {translate(`access_rights.entities.${entity}`)}
                        </th>
                        {ACCESS_ACTIONS.map((action) => (
                          <td key={action} className="px-1.5 py-1">
                            <ScopeSelect
                              entity={entity}
                              action={action}
                              value={draft.matrix[entity][action]}
                              disabled={!canEdit}
                              onChange={(scope) =>
                                setCell(entity, action, scope)
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className="border-b">
                      <th
                        scope="row"
                        className="px-3 py-1 text-left font-medium"
                      >
                        {translate("access_rights.entities.reports")}
                      </th>
                      <td className="px-1.5 py-1">
                        <ScopeSelect
                          entity="reports"
                          action="view"
                          value={draft.matrix.reports.view}
                          disabled={!canEdit}
                          onChange={(scope) =>
                            setCell("reports", "view", scope)
                          }
                        />
                      </td>
                      <EmptyCells count={ACCESS_ACTIONS.length - 1} />
                    </tr>
                    <tr>
                      <th
                        scope="row"
                        className="px-3 py-1 text-left font-medium"
                        title={translate("access_rights.hints.settings")}
                      >
                        {translate("access_rights.entities.settings")}
                      </th>
                      <td className="px-1.5 py-1">
                        <select
                          className={SELECT_CLASS}
                          aria-label={`${translate("access_rights.entities.settings")} · ${translate("access_rights.actions.view")}`}
                          value={draft.settings ? "yes" : "no"}
                          disabled={!canEdit}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              settings: event.target.value === "yes",
                            })
                          }
                        >
                          <option value="yes">
                            {translate("access_rights.scopes.yes")}
                          </option>
                          <option value="no">
                            {translate("access_rights.scopes.no")}
                          </option>
                        </select>
                      </td>
                      <EmptyCells count={ACCESS_ACTIONS.length - 1} />
                    </tr>
                  </tbody>
                </table>
              </div>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
                <li>{translate("access_rights.hints.own")}</li>
                <li>{translate("access_rights.hints.rows")}</li>
                <li>{translate("access_rights.hints.export")}</li>
                <li>{translate("access_rights.hints.settings")}</li>
                {hasIntegrators ? (
                  <li>{translate("access_rights.integrator_note")}</li>
                ) : null}
              </ul>
              {canEdit ? (
                <div className="flex items-center gap-3">
                  <Button
                    className="rounded-sm"
                    disabled={!dirty || save.isPending}
                    onClick={() => save.mutate(draft)}
                  >
                    {translate("access_rights.save")}
                  </Button>
                  {dirty ? (
                    <span className="text-xs text-muted-foreground">
                      {translate("access_rights.unsaved")}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
};

const SELECT_CLASS =
  "h-7 w-full min-w-[6.25rem] rounded-sm border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70";

/** One cell: Все / Свои… / Запрещено; Да / Нет for create and reports */
const ScopeSelect = ({
  entity,
  action,
  value,
  disabled,
  onChange,
}: {
  entity: keyof AccessMatrix;
  action: AccessAction;
  value: AccessScope;
  disabled: boolean;
  onChange: (scope: AccessScope) => void;
}) => {
  const translate = useTranslate();
  // «Мой филиал» (stage 33): offered from the second branch on
  const { enabled: branchesOn } = useBranches();
  const scopes = (accessScopes(entity, action) ?? []).filter(
    (scope) => scope !== "branch" || branchesOn || value === "branch",
  );
  const binary = scopes.length === 2;
  return (
    <select
      className={cn(SELECT_CLASS, value === "none" && "text-muted-foreground")}
      aria-label={`${translate(`access_rights.entities.${entity}`)} · ${translate(`access_rights.actions.${action}`)}`}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as AccessScope)}
    >
      {scopes.map((scope) => (
        <option key={scope} value={scope}>
          {translate(
            binary
              ? `access_rights.scopes.${scope === "all" ? "yes" : "no"}`
              : scope === "branch"
                ? "branches.scope"
                : `access_rights.scopes.${scope}`,
          )}
        </option>
      ))}
    </select>
  );
};

const EmptyCells = ({ count }: { count: number }) =>
  Array.from({ length: count }, (_, index) => (
    <td key={index} className="px-2 py-1.5 text-center text-muted-foreground">
      —
    </td>
  ));
