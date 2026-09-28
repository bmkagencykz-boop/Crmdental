// @vitest-environment node
import { describe, expect, it } from "vitest";
import { dentistPlus, DENTIST_PLUS_CONFIG } from "./dentistPlus";
import { macdent, MACDENT_CONFIG } from "./macdent";

const connection = {
  id: 1,
  kind: "dentist_plus" as const,
  base_url: "https://clinic.dentist-plus.test/api/",
  api_key: "secret-key",
};

describe("Dentist Plus: records", () => {
  it("maps a patient with Russian field names", () => {
    expect(
      dentistPlus.mapPatient({
        id: 1042,
        ФИО: "Ахметова Асель Нурлановна",
        Телефон: "8 (701) 111-22-33",
        Дата_рождения: "04.05.1990",
      }),
    ).toEqual({
      external_id: "1042",
      first_name: null,
      last_name: null,
      middle_name: null,
      full_name: "Ахметова Асель Нурлановна",
      phones: ["8 (701) 111-22-33"],
      birth_date: "1990-05-04",
    });
  });

  it("maps a patient with English names and several phones", () => {
    const patient = dentistPlus.mapPatient({
      patient_id: "p-7",
      firstName: "Ерлан",
      lastName: "Жаксыбеков",
      phones: [{ number: "+77020001122", type: "mobile" }, "87023334455"],
      birthday: "1985-02-11",
    });
    expect(patient).toMatchObject({
      external_id: "p-7",
      first_name: "Ерлан",
      last_name: "Жаксыбеков",
      phones: ["+77020001122", "87023334455"],
      birth_date: "1985-02-11",
    });
  });

  it("drops a patient with neither id nor phone", () => {
    expect(dentistPlus.mapPatient({ name: "Без данных" })).toBeNull();
    expect(dentistPlus.mapPatient("text")).toBeNull();
  });

  it("maps a visit with date and time fields, nested patient and doctor", () => {
    const visit = dentistPlus.mapAppointment({
      visit_id: 5501,
      date: "15.10.2026",
      time: "10:30",
      status: "Записан",
      patient: { id: 1042, phone: "+77011112233", fio: "Ахметова Асель" },
      doctor: { id: 12, last_name: "Иванов", first_name: "Иван" },
      services: [{ name: "Консультация ортодонта" }],
      comment: "Первичный",
    });
    expect(visit).toEqual({
      external_id: "5501",
      patient_external_id: "1042",
      patient: {
        external_id: "1042",
        first_name: null,
        last_name: null,
        middle_name: null,
        full_name: "Ахметова Асель",
        phones: ["+77011112233"],
        birth_date: null,
      },
      starts_at: "2026-10-15T05:30:00.000Z",
      ends_at: null,
      completed_at: null,
      status: "scheduled",
      status_label: "Записан",
      doctor: { external_id: "12", name: "Иванов Иван" },
      service: "Консультация ортодонта",
      comment: "Первичный",
    });
  });

  it("maps status codes, a status object and the treatment flag", () => {
    expect(
      dentistPlus.mapAppointment({
        id: 1,
        start: "2026-10-15T10:00:00+05:00",
        status: 3,
      })?.status,
    ).toBe("completed");
    expect(
      dentistPlus.mapAppointment({
        id: 1,
        status: { id: 9, name: "Не пришёл" },
      }),
    ).toMatchObject({
      status: "no_show",
      status_label: "Не пришёл",
    });
    expect(
      dentistPlus.mapAppointment({
        id: 1,
        status: "Визит состоялся",
        treatment_started: "да",
      })?.status,
    ).toBe("in_treatment");
    expect(dentistPlus.mapAppointment({ status: "Записан" })).toBeNull();
  });

  it("maps payments, prepayments by type or purpose", () => {
    expect(
      dentistPlus.mapPayment({
        id: 88,
        patient_id: 1042,
        visit_id: 5501,
        sum: "50 000",
        date: "16.10.2026",
        type: "Предоплата",
      }),
    ).toEqual({
      external_id: "88",
      amount: 50000,
      paid_at: "2026-10-16",
      kind: "prepayment",
      comment: null,
      appointment_external_id: "5501",
      patient_external_id: "1042",
    });
    expect(
      dentistPlus.mapPayment({
        id: 89,
        amount: 1000,
        purpose: "Аванс за лечение",
      })?.kind,
    ).toBe("prepayment");
    expect(
      dentistPlus.mapPayment({ id: 90, amount: 1000, method: "Kaspi" })?.kind,
    ).toBe("payment");
    expect(dentistPlus.mapPayment({ id: 91, amount: 0 })).toBeNull();
    expect(dentistPlus.mapPayment({ amount: 100 })).toBeNull();
  });
});

