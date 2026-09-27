import {
  dealFilePath,
  defaultFileName,
  fileKind,
  fileNameFromUrl,
  isDealFilePath,
  MAX_FILE_SIZE,
  messageContentType,
  resolveMime,
  storageSafeName,
  validateFile,
} from "./attachments";
import { wazzupMessageBodies } from "./messenger";
import {
  telegramMedia,
  telegramSendPlan,
  type TelegramMessage,
} from "./telegram";

describe("file types", () => {
  it("detects the kind from the type, else from the name", () => {
    expect(fileKind("image/png")).toBe("image");
    expect(fileKind("video/mp4")).toBe("video");
    expect(fileKind("audio/ogg; codecs=opus")).toBe("audio");
    expect(fileKind("application/pdf")).toBe("pdf");
    expect(fileKind("", "Снимок.JPG")).toBe("image");
    expect(fileKind("application/octet-stream", "план.pdf")).toBe("pdf");
    expect(fileKind(null, "договор.docx")).toBe("document");
    expect(messageContentType("pdf")).toBe("document");
    expect(messageContentType("image")).toBe("image");
  });

  it("resolves the type of a file without one", () => {
    expect(resolveMime("", "a.xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(resolveMime("IMAGE/JPEG", "a.png")).toBe("image/jpeg");
    expect(resolveMime(undefined, "noext")).toBe("application/octet-stream");
  });

  it("accepts images, PDF, office documents, audio and video up to 20 MB", () => {
    expect(
      validateFile({ name: "a.jpg", size: 1000, mime: "image/jpeg" }),
    ).toBeNull();
    expect(validateFile({ name: "a.pdf", size: MAX_FILE_SIZE })).toBeNull();
    expect(validateFile({ name: "a.docx", size: 10 })).toBeNull();
    expect(
      validateFile({ name: "a.mp3", size: 10, mime: "audio/mpeg" }),
    ).toBeNull();
    expect(validateFile({ name: "a.mov", size: 10 })).toBeNull();
    expect(validateFile({ name: "a.pdf", size: MAX_FILE_SIZE + 1 })).toBe(
      "too_large",
    );
    expect(validateFile({ name: "a.pdf", size: 0 })).toBe("empty");
    expect(
      validateFile({
        name: "virus.exe",
        size: 10,
        mime: "application/x-msdownload",
      }),
    ).toBe("type_not_allowed");
    expect(validateFile({ name: "archive.zip", size: 10 })).toBe(
      "type_not_allowed",
    );
  });
});

describe("storage paths", () => {
  it("builds a clinic and deal scoped path with an ASCII key", () => {
    expect(dealFilePath(7, 42, "u1", "Снимок зуба.JPG")).toBe(
      "7/deals/42/u1-file.jpg",
    );
    expect(dealFilePath(7, 42, "u1", "plan 2024 (v2).pdf")).toBe(
      "7/deals/42/u1-plan_2024_v2.pdf",
    );
    expect(storageSafeName("../../etc/passwd")).toBe("etc_passwd");
  });

  it("only accepts a file directly in the folder of the deal", () => {
    expect(isDealFilePath("7/deals/42/u1-a.pdf", 7, 42)).toBe(true);
    expect(isDealFilePath("7/deals/43/u1-a.pdf", 7, 42)).toBe(false);
    expect(isDealFilePath("8/deals/42/u1-a.pdf", 7, 42)).toBe(false);
    expect(isDealFilePath("7/deals/42/", 7, 42)).toBe(false);
    expect(isDealFilePath("7/deals/42/x/../../43/a.pdf", 7, 42)).toBe(false);
    expect(isDealFilePath(null, 7, 42)).toBe(false);
  });

  it("names received files", () => {
    expect(
      fileNameFromUrl(
        "https://store.wazzup24.com/abc/%D0%A4%D0%BE%D1%82%D0%BE.jpg",
        "x",
      ),
    ).toBe("Фото.jpg");
    expect(
      fileNameFromUrl("https://store.wazzup24.com/abc/123", "photo.jpg"),
    ).toBe("photo.jpg");
    expect(fileNameFromUrl("not a url", "file.bin")).toBe("file.bin");
    expect(defaultFileName("image/jpeg")).toBe("photo.jpg");
    expect(defaultFileName("audio/ogg")).toBe("audio.ogg");
    expect(defaultFileName("application/x-unknown")).toBe("file.bin");
  });
});

describe("wazzupMessageBodies", () => {
  const route = {
    channelId: "ch",
    chatType: "whatsapp" as const,
    chatId: "7701",
  };

  it("sends a text as before", () => {
    expect(
      wazzupMessageBodies(
        route,
        { text: "Привет" },
        { crmMessageId: "m", crmUserId: "5" },
      ),
    ).toEqual([
      {
        channelId: "ch",
        chatType: "whatsapp",
        chatId: "7701",
        text: "Привет",
        crmUserId: "5",
        crmMessageId: "m",
      },
    ]);
  });

  it("sends a file by link, its caption as a second message", () => {
    expect(
      wazzupMessageBodies(
        route,
        { text: " План лечения ", contentUri: "https://x/f.pdf" },
        { crmMessageId: "m" },
      ),
    ).toEqual([
      {
        channelId: "ch",
        chatType: "whatsapp",
        chatId: "7701",
        contentUri: "https://x/f.pdf",
        crmMessageId: "m",
      },
      {
        channelId: "ch",
        chatType: "whatsapp",
        chatId: "7701",
        text: "План лечения",
        crmMessageId: "m:text",
      },
    ]);
    expect(
      wazzupMessageBodies(
        route,
        { text: "", contentUri: "https://x/f.pdf" },
        { crmMessageId: "m" },
      ),
    ).toHaveLength(1);
  });
});

describe("telegramSendPlan", () => {
  it("sends a text with sendMessage", () => {
    expect(telegramSendPlan("1", { text: "Здравствуйте" })).toEqual({
      file: null,
      text: { chat_id: "1", text: "Здравствуйте" },
    });
  });

  it("sends a photo by link with its caption", () => {
    expect(
      telegramSendPlan("1", {
        text: "Снимок",
        file: { mime: "image/jpeg", size: 1000 },
      }),
    ).toEqual({
      file: {
        method: "sendPhoto",
        field: "photo",
        byUrl: true,
        params: { chat_id: "1", caption: "Снимок" },
      },
      text: null,
    });
  });

  it("uploads what Telegram cannot fetch by link", () => {
    const bigPhoto = telegramSendPlan("1", {
      file: { mime: "image/png", size: 6 * 1024 * 1024 },
    });
    expect(bigPhoto.file).toMatchObject({ method: "sendPhoto", byUrl: false });
    const docx = telegramSendPlan("1", {
      file: {
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 10,
      },
    });
    expect(docx.file).toMatchObject({
      method: "sendDocument",
      field: "document",
      byUrl: false,
    });
    expect(
      telegramSendPlan("1", { file: { mime: "application/pdf", size: 10 } })
        .file,
    ).toMatchObject({
      method: "sendDocument",
      byUrl: true,
    });
    expect(
      telegramSendPlan("1", {
        file: { mime: "image/png", size: 15 * 1024 * 1024 },
      }).file,
    ).toMatchObject({
      method: "sendDocument",
    });
  });

  it("picks the player of audio and video", () => {
    expect(
      telegramSendPlan("1", { file: { mime: "video/mp4", size: 10 } }).file
        ?.method,
    ).toBe("sendVideo");
    expect(
      telegramSendPlan("1", { file: { mime: "audio/mpeg", size: 10 } }).file
        ?.method,
    ).toBe("sendAudio");
    expect(
      telegramSendPlan("1", { file: { mime: "audio/ogg", size: 10 } }).file
        ?.method,
    ).toBe("sendVoice");
  });

  it("sends a caption too long for Telegram as a separate text", () => {
    const long = "а".repeat(1100);
    const plan = telegramSendPlan("1", {
      text: long,
      file: { mime: "application/pdf", size: 10 },
    });
    expect(plan.file?.params).toEqual({ chat_id: "1" });
    expect(plan.text).toEqual({ chat_id: "1", text: long });
  });
});

describe("telegramMedia", () => {
  const base: TelegramMessage = {
    message_id: 1,
    date: 0,
    chat: { id: 1, type: "private" },
  };

  it("takes the largest photo", () => {
    expect(
      telegramMedia({
        ...base,
        photo: [
          { file_id: "small", file_size: 10 },
          { file_id: "big", file_size: 1000 },
        ],
      }),
    ).toEqual({
      file_id: "big",
      name: "photo.jpg",
      mime: "image/jpeg",
      size: 1000,
    });
  });

  it("keeps the name and type of a document, voice and video", () => {
    expect(
      telegramMedia({
        ...base,
        document: {
          file_id: "d",
          file_name: "Анализы.pdf",
          mime_type: "application/pdf",
        },
      }),
    ).toMatchObject({
      file_id: "d",
      name: "Анализы.pdf",
      mime: "application/pdf",
    });
    expect(telegramMedia({ ...base, voice: { file_id: "v" } })).toMatchObject({
      name: "voice.ogg",
      mime: "audio/ogg",
    });
    expect(telegramMedia({ ...base, video: { file_id: "w" } })).toMatchObject({
      mime: "video/mp4",
    });
  });

  it("ignores texts and files Telegram will not serve", () => {
    expect(telegramMedia({ ...base, text: "Привет" })).toBeNull();
    expect(
      telegramMedia({
        ...base,
        document: { file_id: "d", file_size: 30 * 1024 * 1024 },
      }),
    ).toBeNull();
  });
});
