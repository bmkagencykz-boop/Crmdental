/**
 * MacDent (macdent.kz): cloud dental CRM/MIS.
 *
 * Known: the API is free but given only to the clinic director or a third
 * party the director authorises; MacDent sends the key and the documentation
 * by request. It integrates with WebKassa, cloud telephony, 1C and WhatsApp
 * Business. The documentation was not available when this adapter was
 * written.
 *
 * ============================================================================
 *  УТОЧНИТЬ ПО ДОКУМЕНТАЦИИ ВЕНДОРА. Everything below is an ASSUMPTION:
 *  a REST JSON API, the key as a query parameter (access_token), endpoints
 *  for patients, appointments («записи») and payments filtered by a change
 *  date, page / limit pagination, and the field names listed. When MacDent
 *  sends its documentation, change this object only.
 * ============================================================================
 */

import { createAdapter, type VendorConfig } from "./adapter.ts";

export const MACDENT_CONFIG: VendorConfig = {
  kind: "macdent",
  label: "MacDent",
  // уточнить: адрес API
  defaultBaseUrl: "https://app.macdent.kz/api/v1",
  // уточнить: ключ в параметре запроса или в заголовке
  auth: { in: "query", name: "access_token" },
  // уточнить: пути
  endpoints: {
    ping: "/patients",
    patients: "/patients",
    appointments: "/appointments",
    payments: "/payments",
    createPatient: "/patients",
    createAppointment: "/appointments",
  },
  // уточнить: имена параметров
  query: { since: "updated_after", page: "page", perPage: "limit" },
  perPage: 100,
  maxPages: 20,
  listKeys: ["data", "items", "result", "records", "list"],
  timezoneOffset: "+05:00",
  // уточнить: коды статусов записи
  statusCodes: {
    new: "scheduled",
    planned: "scheduled",
    confirmed: "confirmed",
    came: "arrived",
    in_chair: "arrived",
    done: "completed",
    finished: "completed",
    canceled: "cancelled",
    not_came: "no_show",
  },
  fields: {
    patient: {
      id: ["id", "patient_id", "patientId"],
      firstName: ["first_name", "firstName", "name", "имя"],
      lastName: ["last_name", "lastName", "surname", "фамилия"],
      middleName: ["middle_name", "middleName", "patronymic", "отчество"],
      fullName: ["full_name", "fullName", "fio", "фио"],
      phones: ["phones", "phone", "mobile", "cellphone", "телефон"],
      birthDate: ["birth_date", "birthDate", "birthday", "дата_рождения"],
    },
    appointment: {
      id: ["id", "appointment_id", "appointmentId", "record_id"],
      patientId: ["patient_id", "patientId", "patient.id"],
      patient: ["patient", "пациент"],
      start: [
        "start",
        "startDate",
        "start_date",
        "datetime",
        "date_time",
        "начало",
      ],
      date: ["date", "дата"],
      time: ["time", "time_start", "timeStart", "время"],
      end: ["end", "endDate", "end_date", "time_end", "окончание"],
      status: ["status", "state", "статус"],
      completedAt: ["completed_at", "completedAt", "visit_date", "closed_at"],
      treatmentStarted: ["treatment_started", "treatmentStarted", "has_plan"],
      doctorId: ["doctor_id", "doctorId", "doctor.id", "user_id"],
      doctorName: ["doctor_name", "doctorName"],
      doctor: ["doctor", "врач"],
      service: ["service", "services", "procedure", "услуга"],
      comment: ["comment", "note", "description", "комментарий"],
    },
    payment: {
      id: ["id", "payment_id", "paymentId", "check_id"],
      patientId: ["patient_id", "patientId", "patient.id"],
      patient: ["patient", "пациент"],
      appointmentId: ["appointment_id", "appointmentId", "record_id"],
      amount: ["amount", "sum", "total", "сумма"],
      date: ["date", "paid_at", "paidAt", "created_at", "дата"],
      type: ["type", "payment_type", "paymentType", "тип"],
      comment: ["comment", "description", "назначение"],
    },
  },
  // уточнить: есть ли у MacDent исходящие вебхуки
  webhook: {
    eventKeys: ["event", "type", "action"],
    dataKeys: ["data", "payload", "appointment", "patient", "payment"],
    events: {
      payment: "payment",
      visit: "visit",
      completed: "visit",
      appointment: "appointment",
      record: "appointment",
      patient: "patient",
    },
  },
  createdIdKeys: ["id", "patient_id", "appointment_id"],
};

export const macdent = createAdapter(MACDENT_CONFIG);