describe("Dentist Plus: webhooks", () => {
  it("reads { event, data } pushes", () => {
    expect(
      dentistPlus.parseWebhook({
        event: "visit.completed",
        data: {
          id: 5501,
          patient_id: 1042,
          date: "2026-10-15 11:00",
          status: "Завершён",
        },
      }),
    ).toEqual([
      {
        type: "visit",
        data: {
          appointment_external_id: "5501",
          completed_at: "2026-10-15T06:00:00.000Z",
          treatment_started: false,
          patient: undefined,
          patient_external_id: "1042",
        },
      },
    ]);
    const [payment] = dentistPlus.parseWebhook({
      event: "payment.created",
      payload: { id: 7, amount: 15000, patient_id: 1 },
    });
    expect(payment).toMatchObject({
      type: "payment",
      data: { external_id: "7", amount: 15000 },
    });
  });

  it("guesses bare records and lists", () => {
    const items = dentistPlus.parseWebhook([
      { id: 1, phone: "+77011112233" },
      { id: 2, start: "2026-10-15T10:00:00+05:00", patient_id: 1 },
      { id: 3, amount: 100, patient_id: 1 },
      { nothing: true },
    ]);
    expect(items.map((item) => item.type)).toEqual([
      "patient",
      "appointment",
      "payment",
    ]);
  });

  it("keeps a cancelled visit event an appointment", () => {
    const [item] = dentistPlus.parseWebhook({
      event: "visit_completed",
      data: { id: 1, status: "Отменён" },
    });
    expect(item).toMatchObject({
      type: "appointment",
      data: { status: "cancelled" },
    });
  });
});

describe("Dentist Plus: requests", () => {
  it("sends the key in the Authorization header", () => {
    const request = dentistPlus.listRequest(
      connection,
      "appointments",
      "2026-10-01T00:00:00.000Z",
      2,
    );
    expect(request.url).toBe(
      "https://clinic.dentist-plus.test/api/visits?updated_from=2026-10-01T00%3A00%3A00.000Z&page=2&per_page=100",
    );
    expect(request.init).toEqual({
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer secret-key",
      },
    });
  });

  it("uses the default address when the clinic left it empty", () => {
    expect(dentistPlus.pingRequest({ ...connection, base_url: null }).url).toBe(
      `${DENTIST_PLUS_CONFIG.defaultBaseUrl}/patients?per_page=1`,
    );
  });

  it("builds the push of a patient and an appointment", () => {
    const patient = dentistPlus.createPatientRequest(connection, {
      id: 33,
      first_name: "Мадина",
      phones: ["+77074445566"],
    });
    expect(patient.init.method).toBe("POST");
    expect(JSON.parse(patient.init.body!)).toMatchObject({
      first_name: "Мадина",
      phone: "+77074445566",
      crm_id: 33,
    });
    const appointment = dentistPlus.createAppointmentRequest(connection, "P9", {
      starts_at: "2026-11-02T10:00:00+00:00",
      doctor_external_id: "D1",
      service: "Гигиена",
    });
    expect(appointment.url).toBe("https://clinic.dentist-plus.test/api/visits");
    expect(JSON.parse(appointment.init.body!)).toMatchObject({
      patient_id: "P9",
      start: "2026-11-02T10:00:00+00:00",
      doctor_id: "D1",
      service: "Гигиена",
    });
  });

  it("reads list answers and created ids", () => {
    expect(dentistPlus.listItems([{ id: 1 }])).toHaveLength(1);
    expect(
      dentistPlus.listItems({ data: [{ id: 1 }, { id: 2 }] }),
    ).toHaveLength(2);
    expect(
      dentistPlus.listItems({ result: { items: [{ id: 1 }] } }),
    ).toHaveLength(0);
    expect(dentistPlus.createdId({ id: 501 })).toBe("501");
    expect(dentistPlus.createdId({ data: { visit_id: "v-9" } })).toBe("v-9");
    expect(dentistPlus.createdId({ ok: true })).toBeNull();
  });
});

describe("MacDent", () => {
  const macConnection = {
    ...connection,
    kind: "macdent" as const,
    base_url: null,
  };

  it("maps camelCase records", () => {
    expect(
      macdent.mapAppointment({
        appointmentId: 77,
        patientId: 5,
        startDate: "2026-10-20T09:00:00",
        status: "came",
        doctorId: 3,
        doctorName: "Сейткали Дана",
      }),
    ).toMatchObject({
      external_id: "77",
      patient_external_id: "5",
      starts_at: "2026-10-20T04:00:00.000Z",
      status: "arrived",
      doctor: { external_id: "3", name: "Сейткали Дана" },
    });
    expect(
      macdent.mapPatient({
        id: 5,
        lastName: "Нуржан",
        cellphone: "87030000003",
      }),
    ).toMatchObject({
      external_id: "5",
      last_name: "Нуржан",
      phones: ["87030000003"],
    });
    expect(
      macdent.mapPayment({
        paymentId: 4,
        sum: 20000,
        appointmentId: 77,
        paymentType: "deposit",
      }),
    ).toMatchObject({
      external_id: "4",
      kind: "prepayment",
      appointment_external_id: "77",
    });
  });

  it("sends the key as access_token", () => {
    const request = macdent.listRequest(macConnection, "payments", null, 1);
    expect(request.url).toBe(
      `${MACDENT_CONFIG.defaultBaseUrl}/payments?page=1&limit=100&access_token=secret-key`,
    );
    expect(request.init.headers).not.toHaveProperty("Authorization");
  });

  it("reads its webhook events", () => {
    const items = macdent.parseWebhook({
      type: "appointment.completed",
      appointment: { id: 77, patientId: 5, status: "done" },
    });
    expect(items).toEqual([
      expect.objectContaining({
        type: "visit",
        data: expect.objectContaining({ appointment_external_id: "77" }),
      }),
    ]);
  });
});
