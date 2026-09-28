import { useQueryClient } from "@tanstack/react-query";

import {
  useCanAccess,
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  useLeadSources,
  useLostReasons,
  usePipelines,
  useServices,
  useStages,
} from "../dictionaries/useDictionaries";
import { ACCENTS } from "../misc/accent";
import type { CrmDataProvider } from "../providers/types";
import { colors as tagColors } from "../tags/colors";
import type {
  CustomField,
  ImportBatchResult,
  Sale,
  Stage,
  Tag,
} from "../types";
import {
  entityFields,
  useCustomFields,
} from "../custom-fields/useCustomFields";
import {
  buildBatchRows,
  cellText,
  chunk,
  collectValues,
  CREATABLE_KINDS,
  customTarget,
  DEAL_FIELDS,
  effectiveMapping,
  errorRowsCsv,
  guessMapping,
  guessMode,
  IMPORT_FIELDS,
  initialResolutions,
  isDealTarget,
  parseRows,
  rowPipeline,
  sampleCsv,
  unknownValues,
  type Cell,
  type ColumnMapping,
  type DictionaryKind,
  type ImportDictionaries,
  type ImportMode,
  type MappingTarget,
  type ImportSystem,
  type ParsedRow,
  type Resolution,
  type Resolutions,
  type RowError,
} from "./importMapping";
import { downloadFile } from "./downloadFile";
import { isSupportedFile, readImportFile } from "./readImportFile";

const BATCH_SIZE = 200;
const PREVIEW_ROWS = 10;
const PREVIEW_ERRORS = 20;
const SKIP = "__skip__";
const NONE = "__none__";
const CREATE = "__create__";

type Step = "upload" | "mapping" | "review" | "importing" | "result";

type Outcome = {
  result: ImportBatchResult;
  failed: Array<{ cells: Cell[]; message: string }>;
};

const emptyResult = (): ImportBatchResult => ({
  created: 0,
  updated: 0,
  skipped: 0,
  patients_created: 0,
  patients_updated: 0,
  deals_created: 0,
  deals_updated: 0,
  errors: [],
});

/**
 * Import wizard: file → columns → check (unknown values, errors) → import in
 * batches (public.import_batch) → result with the rows that failed.
 */
export const ImportWizard = () => {
  const translate = useTranslate();
  const { canAccess, isPending: accessPending } = useCanAccess({
    resource: "configuration",
    action: "edit",
  });
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState<Cell[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  const [system, setSystem] = useState<ImportSystem>("excel");
  const [mode, setMode] = useState<ImportMode>("deals");
  const [resolutions, setResolutions] = useState<Resolutions | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const dictionaries = useImportDictionaries();
  const { data: customFields } = useCustomFields();
  const headers = useMemo(() => (sheet[0] ?? []).map(cellText), [sheet]);
  const rows = useMemo(
    () =>
      step === "upload"
        ? []
        : parseRows(
            sheet,
            effectiveMapping(mapping, mode, customFields),
            customFields,
          ),
    [sheet, mapping, mode, step, customFields],
  );

  if (accessPending) return null;
  if (!canAccess) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate("import.forbidden")}
      </p>
    );
  }

  const reset = () => {
    setStep("upload");
    setSheet([]);
    setMapping([]);
    setResolutions(null);
    setOutcome(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <Steps step={step} />
      {step === "upload" ? (
        <UploadStep
          onLoaded={(name, data) => {
            const guess = guessMapping(
              data[0].map(cellText),
              // Archived fields take no new values
              customFields.filter((field) => field.is_active),
            );
            setFileName(name);
            setSheet(data);
            setMapping(guess.mapping);
            setSystem(guess.system);
            setMode(guessMode(guess.mapping));
            setStep("mapping");
          }}
        />
      ) : null}
      {step === "mapping" ? (
        <MappingStep
          fileName={fileName}
          headers={headers}
          sheet={sheet}
          mapping={mapping}
          onMappingChange={setMapping}
          customFields={customFields}
          system={system}
          mode={mode}
          onModeChange={setMode}
          onBack={reset}
          onNext={() => {
            setResolutions(initialResolutions(rows, mode, dictionaries));
            setStep("review");
          }}
        />
      ) : null}
      {step === "review" && resolutions ? (
        <ReviewStep
          rows={rows}
          mode={mode}
          dictionaries={dictionaries}
          resolutions={resolutions}
          onResolutionsChange={setResolutions}
          onBack={() => setStep("mapping")}
          onStart={() => setStep("importing")}
        />
      ) : null}
      {step === "importing" && resolutions ? (
        <ImportRunner
          rows={rows}
          mode={mode}
          system={system}
          dictionaries={dictionaries}
          resolutions={resolutions}
          progress={progress}
          onProgress={setProgress}
          onDone={(value) => {
            setOutcome(value);
            setStep("result");
          }}
          onError={() => setStep("review")}
        />
      ) : null}
      {step === "result" && outcome ? (
        <ResultStep outcome={outcome} headers={headers} onAgain={reset} />
      ) : null}
    </div>
  );
};

