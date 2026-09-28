/**
 * A MIS adapter built from a vendor config (dentistPlus.ts, macdent.ts):
 * vendor JSON -> vendor-neutral records (normalize.ts), and the HTTP
 * requests of the vendor API (list changes, test, push an appointment).
 *
 * The vendors did not publish their API: every protocol detail sits in the
 * config object of the vendor, marked «уточнить по документации вендора».
 * When the documentation arrives only that object should need changing.
 */

import {
  amountOf,
  booleanOf,
  dateOf,
  dateTimeOf,
  idOf,
  isObject,
  phonesOf,
  pick,
  statusOf,
  text,
  type MisAppointment,
  type MisItem,
  type MisKind,
  type MisPatient,
  type MisPayment,
  type MisStatus,
  type MisVisit,
  type Payload,
} from "./normalize.ts";

export type MisResource = "patients" | "appointments" | "payments";

export type VendorConfig = {
  kind: MisKind;
  label: string;
  /** Used when the clinic leaves the address empty */
  defaultBaseUrl: string;
  /** How the API key travels */
  auth:
    | { in: "header"; name: string; prefix: string }
    | { in: "query"; name: string };
  endpoints: {
    /** A cheap authenticated GET to test the key */
    ping: string;
    patients: string;
    appointments: string;
    payments: string;
    createPatient: string;
    createAppointment: string;
  };
  /** Query parameters of the change lists */
  query: {
    since: string;
    page: string;
    perPage: string;
    /** Extra fixed parameters (e.g. format=json) */
    extra?: Record<string, string>;
  };
  perPage: number;
  /** Pages read per resource and run (the next run goes on from the cursor) */
  maxPages: number;
  /** Where the array of a list response is */
  listKeys: string[];
  /** Local time of the clinic when the MIS sends dates without zone */
  timezoneOffset: string;
  /** Vendor status codes (lowercase) -> neutral status */
  statusCodes: Record<string, MisStatus>;
  fields: {
    patient: {
      id: string[];
      firstName: string[];
      lastName: string[];
      middleName: string[];
      fullName: string[];
      phones: string[];
      birthDate: string[];
    };
    appointment: {
      id: string[];
      patientId: string[];
      /** Nested patient object of an appointment */
      patient: string[];
      start: string[];
      date: string[];
      time: string[];
      end: string[];
      status: string[];
      completedAt: string[];
      treatmentStarted: string[];
      doctorId: string[];
      doctorName: string[];
      doctor: string[];
      service: string[];
      comment: string[];
    };
    payment: {
      id: string[];
      patientId: string[];
      patient: string[];
      appointmentId: string[];
      amount: string[];
      date: string[];
      type: string[];
      comment: string[];
    };
  };
  /** Pushes of the MIS: event name -> what it carries */
  webhook: {
    eventKeys: string[];
    dataKeys: string[];
    events: Record<string, MisItem["type"]>;
  };
  /** Where the id of a created record is in the answer */
  createdIdKeys: string[];
};

export type Connection = {
  id: number;
  kind: MisKind;
  base_url: string | null;
  api_key: string | null;
  settings?: Payload | null;
};

export type HttpRequest = {
  url: string;
  init: { method: string; headers: Record<string, string>; body?: string };
};

const PREPAYMENT = /предоплат|аванс|депозит|prepay|advance|deposit/i;

