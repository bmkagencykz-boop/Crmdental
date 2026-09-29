import {
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { StudioCard } from "../dashboard/StudioCards";
import { useDoctors } from "../dictionaries/useDictionaries";
import { NativeSelect } from "../payments/PaymentDialog";
import type { CrmDataProvider } from "../providers/types";
import type { Sale } from "../types";
import { PlusGlyph } from "./LabBits";
import type { Lab, LabTechnician, LabWorkType } from "./types";
import { useLabDictionaries, useLabRights } from "./useLab";

const same = (a: unknown, b: unknown) =>
  a != null && b != null && String(a) === String(b);

/** Writes a dictionary row and refreshes what reads it */
const useSaveRow = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const notify = useNotify();
  return async (
    resource: string,
    id: Identifier | null,
    data: Record<string, unknown>,
  ) => {
    try {
      if (id == null) {
        await dataProvider.create(resource, { data });
      } else {
        await dataProvider.update(resource, {
          id,
          data,
          previousData: { id },
        });
      }
      await Promise.all(
        [resource, "lab_orders_summary"].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
      return true;
    } catch (error) {
      notify((error as Error).message || "ra.notification.http_error", {
        type: "error",
      });
      return false;
    }
  };
};

/**
 * «Справочники» of the lab (owner, head, integrator): labs (own or
 * external, contacts), technicians, work types with their lab prices (the
 * prices: owner and head), and the doctors' administrators who get the
 * reminders.
 */
export const LabDictionaries = () => {
  const rights = useLabRights();
  return (
    <div
      className="grid grid-cols-1 gap-5 xl:grid-cols-2"
      data-testid="lab-dictionaries"
    >
      <LabsCard />
      <TechniciansCard />
      <WorkTypesCard seesMoney={rights.seesMoney} />
      {rights.seesMoney ? <AdminsCard /> : null}
    </div>
  );
};

const LabsCard = () => {
  const translate = useTranslate();
  const save = useSaveRow();
  const { labs } = useLabDictionaries();
  const [name, setName] = useState("");
  const add = async () => {
    if (!name.trim()) return;
    if (
      await save("labs", null, {
        name: name.trim(),
        is_own: false,
        position: labs.length,
      })
    )
      setName("");
  };
  return (
    <StudioCard
      title={translate("lab.dictionaries.labs")}
      subtitle={translate("lab.dictionaries.labs_hint")}
    >
      <ul className="flex flex-col gap-2" data-testid="lab-dict-labs">
        {labs.map((lab) => (
          <LabRow key={lab.id} lab={lab} />
        ))}
      </ul>
      <AddRow
        value={name}
        onChange={setName}
        onAdd={add}
        placeholder={translate("lab.dictionaries.new_lab")}
      />
    </StudioCard>
  );
};

const LabRow = ({ lab }: { lab: Lab }) => {
  const translate = useTranslate();
  const save = useSaveRow();
  const field = (key: keyof Lab, label: string) => (
    <Input
      defaultValue={(lab[key] as string | null) ?? ""}
      placeholder={label}
      aria-label={label}
      className="h-9 bg-card"
      onBlur={(event) => {
        const value = event.target.value.trim();
        if (value !== ((lab[key] as string | null) ?? "")) {
          save("labs", lab.id, {
            [key]: key === "name" ? value || lab.name : value || null,
          });
        }
      }}
    />
  );
  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-2xl bg-muted p-3",
        !lab.is_active && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-44 flex-1">
          {field("name", translate("lab.dictionaries.name"))}
        </div>
        <Toggle
          on={lab.is_own}
          onLabel={translate("lab.dictionaries.own")}
          offLabel={translate("lab.dictionaries.external")}
          onChange={(is_own) => save("labs", lab.id, { is_own })}
        />
        <ArchiveButton
          active={lab.is_active}
          onChange={(is_active) => save("labs", lab.id, { is_active })}
        />
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {field("contact_person", translate("lab.dictionaries.contact_person"))}
        {field("phone", translate("lab.dictionaries.phone"))}
        {field("address", translate("lab.dictionaries.address"))}
      </div>
    </li>
  );
};

