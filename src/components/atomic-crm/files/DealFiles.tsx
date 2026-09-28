import { Download, Trash2 } from "lucide-react";
import { useGetIdentity, useTranslate, type Identifier } from "ra-core";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useCurrentSale } from "../quick-replies/useQuickReplies";
import { useGetSalesName } from "../sales/useGetSalesName";
import type { Deal, DealFile } from "../types";
import { FILE_ACCEPT, fileKind, formatFileSize } from "./fileTypes";
import { KIND_ICONS } from "./fileIcons";
import { FileLightbox } from "./FilePreview";
import {
  useDealFiles,
  useDeleteDealFile,
  useDownloadFile,
  useFileUrl,
  useUploadDealFiles,
} from "./useFiles";

/**
 * Tab «Файлы» of the deal page: drop files or pick them, see them with a
 * preview, open, download, delete (the owner, the head or the uploader;
 * files of the conversation stay).
 */
export const DealFiles = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const { data: files = [], isPending } = useDealFiles(deal.id);
  const upload = useUploadDealFiles(deal.id);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const add = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (picked.length) upload.mutate(picked);
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          add(event.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-5 text-center text-sm transition-colors",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border text-muted-foreground",
        )}
        data-testid="deal-files-dropzone"
      >
        <p>{translate(dragging ? "files.drop_here" : "files.drop_hint")}</p>
        <Button
          size="sm"
          onClick={() => input.current?.click()}
          disabled={upload.isPending}
        >
          {translate(upload.isPending ? "files.uploading" : "files.upload")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {translate("files.limits")}
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept={FILE_ACCEPT}
          className="hidden"
          aria-label={translate("files.upload")}
          onChange={(event) => {
            add(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {!isPending && !files.length ? (
        <p className="text-center text-sm text-muted-foreground">
          {translate("files.empty")}
        </p>
      ) : null}
      <FileList files={files} />
    </div>
  );
};

/** Files as a list with a preview; dealName adds the deal of each file */
export const FileList = ({
  files,
  dealName,
}: {
  files: DealFile[];
  dealName?: (dealId: Identifier) => string | undefined;
}) => {
  const translate = useTranslate();
  if (!files.length) return null;
  return (
    <ul
      className="flex flex-col divide-y divide-border"
      aria-label={translate("files.tab")}
    >
      {files.map((file) => (
        <li key={file.id} className="py-2.5">
          <FileRow file={file} dealName={dealName?.(file.deal_id)} />
        </li>
      ))}
    </ul>
  );
};

const FileRow = ({ file, dealName }: { file: DealFile; dealName?: string }) => {
  const translate = useTranslate();
  const { identity } = useGetIdentity();
  const sale = useCurrentSale();
  const author = useGetSalesName(file.sales_id ?? undefined, {
    enabled: file.sales_id != null,
  });
  const { data: url } = useFileUrl(file.path);
  const remove = useDeleteDealFile();
  const download = useDownloadFile();
  const [open, setOpen] = useState(false);
  const kind = fileKind(file.mime, file.name);
  const Icon = KIND_ICONS[kind];
  const canDelete =
    file.message_id == null &&
    (sale?.role === "owner" ||
      sale?.role === "head" ||
      (file.sales_id != null &&
        String(file.sales_id) === String(identity?.id)));

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => (kind === "image" ? setOpen(true) : undefined)}
        className={cn(
          "flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted",
          kind !== "image" && "cursor-default",
        )}
        aria-label={`${translate("files.open")}: ${file.name}`}
        tabIndex={kind === "image" ? 0 : -1}
      >
        {kind === "image" && url ? (
          <img
            src={url}
            alt={file.name}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <Icon className="size-6 text-muted-foreground" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-sm font-medium text-foreground no-underline hover:underline"
          title={file.name}
        >
          {file.name}
        </a>
        <p className="flex flex-wrap items-center gap-x-1 text-[11px] text-muted-foreground">
          <span>{formatFileSize(file.size)}</span>
          <span>
            ·{" "}
            {new Date(file.created_at).toLocaleString("ru-RU", {
              day: "2-digit",
              month: "2-digit",
              year: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span>· {author || translate("files.from_patient")}</span>
          {file.message_id != null ? (
            <span className="inline-flex items-center gap-0.5">
              ·{translate("files.from_chat")}
            </span>
          ) : null}
          {dealName ? <span>· {dealName}</span> : null}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-muted-foreground"
        aria-label={`${translate("files.download")}: ${file.name}`}
        onClick={() => download(file)}
      >
        <Download className="size-4" />
      </Button>
      {canDelete ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={`${translate("files.delete")}: ${file.name}`}
          disabled={remove.isPending}
          onClick={() => {
            if (
              window.confirm(
                translate("files.delete_confirm", { name: file.name }),
              )
            ) {
              remove.mutate(file);
            }
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      ) : null}
      {kind === "image" ? (
        <FileLightbox
          file={file}
          url={url}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </div>
  );
};