const useImportDictionaries = (): ImportDictionaries => {
  const { data: pipelines } = usePipelines();
  const { data: stages } = useStages();
  const { data: sources } = useLeadSources();
  const { data: services } = useServices();
  const { data: lostReasons } = useLostReasons();
  const { data: sales } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "last_name", order: "ASC" },
  });
  const { data: tags } = useGetList<Tag>("tags", {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: "name", order: "ASC" },
  });
  return useMemo(
    () => ({
      pipelines,
      stages,
      sources,
      services,
      lostReasons,
      sales: (sales ?? []).filter((sale) => !sale.disabled),
      tags: tags ?? [],
    }),
    [pipelines, stages, sources, services, lostReasons, sales, tags],
  );
};

const STEP_ORDER: Array<Exclude<Step, "importing">> = [
  "upload",
  "mapping",
  "review",
  "result",
];

const Steps = ({ step }: { step: Step }) => {
  const translate = useTranslate();
  const current = STEP_ORDER.indexOf(step === "importing" ? "review" : step);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {STEP_ORDER.map((id, index) => (
        <li
          key={id}
          aria-current={index === current ? "step" : undefined}
          className={cn(
            "rounded-md px-3 py-1 font-medium",
            index === current
              ? "bg-primary text-primary-foreground"
              : index < current
                ? "bg-muted text-foreground"
                : "text-muted-foreground",
          )}
        >
          {index + 1}. {translate(`import.steps.${id}`)}
        </li>
      ))}
    </ol>
  );
};

const UploadStep = ({
  onLoaded,
}: {
  onLoaded: (name: string, sheet: Cell[][]) => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  const read = async (file: File | undefined) => {
    if (!file) return;
    if (!isSupportedFile(file.name)) {
      notify("import.upload.unsupported", { type: "error" });
      return;
    }
    setReading(true);
    try {
      const sheet = await readImportFile(file);
      if (sheet.length < 2) {
        notify("import.upload.empty", { type: "error" });
        return;
      }
      onLoaded(file.name, sheet);
    } catch {
      notify("import.upload.read_error", { type: "error" });
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <label
        htmlFor="import-file"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          read(event.dataTransfer.files?.[0]);
        }}
        className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center transition-colors hover:bg-muted"
      >
        <span className="font-semibold">
          {reading
            ? translate("import.upload.reading")
            : translate("import.upload.choose")}
        </span>
        <span className="max-w-lg text-sm text-muted-foreground">
          {translate("import.upload.help")}
        </span>
        <input
          ref={input}
          id="import-file"
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-label={translate("import.upload.label")}
          className="sr-only"
          disabled={reading}
          onChange={(event) => read(event.target.files?.[0])}
        />
      </label>
      <Button
        variant="outline"
        className="w-fit"
        onClick={() =>
          downloadFile(translate("import.upload.sample_file"), sampleCsv())
        }
      >
        {translate("import.upload.sample")}
      </Button>
    </div>
  );
};