const TechniciansCard = () => {
  const translate = useTranslate();
  const save = useSaveRow();
  const { labs, technicians } = useLabDictionaries();
  const [name, setName] = useState("");
  const [labId, setLabId] = useState("");
  const add = async () => {
    const lab = labId || String(labs[0]?.id ?? "");
    if (!name.trim() || !lab) return;
    if (
      await save("lab_technicians", null, {
        name: name.trim(),
        lab_id: lab,
        position: technicians.length,
      })
    )
      setName("");
  };
  return (
    <StudioCard
      title={translate("lab.dictionaries.technicians")}
      subtitle={translate("lab.dictionaries.technicians_hint")}
    >
      <ul className="flex flex-col gap-2" data-testid="lab-dict-technicians">
        {technicians.map((tech) => (
          <TechnicianRow key={tech.id} tech={tech} labs={labs} />
        ))}
      </ul>
      <AddRow
        value={name}
        onChange={setName}
        onAdd={add}
        placeholder={translate("lab.dictionaries.new_technician")}
      >
        <NativeSelect
          value={labId || String(labs[0]?.id ?? "")}
          onChange={setLabId}
          aria-label={translate("lab.fields.lab")}
        >
          {labs
            .filter((lab) => lab.is_active)
            .map((lab) => (
              <option key={lab.id} value={String(lab.id)}>
                {lab.name}
              </option>
            ))}
        </NativeSelect>
      </AddRow>
    </StudioCard>
  );
};

const TechnicianRow = ({
  tech,
  labs,
}: {
  tech: LabTechnician;
  labs: Lab[];
}) => {
  const translate = useTranslate();
  const save = useSaveRow();
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-2xl bg-muted p-3",
        !tech.is_active && "opacity-60",
      )}
    >
      <Input
        defaultValue={tech.name}
        aria-label={translate("lab.dictionaries.name")}
        className="h-9 min-w-40 flex-1 bg-card"
        onBlur={(event) => {
          const value = event.target.value.trim();
          if (value && value !== tech.name)
            save("lab_technicians", tech.id, { name: value });
        }}
      />
      <Input
        defaultValue={tech.phone ?? ""}
        placeholder={translate("lab.dictionaries.phone")}
        aria-label={translate("lab.dictionaries.phone")}
        className="h-9 w-40 bg-card"
        onBlur={(event) => {
          const value = event.target.value.trim();
          if (value !== (tech.phone ?? ""))
            save("lab_technicians", tech.id, { phone: value || null });
        }}
      />
      <NativeSelect
        value={String(tech.lab_id)}
        onChange={(lab_id) => save("lab_technicians", tech.id, { lab_id })}
        aria-label={translate("lab.fields.lab")}
      >
        {labs
          .filter((lab) => lab.is_active || same(lab.id, tech.lab_id))
          .map((lab) => (
            <option key={lab.id} value={String(lab.id)}>
              {lab.name}
            </option>
          ))}
      </NativeSelect>
      <ArchiveButton
        active={tech.is_active}
        onChange={(is_active) =>
          save("lab_technicians", tech.id, { is_active })
        }
      />
    </li>
  );
};

const WorkTypesCard = ({ seesMoney }: { seesMoney: boolean }) => {
  const translate = useTranslate();
  const save = useSaveRow();
  const { workTypes, prices } = useLabDictionaries();
  const [name, setName] = useState("");
  const add = async () => {
    if (!name.trim()) return;
    if (
      await save("lab_work_types", null, {
        name: name.trim(),
        position: workTypes.length,
      })
    )
      setName("");
  };
  return (
    <StudioCard
      title={translate("lab.dictionaries.work_types")}
      subtitle={translate("lab.dictionaries.work_types_hint")}
    >
      <ul className="flex flex-col gap-2" data-testid="lab-dict-work-types">
        {workTypes.map((type) => (
          <WorkTypeRow
            key={type.id}
            type={type}
            seesMoney={seesMoney}
            price={prices.find((p) => same(p.work_type_id, type.id))}
          />
        ))}
      </ul>
      <AddRow
        value={name}
        onChange={setName}
        onAdd={add}
        placeholder={translate("lab.dictionaries.new_work_type")}
      />
    </StudioCard>
  );
};

