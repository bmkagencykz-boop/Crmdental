import type { Identifier } from "ra-core";

import { iinCheckDigit } from "../../../patient-card/iin";
import { toothStateForService } from "../../../patient-card/toothStates";
import { parseTeeth } from "../../../dental-chart/teeth";
import { consentValues, renderConsent } from "../../../patient-card/consents";
import type {
  Answers,
  ConsentTemplate,
  PatientConsent,
  PatientFile,
  PatientQuestionnaire,
  PatientTooth,
  ToothHistoryRow,
  ToothState,
  VisitRecord,
  VisitRecordTemplate,
} from "../../../patient-card/types";
import { patientDisplayName } from "../../../patients/parsePatientText";
import { ctImage, optgImage, periapicalImage } from "./xrays";
import type { Db } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");
const dateOf = (at: Date) =>
  `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
const daysAgo = (days: number, hours = 10) => {
  const at = new Date(Date.now() - days * DAY);
  at.setHours(hours, 0, 0, 0);
  return at;
};
const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

/** The consent templates every clinic gets (as private.seed_consent_templates) */
export const DEFAULT_CONSENT_TEMPLATES: Omit<ConsentTemplate, "id">[] = [
  {
    name: "Информированное добровольное согласие на стоматологическое лечение",
    body:
      "Я, {пациент}, {дата_рождения} г. р., ИИН {иин}, даю информированное добровольное согласие на стоматологическое лечение в клинике «{клиника}».\n\n" +
      "Врач {врач} в доступной форме объяснил(а) мне диагноз, план лечения, возможные варианты лечения, их стоимость, ожидаемые результаты, возможные осложнения и последствия отказа от лечения.\n\n" +
      "Я сообщил(а) врачу все известные мне сведения о состоянии здоровья, аллергических реакциях и принимаемых лекарствах. Я понимаю, что результат лечения зависит также от соблюдения мной рекомендаций врача и гигиены полости рта.\n\n" +
      "Мне понятно, что я вправе отказаться от лечения на любом этапе.\n\n" +
      "Дата: {дата}\nПациент: ____________ / {пациент}\nВрач: ____________ / {врач}",
    is_archived: false,
    position: 0,
  },
  {
    name: "Согласие на местную анестезию",
    body:
      "Я, {пациент}, ИИН {иин}, согласен(на) на проведение местной анестезии.\n\n" +
      "Мне разъяснены возможные реакции: аллергия, отёк, временное онемение, гематома. О перенесённых реакциях на анестезию, беременности и хронических заболеваниях я сообщил(а) врачу.\n\n" +
      "Дата: {дата}\nПациент: ____________ / {пациент}",
    is_archived: false,
    position: 1,
  },
  {
    name: "Согласие на хирургическое вмешательство и имплантацию",
    body:
      "Я, {пациент}, {дата_рождения} г. р., даю согласие на хирургическое вмешательство (удаление зуба, имплантацию) в клинике «{клиника}».\n\n" +
      "Врач {врач} разъяснил(а) мне ход операции, период заживления, возможные осложнения (кровотечение, отёк, боль, воспаление, отторжение импланта) и необходимость контрольных визитов.\n\n" +
      "Дата: {дата}\nПациент: ____________ / {пациент}\nВрач: ____________ / {врач}",
    is_archived: false,
    position: 2,
  },
  {
    name: "Согласие на обработку персональных данных",
    body:
      "Я, {пациент}, телефон {телефон}, даю согласие клинике «{клиника}» на сбор, хранение и обработку моих персональных данных и сведений о здоровье для оказания медицинских услуг, ведения медицинской документации и связи со мной, в соответствии с Законом Республики Казахстан «О персональных данных и их защите».\n\n" +
      "Дата: {дата}\nПациент: ____________ / {пациент}",
    is_archived: false,
    position: 3,
  },
];

/** Templates of the visit records */
const RECORD_TEMPLATES: Omit<VisitRecordTemplate, "id" | "position">[] = [
  {
    name: "Кариес дентина",
    diagnosis_codes: ["K02.1"],
    content: {
      complaints: "Кратковременная боль от холодного и сладкого.",
      objective:
        "Кариозная полость в пределах дентина, зондирование болезненно по эмалево-дентинной границе, перкуссия безболезненна.",
      diagnosis: "Кариес дентина",
      treatment:
        "Инфильтрационная анестезия. Препарирование, медикаментозная обработка, изоляция. Пломба светоотверждаемая.",
      recommendations: "Не принимать пищу 2 часа. Контроль через 6 месяцев.",
    },
  },
  {
    name: "Хронический пульпит",
    diagnosis_codes: ["K04.04"],
    content: {
      complaints: "Ноющая боль, усиливается от горячего.",
      objective:
        "Глубокая кариозная полость, сообщается с полостью зуба, зондирование болезненно, ЭОД 60 мкА.",
      diagnosis: "Хронический пульпит",
      treatment:
        "Анестезия. Экстирпация пульпы, механическая и медикаментозная обработка каналов, временная пломба.",
      recommendations:
        "Повторный визит через 7 дней для пломбирования каналов.",
    },
  },
  {
    name: "Консультация по имплантации",
    diagnosis_codes: ["K08.1"],
    content: {
      complaints: "Отсутствие зуба, затруднённое пережёвывание пищи.",
      anamnesis: "Зуб удалён более года назад.",
      objective:
        "Дефект зубного ряда, слизистая бледно-розовая, атрофия альвеолярного гребня умеренная.",
      diagnosis: "Частичная вторичная адентия",
      recommendations: "КТ челюсти, план лечения с имплантацией.",
    },
  },
  {
    name: "Профессиональная гигиена",
    diagnosis_codes: ["K03.6", "K05.1"],
    content: {
      objective:
        "Над- и поддесневые зубные отложения, кровоточивость при зондировании.",
      diagnosis: "Зубные отложения, хронический гингивит",
      treatment: "Ультразвуковая чистка, Air Flow, полировка, фторирование.",
      recommendations: "Зубная нить, ирригатор. Гигиена через 6 месяцев.",
    },
  },
];

/** Charts of the demo patients: tooth → state (and a note) */
const CHARTS: Array<Partial<Record<number, [ToothState, string?]>>> = [
  {
    16: ["crown"],
    26: ["filling"],
    36: ["caries", "глубокий, медиальная поверхность"],
    46: ["missing"],
    47: ["filling"],
    18: ["missing"],
    28: ["missing"],
    11: ["treatment", "скол режущего края"],
  },
  {
    36: ["implant"],
    37: ["crown"],
    24: ["endo", "боль при перкуссии"],
    25: ["filling"],
    45: ["root"],
    38: ["missing"],
    48: ["missing"],
  },
  {
    14: ["caries"],
    15: ["caries"],
    26: ["crown"],
    27: ["filling"],
    35: ["filling"],
    46: ["implant"],
  },
  {
    11: ["filling"],
    21: ["filling"],
    17: ["endo"],
    36: ["missing"],
    37: ["treatment", "план: удаление"],
  },
  {
    16: ["filling"],
    26: ["filling"],
    36: ["filling"],
    46: ["caries"],
  },
  {
    // A child: primary teeth
    54: ["caries"],
    64: ["filling"],
    75: ["caries", "фиссура"],
    85: ["root"],
  },
];

const QUESTIONNAIRES: Answers[] = [
  {
    medications: { answer: "yes", comment: "Эутирокс 50 мкг утром" },
    pregnancy: { answer: "no" },
    blood_pressure: { answer: "no" },
    diabetes: { answer: "no" },
    heart: { answer: "no" },
    hepatitis_hiv: { answer: "no" },
    anesthesia: { answer: "no" },
    bleeding: { answer: "no" },
    epilepsy: { answer: "no" },
    smoking: { answer: "no" },
  },
  {
    medications: { answer: "yes", comment: "Кардиомагнил" },
    blood_pressure: { answer: "yes", comment: "Гипертония, до 150/95" },
    diabetes: { answer: "yes", comment: "2 тип, метформин" },
    heart: { answer: "no" },
    hepatitis_hiv: { answer: "no" },
    anesthesia: { answer: "no" },
    bleeding: { answer: "yes", comment: "Кровоточивость при приёме аспирина" },
    smoking: { answer: "yes", comment: "10 сигарет в день" },
  },
  {
    medications: { answer: "no" },
    pregnancy: { answer: "yes", comment: "22 недели" },
    blood_pressure: { answer: "no" },
    anesthesia: { answer: "yes", comment: "Отёк после лидокаина" },
    hepatitis_hiv: { answer: "no" },
  },
  {
    medications: { answer: "no" },
    blood_pressure: { answer: "no" },
    diabetes: { answer: "no" },
    anesthesia: { answer: "no" },
    bleeding: { answer: "no" },
  },
];

/** A valid IIN of a birth date and a sex (serial from the patient id) */
export const demoIin = (
  birthDate: string,
  gender: "male" | "female",
  seed: number,
) => {
  const [year, month, day] = birthDate.split("-");
  const century = Number(year) >= 2000 ? 5 : 3;
  const sexDigit = century + (gender === "female" ? 1 : 0);
  for (let serial = seed % 9000; serial < (seed % 9000) + 20; serial++) {
    const base = `${year.slice(2)}${month}${day}${sexDigit}${String(1000 + serial).slice(-4)}`;
    const check = iinCheckDigit(base);
    if (check != null) return `${base}${check}`;
  }
  return null;
};

/**
 * The full patient card of the demo (stage 37): IINs and card numbers, the
 * dental charts of the patients with plans and visits (with their history
 * and the states of the done plan items), visit records with diagnoses of
 * the completed visits, templates, questionnaires, consents, and X-rays
 * (ОПТГ drawn from the chart, a periapical image, a CT slice, photos).
 * Runs after the plans, the visits and the payments.
 */
export const generatePatientCard = (db: Db) => {
  db.patient_teeth = [];
  db.patient_tooth_history = [];
  db.visit_records = [];
  db.visit_record_templates = [];
  db.patient_questionnaires = [];
  db.consent_templates = [];
  db.patient_consents = [];
  db.patient_files = [];

  const staff = db.sales.filter((sale) => !sale.disabled);
  const owner = staff.find((sale) => sale.role === "owner") ?? staff[0];
  const manager = staff.find((sale) => sale.role === "manager") ?? owner;

  db.consent_templates = DEFAULT_CONSENT_TEMPLATES.map((template, index) => ({
    ...template,
    id: index + 1,
    created_at: daysAgo(120).toISOString(),
    updated_at: daysAgo(120).toISOString(),
  }));
  db.visit_record_templates = RECORD_TEMPLATES.map((template, index) => ({
    ...template,
    id: index + 1,
    position: index,
    created_by: owner?.id ?? null,
    created_at: daysAgo(90).toISOString(),
  }));

  // The patients of the card: plans first, then completed visits
  const withPlans = [
    ...new Set(db.treatment_plans.map((plan) => String(plan.patient_id))),
  ];
  const withVisits = [
    ...new Set(
      db.visits
        .filter((visit) => ["completed", "arrived"].includes(visit.status))
        .map((visit) => String(visit.patient_id)),
    ),
  ];
  const chosen = [...new Set([...withPlans, ...withVisits])]
    .map((id) => db.patients.find((patient) => String(patient.id) === id))
    .filter((patient): patient is Db["patients"][number] => !!patient)
    .slice(0, 14);

  // IIN, birth date and card number
  let card = 1024;
  db.patients = db.patients.map((patient, index) => {
    if (index % 3 === 2 && !chosen.includes(patient)) return patient;
    const year = 1968 + ((Number(patient.id) * 7) % 38);
    const birth =
      patient.birth_date ??
      `${year}-${pad(((Number(patient.id) * 5) % 12) + 1)}-${pad(((Number(patient.id) * 11) % 28) + 1)}`;
    const gender = (patient.gender === "female" ? "female" : "male") as
      | "male"
      | "female";
    return {
      ...patient,
      birth_date: birth,
      gender,
      iin: demoIin(birth, gender, Number(patient.id) * 37),
      card_number: String(card++),
    };
  });

  let toothId = 1;
  let historyId = 1;
  const setTooth = (
    patientId: Identifier,
    tooth: number,
    state: ToothState,
    note: string | null,
    at: Date,
    salesId: Identifier | null,
    source: "manual" | "plan" = "manual",
    planItemId: Identifier | null = null,
  ) => {
    const existing = db.patient_teeth.find(
      (row) => same(row.patient_id, patientId) && row.tooth === tooth,
    );
    db.patient_tooth_history.push({
      id: historyId++,
      patient_id: patientId,
      tooth,
      state_before: existing?.state ?? null,
      state,
      note_before: existing?.note ?? null,
      note,
      sales_id: salesId,
      source,
      plan_item_id: planItemId,
      created_at: at.toISOString(),
    } satisfies ToothHistoryRow);
    if (existing) {
      existing.state = state;
      existing.note = note ?? existing.note ?? null;
      existing.updated_at = at.toISOString();
      existing.updated_by = salesId;
      return;
    }
    db.patient_teeth.push({
      id: toothId++,
      patient_id: patientId,
      tooth,
      state,
      note,
      updated_by: salesId,
      updated_at: at.toISOString(),
      created_at: at.toISOString(),
    } satisfies PatientTooth);
  };

  chosen.forEach((patient, index) => {
    const chart = CHARTS[index % CHARTS.length];
    // The first exam, then a correction a few weeks later
    for (const [tooth, value] of Object.entries(chart)) {
      if (!value) continue;
      const [state, note] = value;
      if (state === "filling" && Number(tooth) % 2 === 0) {
        setTooth(
          patient.id,
          Number(tooth),
          "caries",
          null,
          daysAgo(60 + index),
          manager?.id ?? null,
        );
        setTooth(
          patient.id,
          Number(tooth),
          "filling",
          note ?? null,
          daysAgo(40 + index),
          manager?.id ?? null,
        );
      } else {
        setTooth(
          patient.id,
          Number(tooth),
          state,
          note ?? null,
          daysAgo(60 + index),
          manager?.id ?? null,
        );
      }
    }
  });

  // Done items of the plans set their teeth, as the database trigger does
  for (const item of db.treatment_plan_items) {
    if (!item.done) continue;
    const state = toothStateForService(item.name);
    if (!state) continue;
    const plan = db.treatment_plans.find((p) => same(p.id, item.plan_id));
    if (!plan) continue;
    const doneAt = item.done_at ? new Date(item.done_at) : daysAgo(10);
    for (const tooth of parseTeeth(item.tooth)) {
      setTooth(
        plan.patient_id,
        tooth,
        state,
        null,
        doneAt,
        plan.created_by ?? manager?.id ?? null,
        "plan",
        item.id,
      );
    }
  }

  // Visit records of the completed visits of the chosen patients
  let recordId = 1;
  const doctorOf = (id: Identifier | null | undefined) =>
    db.doctors.find((doctor) => same(doctor.id, id));
  for (const visit of db.visits) {
    if (!["completed", "arrived"].includes(visit.status)) continue;
    if (!chosen.some((patient) => same(patient.id, visit.patient_id))) continue;
    const template =
      RECORD_TEMPLATES[Number(visit.id) % RECORD_TEMPLATES.length];
    const chartTooth = db.patient_teeth.find(
      (row) =>
        same(row.patient_id, visit.patient_id) && row.state !== "healthy",
    );
    const toothText = chartTooth ? ` зуба ${chartTooth.tooth}` : "";
    db.visit_records.push({
      id: recordId++,
      patient_id: visit.patient_id,
      visit_id: visit.id,
      deal_id: visit.deal_id ?? null,
      doctor_id: visit.doctor_id ?? null,
      record_date: dateOf(new Date(visit.starts_at)),
      complaints: template.content.complaints ?? null,
      anamnesis:
        template.content.anamnesis ?? "Хронических заболеваний не отмечает.",
      objective: template.content.objective ?? null,
      diagnosis_codes: template.diagnosis_codes,
      diagnosis:
        `${template.content.diagnosis ?? ""}${toothText}`.trim() || null,
      treatment: template.content.treatment ?? null,
      recommendations: template.content.recommendations ?? null,
      created_by: manager?.id ?? null,
      updated_by: manager?.id ?? null,
      created_at: visit.ends_at,
      updated_at: visit.ends_at,
    } satisfies VisitRecord);
  }

  // Questionnaires, signed
  chosen.slice(0, 8).forEach((patient, index) => {
    db.patient_questionnaires.push({
      id: index + 1,
      patient_id: patient.id,
      answers: QUESTIONNAIRES[index % QUESTIONNAIRES.length],
      signed_at: index % 4 === 3 ? null : dateOf(daysAgo(50 + index)),
      updated_by: manager?.id ?? null,
      updated_at: daysAgo(50 + index).toISOString(),
    } satisfies PatientQuestionnaire);
  });

  // X-rays and photos, a consent saved as a file
  let fileId = 1;
  const addFile = (
    patientId: Identifier,
    patch: Pick<PatientFile, "name" | "kind" | "path" | "mime"> &
      Partial<PatientFile>,
    days: number,
  ) => {
    const file: PatientFile = {
      id: fileId++,
      patient_id: patientId,
      size: Math.round(patch.path.length * 0.75),
      taken_at: dateOf(daysAgo(days)),
      note: null,
      sales_id: manager?.id ?? null,
      created_at: daysAgo(days, 11).toISOString(),
      ...patch,
    };
    db.patient_files.push(file);
    return file;
  };
  chosen.slice(0, 4).forEach((patient, index) => {
    const states: Partial<Record<number, ToothState>> = {};
    for (const row of db.patient_teeth) {
      if (same(row.patient_id, patient.id)) states[row.tooth] = row.state;
    }
    const name = patientDisplayName(patient);
    addFile(
      patient.id,
      {
        name: `ОПТГ ${name}.svg`,
        kind: "opg",
        mime: "image/svg+xml",
        path: optgImage(states, `ОПТГ · ${name}`),
        note: index === 0 ? "Первичная диагностика" : null,
      },
      58 - index,
    );
    const focus = db.patient_teeth.find(
      (row) =>
        same(row.patient_id, patient.id) &&
        ["endo", "caries", "implant", "root"].includes(row.state),
    );
    if (focus) {
      addFile(
        patient.id,
        {
          name: `Прицельный ${focus.tooth}.svg`,
          kind: "periapical",
          mime: "image/svg+xml",
          path: periapicalImage(focus.state, `Зуб ${focus.tooth}`),
        },
        30 - index,
      );
    }
    if (index === 1) {
      addFile(
        patient.id,
        {
          name: "КТ нижней челюсти.svg",
          kind: "ct",
          mime: "image/svg+xml",
          path: ctImage("КТ · нижняя челюсть, аксиальный срез"),
          note: "Планирование имплантации 36",
        },
        45,
      );
    }
  });

  // Consents: the treatment consent signed, the anesthesia one given
  let consentId = 1;
  chosen.slice(0, 6).forEach((patient, index) => {
    const doctor = doctorOf(
      db.visits.find((visit) => same(visit.patient_id, patient.id))?.doctor_id,
    );
    const values = consentValues({
      patientName: patientDisplayName(patient),
      birthDate: patient.birth_date,
      iin: patient.iin,
      phone: patient.phones?.[0] ?? patient.phone_jsonb?.[0]?.number,
      clinic: "Жемчуг Дентал",
      doctor: doctor?.name,
      date: daysAgo(55 - index),
    });
    for (const template of db.consent_templates.slice(0, index % 2 ? 1 : 2)) {
      db.patient_consents.push({
        id: consentId++,
        patient_id: patient.id,
        template_id: template.id,
        title: template.name,
        body: renderConsent(template.body, values),
        signed_at:
          template.position === 0 || index < 2
            ? dateOf(daysAgo(55 - index))
            : null,
        file_id: null,
        created_by: manager?.id ?? null,
        created_at: daysAgo(55 - index, 9).toISOString(),
      } satisfies PatientConsent);
    }
  });
};
