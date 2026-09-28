import type { Identifier } from "ra-core";

/** MIS with a working connector (stage 27) */
export type MisKind = "dentist_plus" | "macdent";

/** Appointment statuses the connectors understand (vendor-neutral) */
export type MisStatus =
  | "scheduled"
  | "confirmed"
  | "arrived"
  | "completed"
  | "in_treatment"
  | "cancelled"
  | "no_show";

/** What a MIS status does to the deal: move it to a stage, or add a tag */
export type MisStatusTarget = { stage_id?: Identifier; tag_id?: Identifier };
export type MisStatusMap = Partial<Record<MisStatus, MisStatusTarget>>;

export type MisConnectionState =
  | "requested"
  | "connected"
  | "error"
  | "disabled";

/** public.mis_connection_status(kind): the connection without its key */
export type MisConnection = {
  id: Identifier;
  kind: MisKind;
  status: MisConnectionState;
  base_url: string | null;
  has_api_key: boolean;
  webhook_token: string;
  /** Address of the mis_webhook edge function, built by the data provider */
  webhook_url?: string;
  sync_patients: boolean;
  sync_appointments: boolean;
  sync_payments: boolean;
  push_appointments: boolean;
  status_map: MisStatusMap;
  last_sync_at: string | null;
  last_error: string | null;
  connected_at: string | null;
  created_at: string;
};

/** What the settings save (public.save_mis_connection) */
export type MisConnectionPatch = Partial<
  Pick<
    MisConnection,
    | "base_url"
    | "sync_patients"
    | "sync_appointments"
    | "sync_payments"
    | "push_appointments"
    | "status_map"
  >
> & {
  /** null or absent: keep the stored key; "": remove it */
  api_key?: string | null;
};

/** One line of public.mis_sync_log */
export type MisSyncLogEntry = {
  id: Identifier;
  kind: MisKind;
  direction: "in" | "out";
  operation: string;
  external_id: string | null;
  result: "ok" | "skipped" | "error";
  message: string | null;
  patient_id: Identifier | null;
  deal_id: Identifier | null;
  created_at: string;
};

/** A doctor of the MIS and the clinic doctor it is linked to */
export type MisDoctor = {
  id: Identifier;
  kind: MisKind;
  external_id: string;
  name: string;
  doctor_id: Identifier | null;
  created_at?: string;
};

/** An appointment synced from the MIS (the «Визиты из МИС» block) */
export type MisAppointment = {
  id: Identifier;
  kind: MisKind;
  external_id: string;
  patient_id: Identifier;
  deal_id: Identifier | null;
  doctor_id: Identifier | null;
  doctor_external_id?: string | null;
  doctor_name: string | null;
  service_name: string | null;
  status: MisStatus;
  status_label: string | null;
  starts_at: string | null;
  ends_at?: string | null;
  completed_at: string | null;
  comment: string | null;
  created_at?: string;
  updated_at?: string;
};

/** Answer of «Проверить подключение» and «Синхронизировать сейчас» */
export type MisActionResult = {
  ok: boolean;
  message: string;
  processed?: number;
  skipped?: number;
  errors?: number;
};
