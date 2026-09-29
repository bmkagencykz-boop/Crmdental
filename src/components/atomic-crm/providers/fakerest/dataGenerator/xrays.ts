import { chartRows } from "../../../dental-chart/teeth";
import type { ToothState } from "../../../patient-card/types";

/*
 * Demo X-rays of the patient card (stage 37), drawn as SVG — never fetched
 * from another host: a panoramic X-ray (ОПТГ) that follows the patient's
 * dental chart (gaps for missing teeth, bright fillings and crowns, implant
 * screws), a periapical X-ray of one tooth and a CT slice.
 */

const svg = (body: string, width: number, height: number) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
  )}`;

const DEFS =
  `<defs>` +
  `<radialGradient id="bone" cx="50%" cy="50%" r="60%">` +
  `<stop offset="0" stop-color="#8d8d8d" stop-opacity="0.55"/>` +
  `<stop offset="0.7" stop-color="#4a4a4a" stop-opacity="0.35"/>` +
  `<stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>` +
  `<linearGradient id="enamel" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="#f4f4f4"/><stop offset="1" stop-color="#9c9c9c"/></linearGradient>` +
  `<filter id="soft"><feGaussianBlur stdDeviation="1.4"/></filter>` +
  `</defs>`;

/**
 * One tooth of the panoramic image, in the upper orientation (crown at
 * the bottom); lower teeth are mirrored by the caller.
 */
const optgTooth = (
  x: number,
  y: number,
  width: number,
  height: number,
  state: ToothState | undefined,
) => {
  if (state === "missing") return "";
  const crown = height * 0.38;
  const root = height - crown;
  const parts: string[] = [];
  if (state === "implant") {
    parts.push(
      `<rect x="${x + width * 0.3}" y="${y}" width="${width * 0.4}" height="${root}" rx="3" fill="#fafafa"/>`,
      ...Array.from(
        { length: 5 },
        (_, i) =>
          `<line x1="${x + width * 0.26}" x2="${x + width * 0.74}" y1="${y + 6 + i * (root / 5)}" y2="${y + 3 + i * (root / 5)}" stroke="#2a2a2a" stroke-width="1.2"/>`,
      ),
    );
  } else {
    parts.push(
      `<path d="M${x + width * 0.22} ${y + root} C${x + width * 0.2} ${y + root * 0.4} ${x + width * 0.4} ${y} ${x + width / 2} ${y} C${x + width * 0.6} ${y} ${x + width * 0.8} ${y + root * 0.4} ${x + width * 0.78} ${y + root} Z" fill="#b8b8b8" fill-opacity="0.75"/>`,
    );
    if (state === "endo" || state === "filling") {
      parts.push(
        `<line x1="${x + width / 2}" x2="${x + width / 2}" y1="${y + 4}" y2="${y + root}" stroke="#fdfdfd" stroke-width="2"/>`,
      );
    }
  }
  if (state !== "root") {
    parts.push(
      `<rect x="${x}" y="${y + root - 2}" width="${width}" height="${crown}" rx="${width / 2.6}" fill="url(#enamel)" fill-opacity="0.85"/>`,
    );
  }
  if (state === "filling") {
    parts.push(
      `<ellipse cx="${x + width / 2}" cy="${y + root + crown * 0.45}" rx="${width * 0.3}" ry="${crown * 0.25}" fill="#ffffff"/>`,
    );
  }
  if (state === "crown" || state === "implant") {
    parts.push(
      `<rect x="${x - 1}" y="${y + root - 3}" width="${width + 2}" height="${crown + 2}" rx="${width / 2.6}" fill="#ffffff"/>`,
    );
  }
  if (state === "caries") {
    parts.push(
      `<circle cx="${x + width * 0.35}" cy="${y + root + crown * 0.4}" r="${width * 0.14}" fill="#303030"/>`,
    );
  }
  if (state === "endo") {
    parts.push(
      `<circle cx="${x + width / 2}" cy="${y + 6}" r="${width * 0.28}" fill="#1a1a1a" fill-opacity="0.8" filter="url(#soft)"/>`,
    );
  }
  return parts.join("");
};

/** «ОПТГ»: both jaws of the permanent teeth, following the chart */
export const optgImage = (
  states: Partial<Record<number, ToothState>>,
  caption: string,
) => {
  const width = 900;
  const height = 440;
  const rows = chartRows("permanent");
  const tooth = 44;
  const gap = 5;
  const left = (width - rows.upper.length * (tooth + gap)) / 2;
  // The arch: the side teeth sit a little higher (upper) / lower (lower)
  const lift = (index: number) => Math.pow(Math.abs(index - 7.5) / 7.5, 2) * 26;
  const upper = rows.upper
    .map((number, index) =>
      optgTooth(
        left + index * (tooth + gap),
        70 - lift(index),
        tooth,
        150 - Math.abs(index - 7.5) * 2,
        states[number],
      ),
    )
    .join("");
  const lower = rows.lower
    .map((number, index) => {
      const h = 150 - Math.abs(index - 7.5) * 2;
      const x = left + index * (tooth + gap);
      const y = 70 - lift(index);
      // Mirrored around the occlusal line (y = 226)
      return `<g transform="translate(0 ${452}) scale(1 -1)">${optgTooth(x, y, tooth, h, states[number])}</g>`;
    })
    .join("");
  return svg(
    DEFS +
      `<rect width="${width}" height="${height}" fill="#050505"/>` +
      `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width * 0.47}" ry="${height * 0.42}" fill="url(#bone)"/>` +
      `<path d="M60 70 Q450 -10 840 70" stroke="#6b6b6b" stroke-opacity="0.4" stroke-width="18" fill="none" filter="url(#soft)"/>` +
      `<path d="M70 380 Q450 470 830 380" stroke="#8a8a8a" stroke-opacity="0.45" stroke-width="26" fill="none" filter="url(#soft)"/>` +
      upper +
      lower +
      `<text x="24" y="${height - 16}" font-family="sans-serif" font-size="15" fill="#fff" fill-opacity="0.75">${caption}</text>` +
      `<text x="${width - 24}" y="30" text-anchor="end" font-family="sans-serif" font-size="14" fill="#fff" fill-opacity="0.6">R</text>` +
      `<text x="24" y="30" font-family="sans-serif" font-size="14" fill="#fff" fill-opacity="0.6">L</text>`,
    width,
    height,
  );
};

