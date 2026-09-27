import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useDataProvider,
  useGetList,
  useNotify,
  type Identifier,
} from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { DealFile } from "../types";
import { isInlineFile } from "./fileTypes";

/** Signed links last an hour: reuse them for 50 minutes */
const URL_STALE_MS = 50 * 60 * 1000;

/** Address of a stored file (a signed link; a demo file is its own address) */
export const useFileUrl = (path: string | null | undefined) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: ["file-url", path],
    queryFn: () => dataProvider.getFileUrl(path!),
    enabled: !!path && !isInlineFile(path),
    staleTime: URL_STALE_MS,
    gcTime: URL_STALE_MS,
    ...(path && isInlineFile(path) ? { initialData: path } : {}),
  });
};

/** Saves a file under its own name */
export const useDownloadFile = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  return async (file: { path: string; name: string }) => {
    try {
      const url = await dataProvider.getFileUrl(file.path, file.name);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      notify("files.errors.not_found", { type: "error" });
    }
  };
};

/** Files of a deal, newest first */
export const useDealFiles = (dealId: Identifier | undefined) =>
  useGetList<DealFile>(
    "deal_files",
    {
      filter: { deal_id: dealId },
      sort: { field: "created_at", order: "DESC" },
      pagination: { page: 1, perPage: 500 },
    },
    { enabled: dealId != null },
  );

const refreshFiles = (queryClient: ReturnType<typeof useQueryClient>) => {
  for (const key of ["deal_files", "audit_log"]) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
};

/** Uploads several files one after another; each failure is reported */
export const useUploadDealFiles = (dealId: Identifier) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const notify = useNotify();
  return useMutation({
    mutationFn: async (files: File[]) => {
      let uploaded = 0;
      for (const file of files) {
        try {
          await dataProvider.uploadDealFile(dealId, file);
          uploaded++;
        } catch (error) {
          notify((error as Error).message || "files.errors.upload", {
            type: "error",
            messageArgs: { name: file.name },
          });
        }
      }
      return uploaded;
    },
    onSuccess: (uploaded) => {
      refreshFiles(queryClient);
      if (uploaded) {
        notify("files.uploaded", {
          type: "info",
          messageArgs: { smart_count: uploaded },
        });
      }
    },
  });
};

export const useDeleteDealFile = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const notify = useNotify();
  return useMutation({
    mutationFn: (file: DealFile) => dataProvider.deleteDealFile(file),
    onSuccess: () => {
      refreshFiles(queryClient);
      notify("files.deleted", { type: "info" });
    },
    onError: (error: Error) =>
      notify(error.message || "files.errors.delete", { type: "error" }),
  });
};
