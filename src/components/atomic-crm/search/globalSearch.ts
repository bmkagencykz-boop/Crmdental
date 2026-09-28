import type { Identifier } from "ra-core";

import { formatPhone } from "../misc/formatPhone";
import { normalizePhone } from "../providers/commons/domain";
import type {
  Deal,
  ExternalRef,
  Message,
  MessengerTransport,
  Patient,
  Sale,
  Stage,
  StageKind,
  Task,
} from "../types";

/**
 * Global search (stage 31): the matching rules of public.global_search
 * (supabase/schemas/31_search.sql), shared by the demo data provider and
 * the search field (highlighting, quick create).
 */

// --- Results ---------------------------------------------------------------

export type SearchPatient = {
  id: Identifier;
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
  phones: string[];
  birth_date?: string | null;
  /** Number of the patient in a MIS (external_refs) */
  card?: string | null;
  rank: number;
};

export type SearchDeal = {
  id: Identifier;
  name?: string | null;
  patient_id: Identifier;
  patient_first_name?: string | null;
  patient_last_name?: string | null;
  pipeline_id: Identifier;
  stage_id: Identifier;
  stage_name?: string | null;
  stage_kind?: StageKind | null;
  stage_color?: string | null;
  sales_id?: Identifier | null;
  sales_name?: string | null;
  plan_amount: number;
  archived_at?: string | null;
  rank: number;
};

export type SearchTask = {
  id: Identifier;
  text: string;
  type: string;
  due_date: string;
  done_date?: string | null;
  deal_id: Identifier;
  sales_id?: Identifier | null;
  patient_id: Identifier;
  patient_first_name?: string | null;
  patient_last_name?: string | null;
};

export type SearchMessage = {
  id: Identifier;
  deal_id: Identifier;
  patient_id: Identifier;
  patient_first_name?: string | null;
  patient_last_name?: string | null;
  direction: "in" | "out";
  transport: MessengerTransport;
  sent_at: string;
  snippet: string;
};

export type GlobalSearchResult = {
  patients: SearchPatient[];
  deals: SearchDeal[];
  tasks: SearchTask[];
  messages: SearchMessage[];
};

