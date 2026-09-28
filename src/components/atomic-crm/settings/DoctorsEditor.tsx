import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useTranslate } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { useDoctors } from "../dictionaries/useDictionaries";
import type { Doctor } from "../types";
import { moveItem, useDictionaryMutations } from "./useDictionaryMutations";

/**
 * Settings → Doctors (stage 13): name, specialty, order, active switch. A
 * doctor with deals cannot be deleted (the database refuses it): switching
 * it off hides it from the pickers and keeps it on the old deals.
 */
export const DoctorsEditor = () => {
  const translate = useTranslate();
  const { data: doctors } = useDoctors();
  const { create, update, remove } = useDictionaryMutations("doctors", {
    inUseMessage: "doctors.settings.in_use",
  });
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const sorted = [...doctors].sort(
    (a, b) => a.position - b.position || Number(a.id) - Number(b.id),
  );

  const move = (doctor: Doctor, direction: -1 | 1) =>
    moveItem(sorted, doctor.id, direction).forEach(([record, position]) =>
      update(record, { position }),
    );

  const add = () => {
    if (!name.trim()) return;
    create({
      name: name.trim(),
      specialty: specialty.trim() || null,
      is_active: true,
      position: (sorted.at(-1)?.position ?? -1) + 1,
    });
    setName("");
    setSpecialty("");
  };

  const saveText = (
    doctor: Doctor,
    field: "name" | "specialty",
    raw: string,
  ) => {
    const value = raw.trim();
    if (field === "name" && !value) return;
    if (value === (doctor[field] ?? "")) return;
    update(doctor, { [field]: value || null });
  };

  return (
    <div className="flex flex-col gap-2">
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("doctors.settings.empty")}
        </p>
      ) : null}
      {sorted.map((doctor, index) => (
        <div
          key={doctor.id}
          className="flex items-center gap-2"
          data-doctor-id={doctor.id}
        >
          <div className="flex">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={index === 0}
              onClick={() => move(doctor, -1)}
              aria-label={translate("crm.settings.move_up")}
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={index === sorted.length - 1}
              onClick={() => move(doctor, 1)}
              aria-label={translate("crm.settings.move_down")}
            >
              <ArrowDown className="size-4" />
            </Button>
          </div>
          <Input
            defaultValue={doctor.name}
            key={`${doctor.id}-name-${doctor.name}`}
            aria-label={translate("doctors.settings.name")}
            onBlur={(event) => saveText(doctor, "name", event.target.value)}
            className={doctor.is_active ? undefined : "text-muted-foreground"}
          />
          <Input
            defaultValue={doctor.specialty ?? ""}
            key={`${doctor.id}-specialty-${doctor.specialty ?? ""}`}
            aria-label={translate("doctors.settings.specialty")}
            placeholder={translate("doctors.settings.specialty_placeholder")}
            onBlur={(event) =>
              saveText(doctor, "specialty", event.target.value)
            }
            className="max-w-56"
          />
          <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
            <Switch
              checked={doctor.is_active}
              onCheckedChange={(checked) =>
                update(doctor, { is_active: checked })
              }
              aria-label={translate("doctors.settings.active")}
            />
            {translate("doctors.settings.active")}
          </label>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => remove(doctor)}
            aria-label={translate("ra.action.delete")}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <div className="mt-2 flex items-center gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && add()}
          placeholder={translate("doctors.settings.new_name")}
          aria-label={translate("doctors.settings.new_name")}
        />
        <Input
          value={specialty}
          onChange={(event) => setSpecialty(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && add()}
          placeholder={translate("doctors.settings.specialty_placeholder")}
          aria-label={translate("doctors.settings.specialty")}
          className="max-w-56"
        />
        <Button onClick={add} disabled={!name.trim()} variant="outline">
          {translate("doctors.settings.add")}
        </Button>
      </div>
    </div>
  );
};
