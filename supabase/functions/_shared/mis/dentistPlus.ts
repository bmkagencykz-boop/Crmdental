/**
 * Dentist Plus (dentist-plus.com, Almaty): dental MIS/CRM.
 *
 * Known: an API authorised by an API key that the clinic generates in
 * Dentist Plus («Настройки → Интеграции»); integrations with amoCRM (visit
 * history), Wazzup and Sipuni exist. The public API documentation was not
 * reachable when this adapter was written.
 *
 * ============================================================================
 *  УТОЧНИТЬ ПО ДОКУМЕНТАЦИИ ВЕНДОРА. Everything below is an ASSUMPTION:
 *  a REST JSON API, the key in a header, endpoints for patients, visits and
 *  payments filtered by a change date, page / per_page pagination, and the
 *  field names listed (several variants each, Russian and English). When
 *  Dentist Plus sends its documentation, change this object only; the
 *  mapping (adapter.ts) and the database stay as they are.
 * ============================================================================
 */

import { createAdapter, type VendorConfig } from "./adapter.ts";

export const DENTIST_PLUS_CONFIG: VendorConfig = {
  kind: "dentist_plus",
  label: "Dentist Plus",
  // уточнить: адрес API (у клиники может быть свой поддомен)
  defaultBaseUrl: "https://api.dentist-plus.com/v1",
  // уточнить: заголовок и схема ключа (Authorization: Bearer / X-API-Key)
  auth: { in: "header", name: "Authorization", prefix: "Bearer " },
  // уточнить: пути
  endpoints: {
    ping: "/patients",
    patients: "/patients",
    appointments: "/visits",
    payments: "/payments",
    createPatient: "/patients",
    createAppointment: "/visits",
  },
  // уточнить: имена параметров фильтра изменений и страниц
  query: { since: "updated_from", page: "page", perPage: "per_page" },
  perPage: 100,
  maxPages: 20,
  listKeys: ["data", "items", "results", "list", "rows"],
  timezoneOffset: "+05:00",
  // уточнить: коды статусов визита, если API отдаёт числа
  statusCodes: {
    "0": "scheduled",
    "1": "confirmed",
    "2": "arrived",
    "3": "completed",
    "4": "cancelled",
    "5": "no_show",
  },
  fields: {
    patient: {
      id: ["id", "patient_id", "uuid"],
      firstName: ["first_name", "firstname", "name_first", "имя"],
      lastName: ["last_name", "lastname", "surname", "фамилия"],
      middleName: ["middle_name", "patronymic", "second_name", "отчество"],
      fullName: ["full_name", "fio", "фио", "name", "пациент"],
      phones: [
        "phones",
        "phone",
        "mobile",
        "mobile_phone",
        "phone_number",
        "contacts",
        "телефон",
        "телефоны",
      ],
      birthDate: ["birth_date", "birthday", "date_of_birth", "дата_рождения"],
    },
    appointment: {
      id: ["id", "visit_id", "appointment_id", "uuid"],
      patientId: ["patient_id", "client_id", "patient.id", "пациент_id"],
      patient: ["patient", "client", "пациент"],
      start: [
        "start",
        "start_at",
        "starts_at",
        "datetime",
        "date_start",
        "begin",
        "time_start",
        "начало",
      ],
      date: ["date", "visit_date", "дата"],
      time: ["time", "время"],
      end: ["end", "end_at", "ends_at", "date_end", "finish", "окончание"],
      status: ["status", "state", "visit_status", "статус"],
      completedAt: ["completed_at", "finished_at", "visited_at", "closed_at"],
      treatmentStarted: ["treatment_started", "is_treatment", "лечение_начато"],
      doctorId: ["doctor_id", "employee_id", "doctor.id", "врач_id"],
      doctorName: ["doctor_name", "doctor_fio", "врач_фио"],
      doctor: ["doctor", "employee", "врач"],
      service: ["service", "services", "service_name", "procedure", "услуга"],
      comment: ["comment", "note", "notes", "комментарий"],
    },
    payment: {
      id: ["id", "payment_id", "uuid"],
      patientId: ["patient_id", "client_id", "patient.id"],
      patient: ["patient", "client", "пациент"],
      appointmentId: ["visit_id", "appointment_id", "визит_id"],
      amount: ["amount", "sum", "total", "paid", "сумма"],
      date: ["date", "paid_at", "payment_date", "created_at", "дата"],
      type: ["type", "kind", "payment_type", "method", "тип"],
      comment: ["comment", "description", "purpose", "назначение"],
    },
  },
  // уточнить: умеет ли Dentist Plus слать события на внешний адрес
  webhook: {
    eventKeys: ["event", "type", "action", "событие"],
    dataKeys: ["data", "payload", "object", "visit", "patient", "payment"],
    events: {
      payment: "payment",
      visit_completed: "visit",
      "visit.completed": "visit",
      visit: "appointment",
      appointment: "appointment",
      patient: "patient",
    },
  },
  createdIdKeys: ["id", "patient_id", "visit_id", "uuid"],
};

export const dentistPlus = createAdapter(DENTIST_PLUS_CONFIG);
