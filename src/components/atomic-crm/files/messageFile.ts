import type { Message } from "../types";
import type { PreviewFile } from "./FilePreview";

const CONTENT_MIMES: Record<string, string> = {
  image: "image/jpeg",
  audio: "audio/ogg",
  video: "video/mp4",
};

/**
 * The file of a message: our stored copy, else the messenger's link (its
 * kind from the content type), else none.
 */
export const messageFile = (message: Message): PreviewFile | null => {
  if (message.attachment_path) {
    return {
      path: message.attachment_path,
      name: message.attachment_name ?? "file",
      mime: message.attachment_mime ?? "application/octet-stream",
      size: message.attachment_size,
    };
  }
  if (message.content_uri && message.content_type !== "text") {
    let name = "file";
    try {
      name =
        decodeURIComponent(
          new URL(message.content_uri).pathname.split("/").pop() ?? "",
        ) || name;
    } catch {
      // not a link: keep the default name
    }
    return {
      url: message.content_uri,
      name,
      mime: CONTENT_MIMES[message.content_type] ?? "application/octet-stream",
    };
  }
  return null;
};
