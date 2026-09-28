import {
  useGetList,
  useNotify,
  useTranslate,
  useUpdate,
  type Identifier,
} from "ra-core";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { findById, useServices } from "../dictionaries/useDictionaries";
import { FileActions } from "../files/FilePreview";
import { FILE_ACCEPT, fileKind, formatFileSize } from "../files/fileTypes";
import { useDownloadFile, useFileUrl } from "../files/useFiles";
import { Molar3D } from "../misc/Dental3D";
import type { Deal, DealFile } from "../types";
import { ruDate } from "./consents";
import {
  PATIENT_FILE_KINDS,
  type PatientFile,
  type PatientFileKind,
} from "./types";
import {
  useDeletePatientFile,
  useMedicalRights,
  usePatientFiles,
  useRefreshPatientCard,
  useUploadPatientFiles,
} from "./usePatientCard";

/** A file of the tab: the patient's own (typed) or a file of a deal */
type CardFile = {
  key: string;
  name: string;
  path: string;
  mime: string;
  size: number;
  created_at: string;
  kind: PatientFileKind | "deal";
  taken_at?: string | null;
  note?: string | null;
  own?: PatientFile;
  dealName?: string;
};

type Filter = "all" | PatientFileKind | "deal";

/**
 * «Файлы и снимки» of the patient card (stage 37): the X-rays (ОПТГ, КТ,
 * прицельные) and photos as a gallery with a lightbox, the documents and
 * consents as a list; the files of every deal of the patient (stage 22)
 * come along. Upload with a type and the date of the image.
 */
