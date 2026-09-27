import { random } from "faker/locale/en_US";

import type { Deal, Doctor } from "../../../types";
import type { Db } from "./types";

/** Doctors of the demo clinic (stage 13) */
export const generateDoctors = (db: Db) => {
  db.doctors = (
    [
      ["Ахметова Айгуль Серикқызы", "терапевт"],
      ["Жумабеков Ерлан Маратович", "хирург-имплантолог"],
      ["Ким Виктория Олеговна", "ортодонт"],
      ["Сериков Бахыт Нурланович", "ортопед"],
      ["Иванова Дарья Сергеевна", "детский стоматолог"],
    ] as const
  ).map(
    ([name, specialty], index): Doctor => ({
      id: index + 1,
      name,
      specialty,
      is_active: true,
      position: index,
    }),
  );
};

// The doctor who usually takes a service
const doctorByService: Record<string, string> = {
  Имплантация: "хирург-имплантолог",
  Хирургия: "хирург-имплантолог",
  Ортодонтия: "ортодонт",
  Протезирование: "ортопед",
  "Детская стоматология": "детский стоматолог",
  Терапия: "терапевт",
  Гигиена: "терапевт",
  Другое: "терапевт",
};

/**
 * Doctors and consultation prices of the deals: a deal gets its doctor once
 * the patient is booked (sometimes earlier), mostly the one of its service,
 * sometimes another; the consultation is free or 5-10 thousand tenge.
 */
export const assignDoctors = (db: Db, deals: Deal[]) => {
  deals.forEach((deal) => {
    const stage = db.stages.find((s) => s.id === deal.stage_id);
    const service = db.services.find((s) => s.id === deal.service_id);
    const booked =
      !!stage &&
      (stage.kind !== "open" || stage.position >= 2 || random.number(9) < 2);
    if (!booked || (stage?.kind === "lost" && random.number(9) < 4)) {
      deal.doctor_id = null;
      deal.consultation_amount = null;
      return;
    }
    const usual = db.doctors.find(
      (d) => d.specialty === doctorByService[service?.name ?? "Другое"],
    );
    deal.doctor_id =
      usual && random.number(9) < 8
        ? usual.id
        : random.arrayElement(db.doctors).id;
    deal.consultation_amount = random.arrayElement([
      0, 5000, 5000, 7000, 10000, 10000,
    ]);
  });
};
