import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import {
  useCreate,
  useDataProvider,
  useDelete,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { useDoctors } from "../dictionaries/useDictionaries";
import type { CrmDataProvider } from "../providers/types";
import type { Chair } from "../schedule/types";
import { useChairs } from "../schedule/useSchedule";
import {
  explainError,
  moveItem,
  useDictionaryMutations,
} from "../settings/useDictionaryMutations";
import type { MessengerChannel, Sale } from "../types";
import { transportLabelKey } from "../messages/transportLabel";
import { activeBranches, branchesEnabled, type Branch } from "./branches";
import { useBranches, useSalesBranches } from "./useBranches";

const SELECT_CLASS =
  "h-8 rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Settings → «Филиалы» (stage 33): the branches of the clinic (name,
 * address, phone, order, active switch), who works where, the branch of the
 * doctors, chairs and channels, and «Привязать к филиалу» for the deals and
 * visits without a branch. The owner and the head.
 */
export const BranchesSettings = () => {
  const translate = useTranslate();
  const { branches } = useBranches();
  return (
    <div className="flex flex-col gap-8">
      <BranchList branches={branches} />
      {branches.length > 0 ? (
        <>
          {!branchesEnabled(branches) ? (
            <p className="text-sm text-muted-foreground">
              {translate("branches.settings.single_hint")}
            </p>
          ) : null}
          <StaffMatrix branches={branches} />
          <ResourceBranches branches={branches} />
          <ChannelBranches branches={branches} />
          <AssignUnassigned branches={branches} />
        </>
      ) : null}
    </div>
  );
};

const Block = ({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <section className="flex flex-col gap-3">
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
    {children}
  </section>
);

/** The dictionary: name, address, phone, order, active, delete */
const BranchList = ({ branches }: { branches: Branch[] }) => {
  const translate = useTranslate();
  const { create, update, remove } = useDictionaryMutations("branches", {
    inUseMessage: "branches.settings.in_use",
  });
  const [name, setName] = useState("");
  const sorted = [...branches].sort(
    (a, b) => a.position - b.position || Number(a.id) - Number(b.id),
  );
  const add = () => {
    if (!name.trim()) return;
    create({
      name: name.trim(),
      is_active: true,
      position: (sorted.at(-1)?.position ?? -1) + 1,
    });
    setName("");
  };
  const saveText = (
    branch: Branch,
    field: "name" | "address" | "phone",
    raw: string,
  ) => {
    const value = raw.trim();
    if (field === "name" && !value) return;
    if (value === (branch[field] ?? "")) return;
    update(branch, { [field]: value || null });
  };

  return (
    <Block
      title={translate("branches.settings.list")}
      hint={translate("branches.settings.list_hint")}
    >
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("branches.settings.empty")}
        </p>
      ) : null}
      {sorted.map((branch, index) => (
        <div
          key={branch.id}
          className="flex items-center gap-2"
          data-branch-id={branch.id}
        >
          <div className="flex">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={index === 0}
              onClick={() =>
                moveItem(sorted, branch.id, -1).forEach(([record, position]) =>
                  update(record, { position }),
                )
              }
              aria-label={translate("crm.settings.move_up")}
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={index === sorted.length - 1}
              onClick={() =>
                moveItem(sorted, branch.id, 1).forEach(([record, position]) =>
                  update(record, { position }),
                )
              }
              aria-label={translate("crm.settings.move_down")}
            >
              <ArrowDown className="size-4" />
            </Button>
          </div>
          <Input
            defaultValue={branch.name}
            key={`${branch.id}-name-${branch.name}`}
            aria-label={translate("branches.settings.name")}
            onBlur={(event) => saveText(branch, "name", event.target.value)}
            className={branch.is_active ? undefined : "text-muted-foreground"}
          />
          <Input
            defaultValue={branch.address ?? ""}
            key={`${branch.id}-address-${branch.address ?? ""}`}
            aria-label={translate("branches.settings.address")}
            placeholder={translate("branches.settings.address")}
            onBlur={(event) => saveText(branch, "address", event.target.value)}
          />
          <Input
            defaultValue={branch.phone ?? ""}
            key={`${branch.id}-phone-${branch.phone ?? ""}`}
            aria-label={translate("branches.settings.phone")}
            placeholder={translate("branches.settings.phone")}
            onBlur={(event) => saveText(branch, "phone", event.target.value)}
            className="max-w-44"
          />
          <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
            <Switch
              checked={branch.is_active}
              onCheckedChange={(checked) =>
                update(branch, { is_active: checked })
              }
              aria-label={translate("branches.settings.active")}
            />
            {translate("branches.settings.active")}
          </label>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => remove(branch)}
            aria-label={translate("ra.action.delete")}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <div className="mt-1 flex items-center gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && add()}
          placeholder={translate("branches.settings.new_name")}
          aria-label={translate("branches.settings.new_name")}
          className="max-w-80"
        />
        <Button onClick={add} disabled={!name.trim()} variant="outline">
          {translate("branches.settings.add")}
        </Button>
      </div>
    </Block>
  );
};