export const FilesTab = ({ patientId }: { patientId: Identifier }) => {
  const translate = useTranslate();
  const rights = useMedicalRights();
  const { data: services } = useServices();
  const { data: own = [] } = usePatientFiles(patientId, rights.canSee);
  const { data: dealFiles = [] } = useGetList<DealFile>("deal_files", {
    filter: { patient_id: patientId },
    sort: { field: "created_at", order: "DESC" },
    pagination: { page: 1, perPage: 500 },
  });
  const { data: deals = [] } = useGetList<Deal>("deals", {
    filter: { patient_id: patientId },
    pagination: { page: 1, perPage: 100 },
  });
  const upload = useUploadPatientFiles(patientId);
  const [kind, setKind] = useState<PatientFileKind>("opg");
  const [takenAt, setTakenAt] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [dragging, setDragging] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const files: CardFile[] = useMemo(() => {
    const dealName = (id: Identifier) => {
      const deal = deals.find((d) => String(d.id) === String(id));
      return deal
        ? deal.name ||
            findById(services, deal.service_id)?.name ||
            translate("crm.deals.untitled")
        : undefined;
    };
    return [
      ...own.map(
        (file): CardFile => ({
          key: `p${file.id}`,
          name: file.name,
          path: file.path,
          mime: file.mime,
          size: file.size,
          created_at: file.created_at,
          kind: file.kind,
          taken_at: file.taken_at,
          note: file.note,
          own: file,
        }),
      ),
      ...dealFiles.map(
        (file): CardFile => ({
          key: `d${file.id}`,
          name: file.name,
          path: file.path,
          mime: file.mime,
          size: file.size,
          created_at: file.created_at,
          kind: "deal",
          dealName: dealName(file.deal_id),
        }),
      ),
    ].sort((a, b) =>
      (b.taken_at ?? b.created_at).localeCompare(a.taken_at ?? a.created_at),
    );
  }, [own, dealFiles, deals, services, translate]);

  const shown = files.filter(
    (file) => filter === "all" || file.kind === filter,
  );
  const images = shown.filter(
    (file) => fileKind(file.mime, file.name) === "image",
  );
  const documents = shown.filter(
    (file) => fileKind(file.mime, file.name) !== "image",
  );
  const counts = (value: Filter) =>
    value === "all"
      ? files.length
      : files.filter((file) => file.kind === value).length;

  const send = (list: FileList | File[] | null) => {
    const picked = Array.from(list ?? []);
    if (picked.length) {
      upload.mutate({ files: picked, kind, takenAt: takenAt || null });
    }
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (rights.canEdit) send(event.dataTransfer.files);
  };

  return (
    <section
      className={cn(
        "rounded-[28px] bg-card p-6 transition-shadow",
        dragging && "ring-2 ring-neon",
      )}
      onDragOver={(event) => {
        if (!rights.canEdit) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      data-testid="patient-files-tab"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
            {translate("patient_card.files.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {rights.canEdit
              ? translate("patient_card.files.drop")
              : translate("patient_card.files.subtitle")}
          </p>
        </div>
        {rights.canEdit ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="px-1 text-xs text-muted-foreground">
                {translate("patient_card.files.kind")}
              </span>
              <select
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as PatientFileKind)
                }
                aria-label={translate("patient_card.files.kind")}
                className="field h-10 rounded-full px-4 text-sm"
              >
                {PATIENT_FILE_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {translate(`patient_card.files.kinds.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="px-1 text-xs text-muted-foreground">
                {translate("patient_card.files.taken_at")}
              </span>
              <input
                type="date"
                value={takenAt}
                onChange={(event) => setTakenAt(event.target.value)}
                aria-label={translate("patient_card.files.taken_at")}
                className="field h-10 rounded-full px-4 text-sm"
              />
            </label>
            <Button
              onClick={() => input.current?.click()}
              disabled={upload.isPending}
            >
              {translate("patient_card.files.upload")}
            </Button>
            <input
              ref={input}
              type="file"
              multiple
              accept={FILE_ACCEPT}
              className="hidden"
              data-testid="patient-file-input"
              onChange={(event) => {
                send(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
        ) : null}
      </div>

      <div
        className="mt-5 flex flex-wrap gap-1.5"
        role="tablist"
        aria-label={translate("patient_card.files.filter")}
      >
        {(["all", ...PATIENT_FILE_KINDS, "deal"] as Filter[])
          .filter((value) => value === "all" || counts(value) > 0)
          .map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-sm transition-colors",
                filter === value
                  ? "bg-primary text-primary-foreground"
                  : "bg-pill text-foreground hover:bg-pill-hover",
              )}
            >
              {value === "all"
                ? translate("patient_card.files.all")
                : value === "deal"
                  ? translate("patient_card.files.deal_files")
                  : translate(`patient_card.files.kinds.${value}`)}
              <span className="ml-1.5 text-xs opacity-60">{counts(value)}</span>
            </button>
          ))}
      </div>

      {!files.length ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Molar3D tone="soft" className="h-24 w-20" />
          <p className="text-sm text-muted-foreground">
            {translate("patient_card.files.empty")}
          </p>
        </div>
      ) : null}

      {images.length ? (
        <ul
          className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4"
          aria-label={translate("patient_card.files.gallery")}
          data-testid="xray-gallery"
        >
          {images.map((file, index) => (
            <Thumb
              key={file.key}
              file={file}
              onOpen={() => setLightbox(index)}
              canEdit={rights.canEdit}
              canDelete={!!file.own && rights.canDelete(file.own.sales_id)}
            />
          ))}
        </ul>
      ) : null}

      {documents.length ? (
        <ul
          className="mt-5 flex flex-col gap-2"
          aria-label={translate("patient_card.files.documents")}
        >
          {documents.map((file) => (
            <DocumentRow
              key={file.key}
              file={file}
              canEdit={rights.canEdit}
              canDelete={!!file.own && rights.canDelete(file.own.sales_id)}
            />
          ))}
        </ul>
      ) : null}

      {lightbox != null && images[lightbox] ? (
        <Lightbox
          files={images}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </section>
  );
};

const fileTitle = (
  file: CardFile,
  translate: ReturnType<typeof useTranslate>,
) =>
  file.kind === "deal"
    ? file.dealName
      ? translate("patient_card.files.from_deal", { name: file.dealName })
      : translate("patient_card.files.deal_files")
    : translate(`patient_card.files.kinds.${file.kind}`);

const Thumb = ({
  file,
  onOpen,
  canEdit,
  canDelete,
}: {
  file: CardFile;
  onOpen: () => void;
  canEdit: boolean;
  canDelete: boolean;
}) => {
  const translate = useTranslate();
  const { data: url } = useFileUrl(file.path);
  return (
    <li className="group flex flex-col gap-2" data-testid="xray-thumb">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${translate("files.open")}: ${file.name}`}
        className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[#0b0b0c] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {url ? (
          <img
            src={url}
            alt={file.name}
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : null}
        <span className="absolute top-2 left-2 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white">
          {fileTitle(file, translate)}
        </span>
      </button>
      <div className="flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="truncate text-sm" title={file.name}>
            {file.note || file.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {ruDate((file.taken_at ?? file.created_at).slice(0, 10))}
          </p>
        </div>
        <FileMenu file={file} canEdit={canEdit} canDelete={canDelete} />
      </div>
    </li>
  );
};

const DocumentRow = ({
  file,
  canEdit,
  canDelete,
}: {
  file: CardFile;
  canEdit: boolean;
  canDelete: boolean;
}) => {
  const translate = useTranslate();
  const { data: url } = useFileUrl(file.path);
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl bg-background px-4 py-3">
      <span className="rounded-full bg-pill px-2.5 py-1 text-[11px] text-muted-foreground">
        {fileTitle(file, translate)}
      </span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate text-sm text-foreground no-underline hover:underline"
        title={file.name}
      >
        {file.name}
      </a>
      <span className="text-xs text-muted-foreground">
        {ruDate((file.taken_at ?? file.created_at).slice(0, 10))}
        {file.size ? ` · ${formatFileSize(file.size)}` : ""}
      </span>
      <FileMenu file={file} canEdit={canEdit} canDelete={canDelete} />
    </li>
  );
};

/** The type of a patient file, download, delete */
const FileMenu = ({
  file,
  canEdit,
  canDelete,
}: {
  file: CardFile;
  canEdit: boolean;
  canDelete: boolean;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefreshPatientCard();
  const download = useDownloadFile();
  const remove = useDeletePatientFile();
  const [update] = useUpdate();
  return (
    <div className="flex shrink-0 items-center gap-1">
      {file.own && canEdit ? (
        <select
          value={file.own.kind}
          aria-label={`${translate("patient_card.files.kind")}: ${file.name}`}
          onChange={(event) =>
            update(
              "patient_files",
              {
                id: file.own!.id,
                data: { kind: event.target.value },
                previousData: file.own,
              },
              {
                mutationMode: "pessimistic",
                onSuccess: () => refresh(),
                onError: (error: any) =>
                  notify(
                    (error as Error)?.message || "ra.notification.http_error",
                    {
                      type: "error",
                    },
                  ),
              },
            )
          }
          className="h-7 max-w-28 rounded-full bg-pill px-2 text-xs"
        >
          {PATIENT_FILE_KINDS.map((value) => (
            <option key={value} value={value}>
              {translate(`patient_card.files.kinds.${value}`)}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        onClick={() => download({ path: file.path, name: file.name })}
        className="rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-pill hover:text-foreground"
        aria-label={`${translate("files.download")}: ${file.name}`}
      >
        ↓
      </button>
      {canDelete && file.own ? (
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                translate("patient_card.files.delete_confirm", {
                  name: file.name,
                }),
              )
            ) {
              remove.mutate(file.own!);
            }
          }}
          className="rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-pill hover:text-tone-red"
          aria-label={`${translate("patient_card.files.delete")}: ${file.name}`}
        >
          ×
        </button>
      ) : null}
    </div>
  );
};

/** The images full size, one after another: ← → and Esc */
const Lightbox = ({
  files,
  index,
  onIndex,
  onClose,
}: {
  files: CardFile[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const file = files[index];
  const { data: url } = useFileUrl(file.path);
  const go = (step: number) =>
    onIndex((index + step + files.length) % files.length);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[94vh] flex-col gap-3 rounded-[28px] bg-[#0b0b0c] text-white sm:max-w-[min(94vw,80rem)]"
        data-testid="xray-lightbox"
      >
        <DialogTitle className="truncate pr-8 text-base font-normal">
          {fileTitle(file, translate)} · {file.name}
        </DialogTitle>
        <DialogDescription className="text-white/60">
          {ruDate((file.taken_at ?? file.created_at).slice(0, 10))}
          {file.note ? ` · ${file.note}` : ""}
          {` · ${index + 1} / ${files.length}`}
        </DialogDescription>
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-2xl">
          {url ? (
            <img
              src={url}
              alt={file.name}
              className="max-h-[72vh] max-w-full object-contain"
            />
          ) : null}
          {files.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label={translate("patient_card.files.prev")}
                className="absolute top-1/2 left-2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-xl hover:bg-white/30"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label={translate("patient_card.files.next")}
                className="absolute top-1/2 right-2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-xl hover:bg-white/30"
              >
                ›
              </button>
            </>
          ) : null}
        </div>
        <FileActions
          file={file}
          url={url}
          className="[&_button]:text-foreground"
        />
      </DialogContent>
    </Dialog>
  );
};
