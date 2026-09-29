import { describe, expect, it } from "vitest";

import { isFetchableUrl } from "./safeUrl.ts";

describe("isFetchableUrl", () => {
  it("takes the https links of the messengers", () => {
    expect(isFetchableUrl("https://store.wazzup24.com/abc/photo.jpg")).toBe(
      true,
    );
    expect(
      isFetchableUrl("https://api.telegram.org/file/bot123:abc/photos/1.jpg"),
    ).toBe(true);
  });

  it("refuses plain http, credentials and odd schemes", () => {
    expect(isFetchableUrl("http://store.wazzup24.com/a.jpg")).toBe(false);
    expect(isFetchableUrl("https://user:pass@example.com/a.jpg")).toBe(false);
    expect(isFetchableUrl("file:///etc/passwd")).toBe(false);
    expect(isFetchableUrl("not a url")).toBe(false);
  });

  it("refuses local, private and metadata addresses", () => {
    for (const url of [
      "https://localhost/a",
      "https://127.0.0.1/a",
      "https://10.1.2.3/a",
      "https://172.20.0.1/a",
      "https://192.168.1.1/a",
      "https://169.254.169.254/latest/meta-data",
      "https://100.64.0.1/a",
      "https://[::1]/a",
      "https://kong/a",
      "https://db.internal/a",
    ]) {
      expect(isFetchableUrl(url), url).toBe(false);
    }
  });
});