const WorkTypeRow = ({
  type,
  price,
  seesMoney,
}: {
  type: LabWorkType;
  price?: { id: Identifier; price: number };
  seesMoney: boolean;
}) => {
  const translate = useTranslate();
  const save = useSaveRow();
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-2xl bg-muted p-3",
        !type.is_active && "opacity-60",
      )}
    >
      <Input
        defaultValue={type.name}
        aria-label={translate("lab.dictionaries.name")}
        className="h-9 min-w-48 flex-1 bg-card"
        onBlur={(event) => {
          const value = event.target.value.trim();
          if (value && value !== type.name)
            save("lab_work_types", type.id, { name: value });
        }}
      />
      {seesMoney ? (
        <label className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            defaultValue={price?.price ?? ""}
            placeholder="0"
            aria-label={`${translate("lab.dictionaries.price")}: ${type.name}`}
            className="h-9 w-32 bg-card text-right tabular-nums"
            onBlur={(event) => {
              const value = Math.max(
                0,
                Math.round(Number(event.target.value) || 0),
              );
              if (value === (price?.price ?? null)) return;
              if (price) {
                save("lab_work_type_prices", price.id, { price: value });
              } else {
                save("lab_work_type_prices", null, {
                  work_type_id: type.id,
                  price: value,
                });
              }
            }}
          />
          <span className="text-sm text-muted-foreground">₸</span>
        </label>
      ) : null}
      <ArchiveButton
        active={type.is_active}
        onChange={(is_active) => save("lab_work_types", type.id, { is_active })}
      />
    </li>
  );
};

/** The doctor → administrator who gets the reminders of the orders */
const AdminsCard = () => {
  const translate = useTranslate();
  const save = useSaveRow();
  const { data: doctors } = useDoctors();
  const { data: sales = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "first_name", order: "ASC" },
  });
  return (
    <StudioCard
      title={translate("lab.dictionaries.admins")}
      subtitle={translate("lab.dictionaries.admins_hint")}
    >
      <ul className="flex flex-col gap-2" data-testid="lab-dict-admins">
        {doctors
          .filter((doctor) => doctor.is_active)
          .map((doctor) => (
            <li
              key={doctor.id}
              className="flex flex-wrap items-center gap-3 rounded-2xl bg-muted p-3"
            >
              <span className="min-w-40 flex-1 truncate text-sm">
                {doctor.name}
              </span>
              <NativeSelect
                value={
                  doctor.admin_sales_id == null
                    ? ""
                    : String(doctor.admin_sales_id)
                }
                onChange={(value) =>
                  save("doctors", doctor.id, {
                    admin_sales_id: value || null,
                  })
                }
                aria-label={`${translate("lab.fields.responsible")}: ${doctor.name}`}
              >
                <option value="">
                  {translate("lab.dictionaries.no_admin")}
                </option>
                {sales
                  .filter(
                    (sale) =>
                      (!sale.disabled && sale.role !== "integrator") ||
                      same(sale.id, doctor.admin_sales_id),
                  )
                  .map((sale) => (
                    <option key={sale.id} value={String(sale.id)}>
                      {[sale.first_name, sale.last_name]
                        .filter(Boolean)
                        .join(" ")}
                    </option>
                  ))}
              </NativeSelect>
            </li>
          ))}
      </ul>
    </StudioCard>
  );
};

const AddRow = ({
  value,
  onChange,
  onAdd,
  placeholder,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
  placeholder: string;
  children?: ReactNode;
}) => {
  const translate = useTranslate();
  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd();
      }}
    >
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 min-w-48 flex-1"
      />
      {children}
      <Button type="submit" disabled={!value.trim()}>
        <PlusGlyph />
        {translate("lab.dictionaries.add")}
      </Button>
    </form>
  );
};

const Toggle = ({
  on,
  onLabel,
  offLabel,
  onChange,
}: {
  on: boolean;
  onLabel: string;
  offLabel: string;
  onChange: (on: boolean) => void;
}) => (
  <div className="flex rounded-full bg-card p-0.5" role="radiogroup">
    {[true, false].map((value) => (
      <button
        key={String(value)}
        type="button"
        role="radio"
        aria-checked={on === value}
        onClick={() => on !== value && onChange(value)}
        className={cn(
          "h-8 rounded-full px-3 text-xs transition-colors",
          on === value
            ? "bg-primary text-primary-foreground"
            : "hover:bg-muted",
        )}
      >
        {value ? onLabel : offLabel}
      </button>
    ))}
  </div>
);

const ArchiveButton = ({
  active,
  onChange,
}: {
  active: boolean;
  onChange: (active: boolean) => void;
}) => {
  const translate = useTranslate();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => onChange(!active)}
    >
      {translate(
        active ? "lab.dictionaries.archive" : "lab.dictionaries.restore",
      )}
    </Button>
  );
};
