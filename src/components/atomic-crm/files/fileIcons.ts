import {
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  File as FileIcon,
} from "lucide-react";

import type { FileKind } from "./fileTypes";

/** Icon of a file by its kind */
export const KIND_ICONS: Record<FileKind, typeof FileIcon> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileText,
  document: FileIcon,
};
