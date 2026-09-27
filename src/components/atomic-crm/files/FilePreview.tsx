import { Download, ExternalLink, FileImage } from "lucide-react";
import { useTranslate } from "ra-core";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { KIND_ICONS } from "./fileIcons";
import { fileKind, formatFileSize } from "./fileTypes";
import { useDownloadFile, useFileUrl } from "./useFiles";

/**
 * A file to show: stored in our bucket (path), or only known by the
 * messenger's link (url, e.g. a received file not copied).
 */
export type PreviewFile = {
  path?: string | null;
  url?: string | null;
  name: string;
  mime: string;
  size?: number | null;
};

const useAddress = (file: PreviewFile) => {
  const signed = useFileUrl(file.path);
  return file.path ? signed.data : (file.url ?? undefined);
};

/**
 * A file in a chat bubble or in the feed: a thumbnail opening a lightbox, an
 * audio or video player, else a chip to open or download it.
 */
export const FilePreview = ({
  file,
  className,
}: {
  file: PreviewFile;
  className?: string;
}) => {
  const url = useAddress(file);
  const kind = fileKind(file.mime, file.name);
  if (kind === "image") {
    return <ImageThumb file={file} url={url} className={className} />;
  }
  if (kind === "audio") {
    return (
      <audio
        controls
        preload="none"
        src={url}
        className={cn("h-10 w-72 max-w-full", className)}
        aria-label={file.name}
      />
    );
  }
  if (kind === "video") {
    return (
      <video
        controls
        preload="metadata"
        src={url}
        className={cn(
          "max-h-64 w-80 max-w-full rounded-md bg-black",
          className,
        )}
        aria-label={file.name}
      />
    );
  }
  return <FileChip file={file} url={url} className={className} />;
};

const ImageThumb = ({
  file,
  url,
  className,
}: {
  file: PreviewFile;
  url: string | undefined;
  className?: string;
}) => {
  const translate = useTranslate();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "block overflow-hidden rounded-md bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          className,
        )}
        aria-label={`${translate("files.open")}: ${file.name}`}
      >
        {url ? (
          <img
            src={url}
            alt={file.name}
            loading="lazy"
            className="max-h-48 max-w-64 object-cover"
          />
        ) : (
          <span className="flex size-32 items-center justify-center text-muted-foreground">
            <FileImage className="size-6" />
          </span>
        )}
      </button>
      <FileLightbox file={file} url={url} open={open} onOpenChange={setOpen} />
    </>
  );
};

/** The image full size, with its name, open and download */
export const FileLightbox = ({
  file,
  url,
  open,
  onOpenChange,
}: {
  file: PreviewFile;
  url: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const translate = useTranslate();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-3 sm:max-w-[min(92vw,72rem)]">
        <DialogTitle className="truncate pr-8 text-sm">{file.name}</DialogTitle>
        <DialogDescription className="sr-only">
          {translate("files.kinds.image")}
        </DialogDescription>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-md bg-muted">
          {url ? (
            <img
              src={url}
              alt={file.name}
              className="max-h-[75vh] max-w-full object-contain"
            />
          ) : null}
        </div>
        <FileActions file={file} url={url} />
      </DialogContent>
    </Dialog>
  );
};

/** Open in a new tab and download */
export const FileActions = ({
  file,
  url,
  className,
}: {
  file: PreviewFile;
  url: string | undefined;
  className?: string;
}) => {
  const translate = useTranslate();
  const download = useDownloadFile();
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {url ? (
        <Button asChild variant="outline" size="sm">
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" />
            {translate("files.open")}
          </a>
        </Button>
      ) : null}
      {file.path ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => download({ path: file.path!, name: file.name })}
        >
          <Download className="size-4" />
          {translate("files.download")}
        </Button>
      ) : null}
    </div>
  );
};

const FileChip = ({
  file,
  url,
  className,
}: {
  file: PreviewFile;
  url: string | undefined;
  className?: string;
}) => {
  const translate = useTranslate();
  const download = useDownloadFile();
  const kind = fileKind(file.mime, file.name);
  const Icon = KIND_ICONS[kind];
  return (
    <div
      className={cn(
        "flex max-w-72 items-center gap-2.5 rounded-md border border-border bg-background/60 px-2.5 py-2 text-foreground",
        className,
      )}
    >
      <Icon className="size-6 shrink-0 text-muted-foreground" />
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 no-underline"
        title={file.name}
      >
        <span className="block truncate text-sm font-medium">{file.name}</span>
        <span className="block text-[11px] text-muted-foreground">
          {translate(`files.kinds.${kind}`)}
          {file.size ? ` · ${formatFileSize(file.size)}` : ""}
        </span>
      </a>
      {file.path ? (
        <button
          type="button"
          onClick={() => download({ path: file.path!, name: file.name })}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`${translate("files.download")}: ${file.name}`}
        >
          <Download className="size-4" />
        </button>
      ) : null}
    </div>
  );
};