/** Who works where: employees × branches */
const StaffMatrix = ({ branches }: { branches: Branch[] }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const shown = activeBranches(branches);
  const { rows } = useSalesBranches();
  const { data: sales = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "last_name", order: "ASC" },
    filter: { "disabled@neq": true },
  });
  const staff = sales.filter(
    (sale) => sale.role === "manager" || sale.role === "head",
  );
  const [create] = useCreate();
  const [remove] = useDelete();
  const options = {
    mutationMode: "pessimistic" as const,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales_branches"] });
    },
    onError: (error: unknown) => notify(explainError(error), { type: "error" }),
  };
  const toggle = (salesId: Identifier, branchId: Identifier, on: boolean) => {
    const row = rows.find(
      (r) =>
        String(r.sales_id) === String(salesId) &&
        String(r.branch_id) === String(branchId),
    );
    if (on && !row) {
      create(
        "sales_branches",
        { data: { sales_id: salesId, branch_id: branchId } },
        options,
      );
    } else if (!on && row) {
      remove("sales_branches", { id: row.id, previousData: row }, options);
    }
  };

  return (
    <Block
      title={translate("branches.settings.staff")}
      hint={translate("branches.settings.staff_hint")}
    >
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 pr-4 font-medium">
                {translate("branches.settings.employee")}
              </th>
              {shown.map((branch) => (
                <th key={branch.id} className="px-3 py-1 font-medium">
                  {branch.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map((sale) => (
              <tr key={sale.id} className="border-t border-border">
                <td className="py-1.5 pr-4">
                  {sale.first_name} {sale.last_name}
                </td>
                {shown.map((branch) => {
                  const checked = rows.some(
                    (r) =>
                      String(r.sales_id) === String(sale.id) &&
                      String(r.branch_id) === String(branch.id),
                  );
                  return (
                    <td key={branch.id} className="px-3 py-1.5 text-center">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) =>
                          toggle(sale.id, branch.id, value === true)
                        }
                        aria-label={`${sale.first_name} ${sale.last_name} · ${branch.name}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  );
};

/** A branch picker: «Все филиалы» (null) or a branch */
const BranchPicker = ({
  branches,
  value,
  label,
  onChange,
}: {
  branches: Branch[];
  value: Identifier | null | undefined;
  label: string;
  onChange: (value: Identifier | null) => void;
}) => {
  const translate = useTranslate();
  return (
    <select
      className={SELECT_CLASS}
      aria-label={label}
      value={value == null ? "" : String(value)}
      onChange={(event) => {
        const branch = branches.find(
          (b) => String(b.id) === event.target.value,
        );
        onChange(branch ? branch.id : null);
      }}
    >
      <option value="">{translate("branches.settings.all_branches")}</option>
      {branches
        .filter((b) => b.is_active || String(b.id) === String(value))
        .map((branch) => (
          <option key={branch.id} value={String(branch.id)}>
            {branch.name}
          </option>
        ))}
    </select>
  );
};

/** The branch of the doctors and of the chairs (null: every branch) */
const ResourceBranches = ({ branches }: { branches: Branch[] }) => {
  const translate = useTranslate();
  const { data: doctors } = useDoctors();
  const { data: chairs } = useChairs();
  const doctorMutations = useDictionaryMutations("doctors");
  const chairMutations = useDictionaryMutations("chairs");
  const active = <T extends { is_active: boolean }>(items: T[]) =>
    items.filter((item) => item.is_active);
  return (
    <Block
      title={translate("branches.settings.resources")}
      hint={translate("branches.settings.resources_hint")}
    >
      <div className="grid grid-cols-1 gap-x-8 gap-y-2 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {translate("branches.settings.doctors")}
          </p>
          {active(doctors).map((doctor) => (
            <div
              key={doctor.id}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="truncate">{doctor.name}</span>
              <BranchPicker
                branches={branches}
                value={doctor.branch_id}
                label={doctor.name}
                onChange={(branch_id) =>
                  doctorMutations.update(doctor, { branch_id })
                }
              />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {translate("branches.settings.chairs")}
          </p>
          {active<Chair>(chairs).map((chair) => (
            <div
              key={chair.id}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="truncate">{chair.name}</span>
              <BranchPicker
                branches={branches}
                value={chair.branch_id}
                label={chair.name}
                onChange={(branch_id) =>
                  chairMutations.update(chair, { branch_id })
                }
              />
            </div>
          ))}
        </div>
      </div>
    </Block>
  );
};

/**
 * Where new leads land: the messenger channels, the website forms (a
 * `branch` field) and the telephony (the branch's phone number)
 */
const ChannelBranches = ({ branches }: { branches: Branch[] }) => {
  const translate = useTranslate();
  const { data: channels = [] } = useGetList<MessengerChannel>(
    "messenger_channels",
    {
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
    },
  );
  const { update } = useDictionaryMutations("messenger_channels");
  return (
    <Block
      title={translate("branches.settings.leads")}
      hint={translate("branches.settings.leads_hint")}
    >
      {channels.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("branches.settings.no_channels")}
        </p>
      ) : (
        <div className="flex max-w-xl flex-col gap-1.5">
          {channels.map((channel) => (
            <div
              key={channel.id}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="truncate">
                {translate(transportLabelKey(channel.transport))} ·{" "}
                {channel.name || channel.external_id}
              </span>
              <BranchPicker
                branches={branches}
                value={channel.branch_id}
                label={channel.name || channel.external_id}
                onChange={(branch_id) => update(channel, { branch_id })}
              />
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {translate("branches.settings.forms_hint")}
      </p>
      <p className="text-xs text-muted-foreground">
        {translate("branches.settings.calls_hint")}
      </p>
    </Block>
  );
};

/** «Привязать к филиалу»: the deals and visits without a branch */
const AssignUnassigned = ({ branches }: { branches: Branch[] }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const shown = activeBranches(branches);
  const [target, setTarget] = useState<Identifier | null>(null);
  const chosen = target ?? shown[0]?.id ?? null;
  const { mutate, isPending } = useMutation({
    mutationFn: (branchId: Identifier) =>
      dataProvider.assignBranchToUnassigned(branchId),
    onSuccess: (result) => {
      notify("branches.settings.assigned", {
        messageArgs: { deals: result.deals, visits: result.visits },
      });
      queryClient.invalidateQueries();
    },
    onError: (error) => notify(explainError(error), { type: "error" }),
  });
  if (shown.length === 0) return null;
  return (
    <Block
      title={translate("branches.settings.assign")}
      hint={translate("branches.settings.assign_hint")}
    >
      <div className="flex items-center gap-2">
        <select
          className={SELECT_CLASS}
          aria-label={translate("branches.settings.assign")}
          value={chosen == null ? "" : String(chosen)}
          onChange={(event) => {
            const branch = shown.find(
              (b) => String(b.id) === event.target.value,
            );
            setTarget(branch ? branch.id : null);
          }}
        >
          {shown.map((branch) => (
            <option key={branch.id} value={String(branch.id)}>
              {branch.name}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          disabled={chosen == null || isPending}
          onClick={() => {
            if (
              chosen != null &&
              window.confirm(translate("branches.settings.assign_confirm"))
            ) {
              mutate(chosen);
            }
          }}
        >
          {translate("branches.settings.assign_button")}
        </Button>
      </div>
    </Block>
  );
};
