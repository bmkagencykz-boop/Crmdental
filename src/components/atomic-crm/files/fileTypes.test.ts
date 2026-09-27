import {
  captionOf,
  dealFilePath,
  FILE_ACCEPT,
  fileKind,
  formatFileSize,
  isInlineFile,
  MAX_FILE_SIZE,
  resolveMime,
  validateFile,
} from "./fileTypes";

describe("fileKind", () => {
  it("detects images, video, audio, PDF and documents", () => {
    expect(fileKind("image/jpeg")).toBe("image");
    expect(fileKind("video/quicktime")).toBe("video");
    expect(fileKind("audio/ogg; codecs=opus")).toBe("audio");
    expect(fileKind("application/pdf")).toBe("pdf");
    expect(fileKind("application/msword")).toBe("document");
  });

  it("falls back on the extension when the browser gives no type", () => {
    expect(fileKind("", "Снимок.HEIC")).toBe("image");
    expect(fileKind("application/octet-stream", "план.pdf")).toBe("pdf");
    expect(resolveMime(null, "смета.xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });
});

describe("validateFile", () => {
  it("accepts the allowed types up to 20 MB", () => {
    expect(
      validateFile({ name: "a.jpg", size: 1000, type: "image/jpeg" }),
    ).toBeNull();
    expect(
      validateFile({ name: "a.pdf", size: MAX_FILE_SIZE, type: "" }),
    ).toBeNull();
    expect(validateFile({ name: "договор.docx", size: 10 })).toBeNull();
    expect(
      validateFile({ name: "voice.ogg", size: 10, type: "audio/ogg" }),
    ).toBeNull();
    expect(
      validateFile({ name: "clip.mp4", size: 10, type: "video/mp4" }),
    ).toBeNull();
  });

  it("refuses big, empty and other files", () => {
    expect(
      validateFile({ name: "a.pdf", size: MAX_FILE_SIZE + 1, type: "" }),
    ).toBe("too_large");
    expect(validateFile({ name: "a.pdf", size: 0 })).toBe("empty");
    expect(
      validateFile({
        name: "setup.exe",
        size: 10,
        type: "application/x-msdownload",
      }),
    ).toBe("type_not_allowed");
    expect(validateFile({ name: "archive.zip", size: 10 })).toBe(
      "type_not_allowed",
    );
  });

  it("offers the same types in the file picker", () => {
    expect(FILE_ACCEPT).toContain("image/*");
    expect(FILE_ACCEPT).toContain(".pdf");
    expect(FILE_ACCEPT).toContain(".docx");
    expect(FILE_ACCEPT).not.toContain(".mp3");
  });
});

describe("paths and sizes", () => {
  it("stores a file under the clinic and the deal", () => {
    expect(dealFilePath(3, 17, "u", "Снимок 1.jpg")).toBe("3/deals/17/u-1.jpg");
    expect(dealFilePath(3, 17, "u", "plan.final.PDF")).toBe(
      "3/deals/17/u-plan.final.pdf",
    );
  });

  it("formats sizes in Russian", () => {
    expect(formatFileSize(512)).toBe("512 Б");
    expect(formatFileSize(1536)).toBe("1,5 КБ");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5 МБ");
  });

  it("knows demo files", () => {
    expect(isInlineFile("data:image/svg+xml;base64,AAA")).toBe(true);
    expect(isInlineFile("3/deals/17/u-a.jpg")).toBe(false);
  });
});

describe("captionOf", () => {
  it("drops the placeholder of a received file", () => {
    expect(captionOf("[Фото]")).toBeNull();
    expect(captionOf("[Фото]: болит здесь")).toBe("болит здесь");
    expect(captionOf("[Файл Анализы.pdf]")).toBeNull();
    expect(captionOf("[Голосовое сообщение]")).toBeNull();
    expect(captionOf("Обычный текст")).toBe("Обычный текст");
    expect(captionOf(null)).toBeNull();
  });
});