export const createAdapter = (config: VendorConfig) => {
  const f = config.fields;

  const mapPatient = (raw: unknown): MisPatient | null => {
    if (!isObject(raw)) return null;
    const patient: MisPatient = {
      external_id: idOf(pick(raw, f.patient.id)),
      first_name: text(pick(raw, f.patient.firstName)),
      last_name: text(pick(raw, f.patient.lastName)),
      middle_name: text(pick(raw, f.patient.middleName)),
      full_name: text(pick(raw, f.patient.fullName)),
      phones: phonesOf(pick(raw, f.patient.phones)),
      birth_date: dateOf(pick(raw, f.patient.birthDate)),
    };
    if (!patient.external_id && !patient.phones.length) return null;
    return patient;
  };

  const doctorOf = (raw: Payload) => {
    const nested = pick(raw, f.appointment.doctor);
    const externalId =
      idOf(pick(raw, f.appointment.doctorId)) ??
      (isObject(nested) ? idOf(nested) : null);
    const name =
      text(pick(raw, f.appointment.doctorName)) ??
      (isObject(nested)
        ? (text(pick(nested, ["name", "full_name", "fio", "фио"])) ??
          ([
            text(pick(nested, ["last_name", "фамилия"])),
            text(pick(nested, ["first_name", "имя"])),
            text(pick(nested, ["middle_name", "отчество"])),
          ]
            .filter(Boolean)
            .join(" ") ||
            null))
        : text(nested));
    return externalId || name ? { external_id: externalId, name } : null;
  };

  const mapAppointment = (raw: unknown): MisAppointment | null => {
    if (!isObject(raw)) return null;
    const externalId = idOf(pick(raw, f.appointment.id));
    if (!externalId) return null;
    const nested = pick(raw, f.appointment.patient);
    const patient = isObject(nested) ? mapPatient(nested) : null;
    const statusRaw = pick(raw, f.appointment.status);
    const statusLabel = isObject(statusRaw)
      ? text(pick(statusRaw, ["name", "title", "label", "code"]))
      : text(statusRaw);
    let status = statusOf(statusLabel, config.statusCodes);
    const treatment = booleanOf(pick(raw, f.appointment.treatmentStarted));
    if (treatment && ["arrived", "completed"].includes(status)) {
      status = "in_treatment";
    }
    const start =
      dateTimeOf(
        pick(raw, f.appointment.start),
        config.timezoneOffset,
        pick(raw, f.appointment.time),
      ) ??
      dateTimeOf(
        pick(raw, f.appointment.date),
        config.timezoneOffset,
        pick(raw, f.appointment.time),
      );
    const appointment: MisAppointment = {
      external_id: externalId,
      patient_external_id:
        idOf(pick(raw, f.appointment.patientId)) ??
        patient?.external_id ??
        null,
      starts_at: start,
      ends_at: dateTimeOf(pick(raw, f.appointment.end), config.timezoneOffset),
      completed_at: dateTimeOf(
        pick(raw, f.appointment.completedAt),
        config.timezoneOffset,
      ),
      status,
      status_label: statusLabel,
      doctor: doctorOf(raw),
      service: (() => {
        const value = pick(raw, f.appointment.service);
        if (Array.isArray(value)) {
          return (
            value
              .map((item) =>
                isObject(item)
                  ? text(pick(item, ["name", "title", "название"]))
                  : text(item),
              )
              .filter(Boolean)[0] ?? null
          );
        }
        return isObject(value)
          ? text(pick(value, ["name", "title", "название"]))
          : text(value);
      })(),
      comment: text(pick(raw, f.appointment.comment)),
    };
    if (patient) appointment.patient = patient;
    return appointment;
  };

  const mapPayment = (raw: unknown): MisPayment | null => {
    if (!isObject(raw)) return null;
    const externalId = idOf(pick(raw, f.payment.id));
    const amount = amountOf(pick(raw, f.payment.amount));
    if (!externalId || amount == null || amount <= 0) return null;
    const nested = pick(raw, f.payment.patient);
    const patient = isObject(nested) ? mapPatient(nested) : null;
    const type = text(pick(raw, f.payment.type)) ?? "";
    const comment = text(pick(raw, f.payment.comment));
    const payment: MisPayment = {
      external_id: externalId,
      amount,
      paid_at: dateOf(pick(raw, f.payment.date)),
      kind:
        PREPAYMENT.test(type) || PREPAYMENT.test(comment ?? "")
          ? "prepayment"
          : "payment",
      comment,
      appointment_external_id: idOf(pick(raw, f.payment.appointmentId)),
      patient_external_id:
        idOf(pick(raw, f.payment.patientId)) ?? patient?.external_id ?? null,
    };
    if (patient) payment.patient = patient;
    return payment;
  };

  /** A finished visit as the argument of public.mis_visit_completed */
  const toVisit = (appointment: MisAppointment): MisVisit => ({
    appointment_external_id: appointment.external_id,
    completed_at: appointment.completed_at ?? appointment.starts_at ?? null,
    treatment_started: appointment.status === "in_treatment",
    patient: appointment.patient,
    patient_external_id: appointment.patient_external_id,
  });

  /**
   * What a push of the MIS carries: { event, data } (names in the config),
   * or a bare record whose kind is guessed from its fields. A list of
   * records is accepted too.
   */
  const parseWebhook = (body: unknown): MisItem[] => {
    if (Array.isArray(body)) return body.flatMap(parseWebhook);
    if (!isObject(body)) return [];
    const event = text(pick(body, config.webhook.eventKeys))?.toLowerCase();
    const data = pick(body, config.webhook.dataKeys);
    const records = Array.isArray(data) ? data : [isObject(data) ? data : body];
    const type = event
      ? Object.entries(config.webhook.events).find(([name]) =>
          event.includes(name),
        )?.[1]
      : undefined;
    const items: MisItem[] = [];
    for (const record of records) {
      const kind = type ?? guessType(record);
      if (kind === "patient") {
        const patient = mapPatient(record);
        if (patient) items.push({ type: "patient", data: patient });
      } else if (kind === "payment") {
        const payment = mapPayment(record);
        if (payment) items.push({ type: "payment", data: payment });
      } else if (kind === "appointment" || kind === "visit") {
        const appointment = mapAppointment(record);
        if (!appointment) continue;
        if (
          kind === "visit" &&
          !["cancelled", "no_show"].includes(appointment.status)
        ) {
          items.push({ type: "visit", data: toVisit(appointment) });
        } else {
          items.push({ type: "appointment", data: appointment });
        }
      }
    }
    return items;
  };

  const guessType = (record: unknown): MisItem["type"] | undefined => {
    if (!isObject(record)) return undefined;
    if (pick(record, f.payment.amount) != null) return "payment";
    if (
      pick(record, f.appointment.start) != null ||
      pick(record, f.appointment.date) != null ||
      pick(record, f.appointment.status) != null
    ) {
      return "appointment";
    }
    if (pick(record, f.patient.phones) != null) return "patient";
    return undefined;
  };

  // --- requests ------------------------------------------------------------

  const baseUrl = (connection: Connection) =>
    (connection.base_url || config.defaultBaseUrl).replace(/\/+$/, "");

  const request = (
    connection: Connection,
    path: string,
    method = "GET",
    params: Record<string, string> = {},
    body?: unknown,
  ): HttpRequest => {
    const url = new URL(`${baseUrl(connection)}${path}`);
    for (const [key, value] of Object.entries({
      ...(config.query.extra ?? {}),
      ...params,
    })) {
      url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    if (config.auth.in === "header") {
      headers[config.auth.name] =
        `${config.auth.prefix}${connection.api_key ?? ""}`;
    } else {
      url.searchParams.set(config.auth.name, connection.api_key ?? "");
    }
    const init: HttpRequest["init"] = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return { url: url.toString(), init };
  };

  const pingRequest = (connection: Connection) =>
    request(connection, config.endpoints.ping, "GET", {
      [config.query.perPage]: "1",
    });

  /** One page of the records of a resource changed since the cursor */
  const listRequest = (
    connection: Connection,
    resource: MisResource,
    since: string | null,
    page: number,
  ) =>
    request(connection, config.endpoints[resource], "GET", {
      ...(since ? { [config.query.since]: since } : {}),
      [config.query.page]: String(page),
      [config.query.perPage]: String(config.perPage),
    });

  /** The records of a list answer (a bare array or { data: [...] }) */
  const listItems = (json: unknown): unknown[] => {
    if (Array.isArray(json)) return json;
    const value = pick(json, config.listKeys);
    if (Array.isArray(value)) return value;
    if (isObject(value)) return listItems(value);
    return [];
  };

  /** Push: the patient first when the MIS does not know them yet */
  const createPatientRequest = (
    connection: Connection,
    patient: Payload,
  ): HttpRequest =>
    request(
      connection,
      config.endpoints.createPatient,
      "POST",
      {},
      {
        last_name: text(patient.last_name),
        first_name: text(patient.first_name),
        middle_name: text(patient.middle_name),
        phone: Array.isArray(patient.phones) ? patient.phones[0] : null,
        phones: Array.isArray(patient.phones) ? patient.phones : [],
        birth_date: text(patient.birth_date),
        crm_id: patient.id ?? null,
      },
    );

  const createAppointmentRequest = (
    connection: Connection,
    patientExternalId: string,
    appointment: Payload,
  ): HttpRequest =>
    request(
      connection,
      config.endpoints.createAppointment,
      "POST",
      {},
      {
        patient_id: patientExternalId,
        start: text(appointment.starts_at),
        doctor_id: text(appointment.doctor_external_id),
        doctor_name: text(appointment.doctor_name),
        service: text(appointment.service),
        comment: text(appointment.comment),
        source: "DentalCRM",
      },
    );

  /** The id of a created record in the answer */
  const createdId = (json: unknown): string | null => {
    const direct = idOf(pick(json, config.createdIdKeys));
    if (direct) return direct;
    const data = pick(json, config.listKeys);
    return isObject(data) ? idOf(pick(data, config.createdIdKeys)) : null;
  };

  return {
    config,
    mapPatient,
    mapAppointment,
    mapPayment,
    toVisit,
    parseWebhook,
    pingRequest,
    listRequest,
    listItems,
    createPatientRequest,
    createAppointmentRequest,
    createdId,
  };
};

export type MisAdapter = ReturnType<typeof createAdapter>;