const MappingStep = ({
  fileName,
  headers,
  sheet,
  mapping,
  onMappingChange,
  customFields,
  system,
  mode,
  onModeChange,
  onBack,
  onNext,
}: {
  fileName: string;
  headers: string[];
  sheet: Cell[][];
  mapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
  customFields: CustomField[];
  system: ImportSystem;
  mode: ImportMode;
  onModeChange: (mode: ImportMode) => void;
  onBack: () => void;
  onNext: () => void;
}) => {
  const translate = useTranslate();
  const example = (index: number) =>
    sheet
      .slice(1)
      .map((row) => cellText(row[index]))
      .find(Boolean) ?? "";
  const fields = IMPORT_FIELDS.filter(
    (field) => mode === "deals" || !DEAL_FIELDS.includes(field),
  );
  // Custom fields (stage 19): the patient's, and the deal's for deals
  const custom = [
    ...entityFields(customFields, "patient"),
    ...(mode === "deals" ? entityFields(customFields, "deal") : []),
  ];
  const hasNameOrPhone = mapping.some(
    (field) =>
      field != null &&
      ["full_name", "first_name", "last_name", "phone"].includes(field),
  );

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">{fileName}</p>
      {system === "amocrm" ? (
        <p className="rounded-md bg-muted px-4 py-3 text-sm">
          {translate("import.amo_detected")}
        </p>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">
          {translate("import.mode.label")}
        </legend>
        <RadioGroup
          value={mode}
          onValueChange={(value) => onModeChange(value as ImportMode)}
          className="flex flex-wrap gap-5"
        >
          {(["patients", "deals"] as const).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <RadioGroupItem value={value} />
              {translate(`import.mode.${value}`)}
            </label>
          ))}
        </RadioGroup>
      </fieldset>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">
                {translate("import.mapping.column")}
              </th>
              <th className="px-3 py-2 font-medium">
                {translate("import.mapping.example")}
              </th>
              <th className="px-3 py-2 font-medium">
                {translate("import.mapping.field")}
              </th>
            </tr>
          </thead>
          <tbody>
            {headers.map((header, index) => {
              const field = mapping[index];
              const hidden =
                mode === "patients" && isDealTarget(field, customFields);
              return (
                <tr key={index} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{header || "—"}</td>
                  <td className="max-w-56 truncate px-3 py-2 text-muted-foreground">
                    {example(index)}
                  </td>
                  <td className="px-3 py-2">
                    <Select
                      value={field && !hidden ? field : SKIP}
                      onValueChange={(value) => {
                        const next = [...mapping];
                        next[index] =
                          value === SKIP ? null : (value as MappingTarget);
                        onMappingChange(next);
                      }}
                    >
                      <SelectTrigger
                        className="w-60"
                        aria-label={`${translate("import.mapping.field")}: ${header}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SKIP}>
                          {translate("import.mapping.skip")}
                        </SelectItem>
                        {fields.map((option) => (
                          <SelectItem key={option} value={option}>
                            {translate(`import.fields.${option}`)}
                          </SelectItem>
                        ))}
                        {custom.map((customField) => (
                          <SelectItem
                            key={customField.id}
                            value={customTarget(customField)}
                          >
                            {translate(
                              `custom_fields.import.${customField.entity}_field`,
                              { name: customField.name },
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!hasNameOrPhone ? (
        <p className="text-sm text-destructive">
          {translate("import.mapping.need_name_or_phone")}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack}>
          {translate("import.actions.back")}
        </Button>
        <Button onClick={onNext} disabled={!hasNameOrPhone}>
          {translate("import.actions.next")}
        </Button>
      </div>
    </div>
  );
};

const encode = (resolution: Resolution | undefined) =>
  resolution === undefined
    ? ""
    : resolution === null
      ? NONE
      : resolution === "create"
        ? CREATE
        : String(resolution);

const decode = (value: string): Resolution =>
  value === NONE ? null : value === CREATE ? "create" : value;

const ReviewStep = ({
  rows,
  mode,
  dictionaries,
  resolutions,
  onResolutionsChange,
  onBack,
  onStart,
}: {
  rows: ParsedRow[];
  mode: ImportMode;
  dictionaries: ImportDictionaries;
  resolutions: Resolutions;
  onResolutionsChange: (resolutions: Resolutions) => void;
  onBack: () => void;
  onStart: () => void;
}) => {
  const translate = useTranslate();
  const unknown = useMemo(
    () => unknownValues(rows, mode, dictionaries),
    [rows, mode, dictionaries],
  );
  const { ready, rejected } = useMemo(
    () =>
      buildBatchRows({
        rows,
        mode,
        system: "excel",
        resolutions: withCreatedAsKnown(resolutions),
        dictionaries,
        tagIds: {},
      }),
    [rows, mode, resolutions, dictionaries],
  );
  const errorsByLine = new Map(
    rejected.map(({ row, errors }) => [row.line, errors]),
  );
  const valuesByKind = useMemo(() => collectValues(rows, mode), [rows, mode]);
  // The first rows, and the rows with errors further down
  const previewRows = useMemo(() => {
    const first = rows.slice(0, PREVIEW_ROWS);
    const later = rejected
      .map(({ row }) => row)
      .filter((row) => !first.includes(row))
      .slice(0, PREVIEW_ERRORS);
    return [...first, ...later];
  }, [rows, rejected]);

  const setResolution = (
    kind: DictionaryKind,
    value: string,
    resolution: Resolution,
  ) =>
    onResolutionsChange({
      ...resolutions,
      [kind]: { ...resolutions[kind], [value]: resolution },
    });

  return (
    <div className="flex flex-col gap-6">
      {unknown.length ? (
        <section className="flex flex-col gap-4">
          <div>
            <h3 className="font-semibold">
              {translate("import.resolve.title")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {translate("import.resolve.hint")}
            </p>
          </div>
          {unknown.map(({ kind, values }) => (
            <div key={kind} className="flex flex-col gap-2">
              <h4 className="text-sm font-medium">
                {translate(`import.resolve.kinds.${kind}`)}
              </h4>
              {values.map((value) => (
                <div key={value} className="flex flex-wrap items-center gap-3">
                  <span className="min-w-48 text-sm">{value}</span>
                  <ResolutionSelect
                    kind={kind}
                    value={value}
                    row={valuesByKind[kind]?.get(value)}
                    dictionaries={dictionaries}
                    resolution={resolutions[kind][value]}
                    onChange={(resolution) =>
                      setResolution(kind, value, resolution)
                    }
                  />
                </div>
              ))}
            </div>
          ))}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h3 className="font-semibold">{translate("import.preview.title")}</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">
                  {translate("import.preview.line")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {translate("import.preview.patient")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {translate("import.preview.phones")}
                </th>
                {mode === "deals" ? (
                  <th className="px-3 py-2 font-medium">
                    {translate("import.preview.deal")}
                  </th>
                ) : null}
                <th className="px-3 py-2 font-medium">
                  {translate("import.preview.status")}
                </th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row) => {
                const errors = errorsByLine.get(row.line);
                return (
                  <tr key={row.line} className="border-t border-border">
                    <td className="px-3 py-2 tabular-nums">{row.line}</td>
                    <td className="px-3 py-2">
                      {[row.last_name, row.first_name, row.middle_name]
                        .filter(Boolean)
                        .join(" ") || "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.phones.join(", ") || "—"}
                    </td>
                    {mode === "deals" ? (
                      <td className="px-3 py-2">
                        {[row.deal_name ?? row.service, row.stage]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                    ) : null}
                    <td className="px-3 py-2">
                      {errors ? (
                        <span className="flex items-start gap-1 text-destructive">
                          {errors
                            .map((error) => errorText(translate, error))
                            .join("; ")}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          {translate("import.preview.ok")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-sm">
          {translate("import.preview.ready", { smart_count: ready.length })}
          {rejected.length ? (
            <span className="text-destructive">
              {" · "}
              {translate("import.preview.rejected", {
                smart_count: rejected.length,
              })}
            </span>
          ) : null}
        </p>
      </section>

      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack}>
          {translate("import.actions.back")}
        </Button>
        <Button onClick={onStart} disabled={!ready.length}>
          {translate("import.actions.start")}
        </Button>
      </div>
    </div>
  );
};

/** For the preview: values to create count as known */
const withCreatedAsKnown = (resolutions: Resolutions): Resolutions =>
  Object.fromEntries(
    Object.entries(resolutions).map(([kind, values]) => [
      kind,
      Object.fromEntries(
        Object.entries(values).map(([value, resolution]) => [
          value,
          resolution === "create" ? null : resolution,
        ]),
      ),
    ]),
  ) as Resolutions;

const ResolutionSelect = ({
  kind,
  value,
  row,
  dictionaries,
  resolution,
  onChange,
}: {
  kind: DictionaryKind;
  value: string;
  row?: ParsedRow;
  dictionaries: ImportDictionaries;
  resolution: Resolution | undefined;
  onChange: (resolution: Resolution) => void;
}) => {
  const translate = useTranslate();
  const options: Array<{ id: Identifier; name: string }> =
    kind === "stage"
      ? stageOptions(dictionaries, row)
      : kind === "responsible"
        ? dictionaries.sales.map((sale) => ({
            id: sale.id,
            name: `${sale.first_name} ${sale.last_name}`,
          }))
        : {
            source: dictionaries.sources,
            service: dictionaries.services,
            lost_reason: dictionaries.lostReasons,
          }[kind];
  const newName = kind === "stage" && row?.stage ? row.stage : value;
  return (
    <Select
      value={encode(resolution)}
      onValueChange={(v) => onChange(decode(v))}
    >
      <SelectTrigger
        className={cn("w-72", resolution === undefined && "border-destructive")}
        aria-label={value}
      >
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        {CREATABLE_KINDS.includes(kind) ? (
          <SelectItem value={CREATE}>
            {translate("import.resolve.create", { name: newName })}
          </SelectItem>
        ) : null}
        <SelectItem value={NONE}>
          {translate(
            kind === "stage"
              ? "import.resolve.first_stage"
              : kind === "responsible"
                ? "import.resolve.unassigned"
                : "import.resolve.none",
          )}
        </SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={String(option.id)}>
            {option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

/** Stages of the row's pipeline first, then the others as "Воронка / Этап" */
const stageOptions = (dictionaries: ImportDictionaries, row?: ParsedRow) => {
  const pipeline = row ? rowPipeline(row, dictionaries) : undefined;
  const pipelineName = (id: Identifier) =>
    dictionaries.pipelines.find((p) => String(p.id) === String(id))?.name ?? "";
  return [...dictionaries.stages]
    .sort(
      (a, b) =>
        Number(String(b.pipeline_id) === String(pipeline?.id)) -
          Number(String(a.pipeline_id) === String(pipeline?.id)) ||
        String(a.pipeline_id).localeCompare(String(b.pipeline_id)) ||
        a.position - b.position,
    )
    .map((stage) => ({
      id: stage.id,
      name: `${pipelineName(stage.pipeline_id)} / ${stage.name}`,
    }));
};

const errorText = (
  translate: ReturnType<typeof useTranslate>,
  error: RowError,
) =>
  error.code === "bad_custom"
    ? translate("custom_fields.import.bad_value", {
        field: error.field,
        value: error.value,
      })
    : translate(
        `import.errors.${error.code}`,
        "value" in error ? { value: error.value } : {},
      );

/** Creates what the user chose to create, then imports in batches */
const ImportRunner = ({
  rows,
  mode,
  system,
  dictionaries,
  resolutions,
  progress,
  onProgress,
  onDone,
  onError,
}: {
  rows: ParsedRow[];
  mode: ImportMode;
  system: ImportSystem;
  dictionaries: ImportDictionaries;
  resolutions: Resolutions;
  progress: { done: number; total: number };
  onProgress: (progress: { done: number; total: number }) => void;
  onDone: (outcome: Outcome) => void;
  onError: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const started = useRef(false);

  useEffect(() => {
    // Runs once (the ref survives the double effects of StrictMode)
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const final = await createMissing({
          dataProvider,
          rows,
          mode,
          dictionaries,
          resolutions,
        });
        const tagIds = await ensureTags(dataProvider, rows, dictionaries.tags);
        const { ready, rejected } = buildBatchRows({
          rows,
          mode,
          system,
          resolutions: final,
          dictionaries,
          tagIds,
        });
        const result = emptyResult();
        onProgress({ done: 0, total: ready.length });
        let done = 0;
        for (const batch of chunk(ready, BATCH_SIZE)) {
          const batchResult = await dataProvider.importBatch(mode, batch);
          for (const key of Object.keys(result) as Array<
            keyof ImportBatchResult
          >) {
            if (key === "errors") result.errors.push(...batchResult.errors);
            else result[key] += batchResult[key];
          }
          done += batch.length;
          onProgress({ done, total: ready.length });
        }
        const byLine = new Map(rows.map((row) => [row.line, row]));
        const failed = [
          ...rejected.map(({ row, errors }) => ({
            line: row.line,
            cells: row.cells,
            message: errors
              .map((error) => errorText(translate, error))
              .join("; "),
          })),
          ...result.errors.map((error) => ({
            line: error.index,
            cells: byLine.get(error.index)?.cells ?? [],
            message: error.message,
          })),
        ].sort((a, b) => a.line - b.line);
        await queryClient.invalidateQueries();
        onDone({ result, failed });
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), {
          type: "error",
        });
        onError();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const percent = progress.total ? (progress.done / progress.total) * 100 : 0;
  return (
    <div className="flex max-w-xl flex-col gap-3">
      <p className="text-sm">
        {translate("import.progress", {
          done: progress.done,
          total: progress.total,
        })}
      </p>
      <Progress value={percent} />
    </div>
  );
};

/** New dictionary rows the user asked for; returns resolutions with ids */
const createMissing = async ({
  dataProvider,
  rows,
  mode,
  dictionaries,
  resolutions,
}: {
  dataProvider: CrmDataProvider;
  rows: ParsedRow[];
  mode: ImportMode;
  dictionaries: ImportDictionaries;
  resolutions: Resolutions;
}): Promise<Resolutions> => {
  const final: Resolutions = {
    stage: { ...resolutions.stage },
    source: { ...resolutions.source },
    service: { ...resolutions.service },
    responsible: { ...resolutions.responsible },
    lost_reason: { ...resolutions.lost_reason },
  };
  const values = collectValues(rows, mode);
  const stages: Stage[] = [...(dictionaries.stages as Stage[])];
  const resources = {
    source: ["lead_sources", dictionaries.sources],
    service: ["services", dictionaries.services],
    lost_reason: ["lost_reasons", dictionaries.lostReasons],
  } as const;
  for (const kind of CREATABLE_KINDS) {
    for (const [value, resolution] of Object.entries(final[kind])) {
      if (resolution !== "create") continue;
      if (kind === "stage") {
        const row = values.stage?.get(value);
        const pipeline = row ? rowPipeline(row, dictionaries) : undefined;
        if (!pipeline) {
          final.stage[value] = null;
          continue;
        }
        final.stage[value] = await createStage(
          dataProvider,
          stages,
          pipeline.id,
          row?.stage ?? value,
        );
        continue;
      }
      if (kind === "responsible") continue;
      const [resource, items] = resources[kind];
      const { data } = await dataProvider.create(resource, {
        data: {
          name: value,
          position: items.length + Object.keys(final[kind]).indexOf(value),
        },
      });
      final[kind][value] = data.id;
    }
  }
  return final;
};

/** A new open stage after the last open one (won and lost stay last) */
const createStage = async (
  dataProvider: CrmDataProvider,
  stages: Stage[],
  pipelineId: Identifier,
  name: string,
) => {
  const own = stages
    .filter((stage) => String(stage.pipeline_id) === String(pipelineId))
    .sort((a, b) => b.position - a.position);
  const position =
    Math.max(
      -1,
      ...own.filter((s) => s.kind === "open").map((s) => s.position),
    ) + 1;
  for (const stage of own.filter((s) => s.position >= position)) {
    const { data } = await dataProvider.update<Stage>("stages", {
      id: stage.id,
      data: { position: stage.position + 1 },
      previousData: stage,
    });
    stages.splice(stages.indexOf(stage), 1, data);
  }
  const { data } = await dataProvider.create<Stage>("stages", {
    data: {
      pipeline_id: pipelineId,
      name,
      position,
      kind: "open",
      // Same palette as Settings → Pipelines
      color: ACCENTS[own.length % ACCENTS.length],
    },
  });
  stages.push(data);
  return data.id;
};

/** Tag name (lower case) → id, creating the tags the clinic does not have */
const ensureTags = async (
  dataProvider: CrmDataProvider,
  rows: ParsedRow[],
  existing: Array<{ id: Identifier; name: string }>,
) => {
  const ids: Record<string, Identifier> = Object.fromEntries(
    existing.map((tag) => [tag.name.trim().toLowerCase(), tag.id]),
  );
  const names = [...new Set(rows.flatMap((row) => row.tags))];
  let index = existing.length;
  for (const name of names) {
    const key = name.toLowerCase();
    if (ids[key] != null) continue;
    const { data } = await dataProvider.create<Tag>("tags", {
      data: { name, color: tagColors[index++ % tagColors.length] },
    });
    ids[key] = data.id;
  }
  return ids;
};

const ResultStep = ({
  outcome,
  headers,
  onAgain,
}: {
  outcome: Outcome;
  headers: string[];
  onAgain: () => void;
}) => {
  const translate = useTranslate();
  const { result, failed } = outcome;
  return (
    <div className="flex flex-col gap-5">
      <h3 className="text-lg font-semibold">
        {translate("import.result.title")}
      </h3>
      <dl className="grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label={translate("import.result.created")}
          value={result.created}
        />
        <Stat
          label={translate("import.result.updated")}
          value={result.updated}
        />
        <Stat
          label={translate("import.result.skipped")}
          value={result.skipped}
        />
        <Stat
          label={translate("import.result.failed")}
          value={failed.length}
          alert={failed.length > 0}
        />
      </dl>
      <p className="text-sm text-muted-foreground">
        {translate("import.result.details", {
          patients_created: result.patients_created,
          patients_updated: result.patients_updated,
          deals_created: result.deals_created,
          deals_updated: result.deals_updated,
        })}
      </p>
      <div className="flex flex-wrap gap-2">
        {failed.length ? (
          <Button
            variant="outline"
            onClick={() =>
              downloadFile(
                translate("import.errors_file"),
                errorRowsCsv(headers, failed, translate("import.error_column")),
              )
            }
          >
            {translate("import.actions.download_errors")}
          </Button>
        ) : null}
        <Button onClick={onAgain}>{translate("import.actions.again")}</Button>
      </div>
    </div>
  );
};

const Stat = ({
  label,
  value,
  alert,
}: {
  label: string;
  value: number;
  alert?: boolean;
}): ReactNode => (
  <div className="rounded-lg bg-card px-4 py-3">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd
      className={cn(
        "text-2xl font-bold tabular-nums",
        alert && "text-destructive",
      )}
    >
      {value}
    </dd>
  </div>
);