/** «Прицельный снимок» of one tooth */
export const periapicalImage = (
  state: ToothState | undefined,
  caption: string,
) =>
  svg(
    DEFS +
      `<rect width="360" height="440" fill="#070707"/>` +
      `<ellipse cx="180" cy="220" rx="170" ry="210" fill="url(#bone)"/>` +
      `<g transform="translate(95 40) scale(4)">${optgTooth(0, 0, 42, 85, state)}</g>` +
      `<text x="16" y="424" font-family="sans-serif" font-size="14" fill="#fff" fill-opacity="0.75">${caption}</text>`,
    360,
    440,
  );

/** «КТ»: an axial slice of the jaw with the planned implant site */
export const ctImage = (caption: string) =>
  svg(
    DEFS +
      `<rect width="520" height="420" fill="#030303"/>` +
      `<path d="M70 330 Q260 20 450 330" stroke="#d9d9d9" stroke-opacity="0.85" stroke-width="46" fill="none" filter="url(#soft)"/>` +
      `<path d="M70 330 Q260 20 450 330" stroke="#6d6d6d" stroke-width="18" fill="none"/>` +
      Array.from({ length: 12 }, (_, i) => {
        const t = (i + 0.5) / 12;
        const x = (1 - t) * (1 - t) * 70 + 2 * (1 - t) * t * 260 + t * t * 450;
        const y = (1 - t) * (1 - t) * 330 + 2 * (1 - t) * t * 20 + t * t * 330;
        return i === 9
          ? `<circle cx="${x}" cy="${y}" r="15" fill="none" stroke="#e892b2" stroke-width="2" stroke-dasharray="4 3"/>`
          : `<circle cx="${x}" cy="${y}" r="13" fill="#f5f5f5" fill-opacity="0.85"/>`;
      }).join("") +
      `<text x="16" y="404" font-family="sans-serif" font-size="14" fill="#fff" fill-opacity="0.75">${caption}</text>`,
    520,
    420,
  );