export const SEARCH_KINDS = ["patients", "deals", "tasks", "messages"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const emptySearchResult = (): GlobalSearchResult => ({
  patients: [],
  deals: [],
  tasks: [],
  messages: [],
});

// --- Normalization ---------------------------------------------------------

/** Same as private.search_norm: lower case, ё = е */
export const searchNorm = (value?: string | null) =>
  (value ?? "").toLowerCase().replace(/ё/g, "е");

/** Same as private.patient_search_name: « фамилия имя отчество» */
export const patientSearchName = (patient: {
  last_name?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
}) =>
  " " +
  searchNorm(
    `${patient.last_name ?? ""} ${patient.first_name ?? ""} ${patient.middle_name ?? ""}`,
  );

/** Same as private.phones_search_digits */
export const phonesSearchDigits = (phones?: string[] | null) =>
  (phones ?? []).join(" ").replace(/[^0-9 ]/g, "");

export type ParsedQuery = {
  raw: string;
  /** Normalized, LIKE wildcards removed */
  norm: string;
  isPhone: boolean;
  /** Digits looked for inside the phones (phone queries) */
  phoneDigits: string | null;
  /** +7XXXXXXXXXX when the query is a whole number */
  exactPhone: string | null;
  /** «#12», «№12» or up to 6 digits: card or deal number */
  idNumber: number | null;
  nameWords: string[];
  digitWords: string[];
  /** Messages: the query as one phrase */
  phrase: string | null;
};

/** Same parsing as public.global_search */
export const parseSearchQuery = (q: string): ParsedQuery | null => {
  const raw = (q ?? "").trim();
  if ([...raw].length < 2) return null;
  const norm = searchNorm(raw)
    .replace(/[%_\\]+/g, " ")
    .trim();
  let tokens = norm.split(/\s+/).filter(Boolean);
  const isPhone = !/[^0-9\s()+-]/.test(raw);
  const idNumber =
    /^[#№]\s*[0-9]{1,18}$/.test(raw) || /^[0-9]{1,6}$/.test(raw)
      ? Number(raw.replace(/[^0-9]/g, ""))
      : null;
  let phoneDigits: string | null = null;
  let exactPhone: string | null = null;
  let nameWords: string[] = [];
  let digitWords: string[] = [];
  let phrase: string | null = null;
  if (isPhone) {
    const all = raw.replace(/[^0-9]/g, "");
    phoneDigits = all;
    if (phoneDigits.length >= 4 && /^[78]7/.test(phoneDigits)) {
      phoneDigits = phoneDigits.slice(1);
    }
    if (phoneDigits.length < 3) phoneDigits = null;
    if (all.length >= 10) exactPhone = normalizePhone(raw);
  } else {
    tokens = tokens.map((t) => t.replace(/^[#№]/, "")).filter(Boolean);
    nameWords = tokens.filter((t) => !/^[0-9]+$/.test(t));
    digitWords = tokens.filter((t) => /^[0-9]+$/.test(t) && t.length >= 3);
    phrase = [...norm].length >= 3 ? norm : null;
  }
  return {
    raw,
    norm,
    isPhone,
    phoneDigits,
    exactPhone,
    idNumber,
    nameWords,
    digitWords,
    phrase,
  };
};

// --- Matching --------------------------------------------------------------

const hasWord = (text: string, word: string) => text.includes(` ${word}`);
const phonesHaveAll = (phones: string[] | undefined, words: string[]) => {
  const digits = phonesSearchDigits(phones);
  return words.every((w) => digits.includes(w));
};
const phonesHave = (phones: string[] | undefined, digits: string | null) =>
  digits != null && phonesSearchDigits(phones).includes(digits);
const same = (a: Identifier | null | undefined, b: number | null) =>
  a != null && b != null && String(a) === String(b);

/** Rank of a patient (null: not found), as in public.global_search */
export const matchPatient = (
  patient: Pick<
    Patient,
    "first_name" | "last_name" | "middle_name" | "phones"
  > & { id: Identifier },
  query: ParsedQuery,
  card?: string | null,
): number | null => {
  const name = patientSearchName(patient);
  const { nameWords, digitWords, phoneDigits, idNumber, exactPhone, raw } =
    query;
  const found =
    phonesHave(patient.phones, phoneDigits) ||
    same(patient.id, idNumber) ||
    (card != null && card === raw) ||
    (nameWords.length > 0 &&
      nameWords.every((w) => hasWord(name, w)) &&
      phonesHaveAll(patient.phones, digitWords));
  if (!found) return null;
  if (exactPhone && (patient.phones ?? []).includes(exactPhone)) return 0;
  if (same(patient.id, idNumber) || (card != null && card === raw)) return 1;
  if (nameWords.length > 0 && name.trim() === nameWords.join(" ")) return 2;
  if (nameWords.length > 0 && name.startsWith(` ${nameWords[0]}`)) return 3;
  if (nameWords.length > 0) return 4;
  return 5;
};

/** Rank of a deal (null: not found) */
export const matchDeal = (
  deal: Pick<Deal, "id" | "name">,
  patient: Pick<Patient, "first_name" | "last_name" | "middle_name" | "phones">,
  query: ParsedQuery,
): number | null => {
  const patientName = patientSearchName(patient);
  const dealName = ` ${searchNorm(deal.name)}`;
  const text = `${patientName} ${searchNorm(deal.name)}`;
  const { nameWords, digitWords, phoneDigits, idNumber, exactPhone } = query;
  const found =
    same(deal.id, idNumber) ||
    phonesHave(patient.phones, phoneDigits) ||
    (nameWords.length > 0 &&
      nameWords.every((w) => hasWord(text, w)) &&
      phonesHaveAll(patient.phones, digitWords));
  if (!found) return null;
  if (same(deal.id, idNumber)) return 0;
  if (exactPhone && (patient.phones ?? []).includes(exactPhone)) return 1;
  if (
    nameWords.length > 0 &&
    (patientName.startsWith(` ${nameWords[0]}`) ||
      dealName.startsWith(` ${nameWords[0]}`))
  )
    return 2;
  if (nameWords.length > 0) return 3;
  return 4;
};

/** Is the task found: by its text or the patient of its deal */
export const matchTask = (
  task: Pick<Task, "text">,
  patient: Pick<Patient, "first_name" | "last_name" | "middle_name" | "phones">,
  query: ParsedQuery,
) => {
  const text = `${patientSearchName(patient)} ${searchNorm(task.text)}`;
  const { nameWords, digitWords, phoneDigits } = query;
  return (
    phonesHave(patient.phones, phoneDigits) ||
    (nameWords.length > 0 &&
      nameWords.every((w) => hasWord(text, w)) &&
      phonesHaveAll(patient.phones, digitWords))
  );
};

/** The snippet of a found message (null: not found) */
export const matchMessage = (
  message: Pick<Message, "text">,
  query: ParsedQuery,
): string | null => {
  if (!query.phrase || !message.text) return null;
  const index = searchNorm(message.text).indexOf(query.phrase);
  if (index < 0) return null;
  const start = Math.max(index - 40, 0);
  const text = message.text;
  return (
    (start > 0 ? "…" : "") +
    text.slice(start, start + 160) +
    (text.length >= start + 160 + 1 ? "…" : "")
  );
};

// --- In memory (the demo) --------------------------------------------------

export type SearchData = {
  patients: Patient[];
  deals: Deal[];
  tasks: Task[];
  messages: Message[];
  stages: Stage[];
  sales: Sale[];
  external_refs?: ExternalRef[];
  /** Row level security of deals */
  canSeeDeal?: (deal: Deal) => boolean;
};

const time = (value?: string | null) => (value ? Date.parse(value) : 0);
const byId = <T extends { id: Identifier }>(rows: T[]) =>
  new Map(rows.map((row) => [String(row.id), row]));

/** public.global_search over arrays of records */
export const globalSearchInMemory = (
  data: SearchData,
  q: string,
  maxPerKind = 5,
): GlobalSearchResult => {
  const query = parseSearchQuery(q);
  if (!query) return emptySearchResult();
  const limit = Math.min(Math.max(Math.floor(maxPerKind) || 5, 1), 50);
  const patientsById = byId(data.patients);
  const stagesById = byId(data.stages);
  const salesById = byId(data.sales);
  const visibleDeals = data.deals.filter(
    (deal) => !data.canSeeDeal || data.canSeeDeal(deal),
  );
  const dealsById = byId(visibleDeals);
  const cards = new Map<string, string>();
  for (const ref of data.external_refs ?? []) {
    if (ref.entity !== "patient") continue;
    const key = String(ref.entity_id);
    const current = cards.get(key);
    if (current == null || ref.external_id < current) {
      cards.set(key, ref.external_id);
    }
  }
  // A patient is found by any of their MIS numbers, shown with the smallest
  const cardHits = new Set(
    (data.external_refs ?? [])
      .filter(
        (ref) => ref.entity === "patient" && ref.external_id === query.raw,
      )
      .map((ref) => String(ref.entity_id)),
  );

  const patients = data.patients
    .map((patient) => {
      const card = cards.get(String(patient.id)) ?? null;
      let rank = matchPatient(patient, query, card);
      if (rank == null && cardHits.has(String(patient.id))) rank = 1;
      return rank == null ? null : { patient, card, rank };
    })
    .filter((row) => row != null)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        time(b.patient.last_seen) - time(a.patient.last_seen) ||
        Number(b.patient.id) - Number(a.patient.id),
    )
    .slice(0, limit)
    .map(
      ({ patient, card, rank }): SearchPatient => ({
        id: patient.id,
        first_name: patient.first_name,
        last_name: patient.last_name,
        middle_name: patient.middle_name ?? null,
        phones: patient.phones ?? [],
        birth_date: patient.birth_date ?? null,
        card,
        rank,
      }),
    );

  const isOpen = (deal: Deal) => {
    const stage = stagesById.get(String(deal.stage_id));
    return stage?.kind === "open" && !deal.archived_at;
  };
  const deals = visibleDeals
    .map((deal) => {
      const patient = patientsById.get(String(deal.patient_id));
      if (!patient) return null;
      const rank = matchDeal(deal, patient, query);
      return rank == null ? null : { deal, patient, rank };
    })
    .filter((row) => row != null)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(isOpen(b.deal)) - Number(isOpen(a.deal)) ||
        time(b.deal.updated_at) - time(a.deal.updated_at) ||
        Number(b.deal.id) - Number(a.deal.id),
    )
    .slice(0, limit)
    .map(({ deal, patient, rank }): SearchDeal => {
      const stage = stagesById.get(String(deal.stage_id));
      const sale =
        deal.sales_id != null ? salesById.get(String(deal.sales_id)) : null;
      return {
        id: deal.id,
        name: deal.name ?? null,
        patient_id: deal.patient_id,
        patient_first_name: patient.first_name,
        patient_last_name: patient.last_name,
        pipeline_id: deal.pipeline_id,
        stage_id: deal.stage_id,
        stage_name: stage?.name ?? null,
        stage_kind: stage?.kind ?? null,
        stage_color: stage?.color ?? null,
        sales_id: deal.sales_id ?? null,
        sales_name: sale
          ? `${sale.first_name ?? ""} ${sale.last_name ?? ""}`.trim() || null
          : null,
        plan_amount: deal.plan_amount ?? 0,
        archived_at: deal.archived_at ?? null,
        rank,
      };
    });

  const tasks = data.tasks
    .map((task) => {
      const deal = dealsById.get(String(task.deal_id));
      const patient = deal && patientsById.get(String(deal.patient_id));
      if (!deal || !patient || !matchTask(task, patient, query)) return null;
      return { task, patient };
    })
    .filter((row) => row != null)
    .sort(
      (a, b) =>
        Number(!b.task.done_date) - Number(!a.task.done_date) ||
        time(a.task.due_date) - time(b.task.due_date) ||
        Number(a.task.id) - Number(b.task.id),
    )
    .slice(0, limit)
    .map(
      ({ task, patient }): SearchTask => ({
        id: task.id,
        text: task.text,
        type: task.type,
        due_date: task.due_date,
        done_date: task.done_date ?? null,
        deal_id: task.deal_id,
        sales_id: task.sales_id ?? null,
        patient_id: patient.id,
        patient_first_name: patient.first_name,
        patient_last_name: patient.last_name,
      }),
    );

  const messages = data.messages
    .map((message) => {
      if (!dealsById.has(String(message.deal_id))) return null;
      const patient = patientsById.get(String(message.patient_id));
      const snippet = patient ? matchMessage(message, query) : null;
      return snippet == null || !patient ? null : { message, patient, snippet };
    })
    .filter((row) => row != null)
    .sort(
      (a, b) =>
        time(b.message.sent_at) - time(a.message.sent_at) ||
        Number(b.message.id) - Number(a.message.id),
    )
    .slice(0, limit)
    .map(
      ({ message, patient, snippet }): SearchMessage => ({
        id: message.id,
        deal_id: message.deal_id,
        patient_id: message.patient_id,
        patient_first_name: patient.first_name,
        patient_last_name: patient.last_name,
        direction: message.direction,
        transport: message.transport,
        sent_at: message.sent_at,
        snippet,
      }),
    );

  return { patients, deals, tasks, messages };
};

// --- Display helpers -------------------------------------------------------

export { formatPhone };

/** «Фамилия Имя Отчество» */
export const fullName = (row: {
  last_name?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
}) =>
  [row.last_name, row.first_name, row.middle_name]
    .filter((part) => part && part.trim())
    .join(" ");

/**
 * Parts of a text with the query words marked, for highlighting: words of
 * the query found at the beginning of a word (names) or anywhere (phrases,
 * digits).
 */
export const highlightParts = (
  text: string,
  q: string,
): { text: string; hit: boolean }[] => {
  const query = parseSearchQuery(q);
  if (!query || !text) return [{ text, hit: false }];
  const needles = [
    ...query.nameWords,
    ...query.digitWords,
    ...(query.phrase && query.nameWords.length > 1 ? [query.phrase] : []),
  ].filter((n) => n.length > 0);
  if (needles.length === 0) return [{ text, hit: false }];
  const norm = searchNorm(text);
  const marks = new Array<boolean>(text.length).fill(false);
  for (const needle of needles) {
    let from = 0;
    for (;;) {
      const index = norm.indexOf(needle, from);
      if (index < 0) break;
      for (let i = index; i < index + needle.length; i++) marks[i] = true;
      from = index + needle.length;
    }
  }
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts.at(-1);
    if (last && last.hit === marks[i]) last.text += text[i];
    else parts.push({ text: text[i], hit: marks[i] });
  }
  return parts;
};

/**
 * «+ Новый пациент с номером …»: the number to create a patient with when a
 * phone query finds nobody (a whole Kazakh number only).
 */
export const quickCreatePhone = (q: string): string | null => {
  const query = parseSearchQuery(q);
  if (!query?.isPhone || !query.exactPhone) return null;
  return /^\+7\d{10}$/.test(query.exactPhone) ? query.exactPhone : null;
};
