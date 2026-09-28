import boldUrl from "dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url";
import regularUrl from "dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url";

import type { EstimateFonts } from "./estimatePdf";

/** ArrayBuffer → base64, in chunks (a font is ~700 KB) */
export const toBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

let loading: Promise<EstimateFonts> | null = null;

/**
 * The fonts of the estimate (DejaVu Sans: Cyrillic and «₸»), fetched once
 * when the first estimate is built: they are not part of the app bundle.
 */
export const loadEstimateFonts = () => {
  loading ??= Promise.all(
    [regularUrl, boldUrl].map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("treatment.pdf.font_error");
      return toBase64(await response.arrayBuffer());
    }),
  )
    .then(([regular, bold]) => ({ regular, bold }))
    .catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
};
