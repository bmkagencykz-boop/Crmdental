import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Glossy «3D» dental objects of the design (the reference's green bubbles,
 * made pink and dental): a molar, an implant and spheres, drawn in SVG with
 * light, reflections and a soft shadow, so they stay sharp at any size and
 * need no image files.
 */

type Tone = "neon" | "soft" | "ink";

const TONES: Record<Tone, [string, string, string, string]> = {
  // highlight, light, body, edge
  neon: ["#fff1f8", "#ff8cc6", "#ff2e93", "#b3005f"],
  soft: ["#ffffff", "#ffe3f1", "#ffb8dc", "#e0569f"],
  ink: ["#8a8a92", "#3a3a40", "#1c1c20", "#050506"],
};

/** A molar with its two roots */
export const Molar3D = ({
  tone = "neon",
  className,
}: {
  tone?: Tone;
  className?: string;
}) => {
  const id = useId().replace(/:/g, "");
  const [hi, light, body, edge] = TONES[tone];
  return (
    <svg
      viewBox="0 0 200 250"
      className={cn("overflow-visible", className)}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`${id}b`} cx="0.34" cy="0.24" r="0.9">
          <stop offset="0" stopColor={hi} />
          <stop offset="0.22" stopColor={light} />
          <stop offset="0.62" stopColor={body} />
          <stop offset="1" stopColor={edge} />
        </radialGradient>
        <linearGradient id={`${id}r`} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.7" />
          <stop offset="0.18" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id={`${id}blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <ellipse
        cx="100"
        cy="238"
        rx="62"
        ry="9"
        fill="#121214"
        opacity="0.18"
        filter={`url(#${id}blur)`}
      />
      <path
        d="M44 60C40 32 66 16 84 30C94 18 106 18 116 30C134 16 160 32 156 60C154 84 150 104 146 122C142 150 140 188 130 214C124 228 108 226 108 206C108 184 106 162 100 150C94 162 92 184 92 206C92 226 76 228 70 214C60 188 58 150 54 122C50 104 46 84 44 60Z"
        fill={`url(#${id}b)`}
      />
      <path
        d="M44 60C40 32 66 16 84 30C94 18 106 18 116 30C134 16 160 32 156 60C154 84 150 104 146 122C142 150 140 188 130 214C124 228 108 226 108 206C108 184 106 162 100 150C94 162 92 184 92 206C92 226 76 228 70 214C60 188 58 150 54 122C50 104 46 84 44 60Z"
        fill={`url(#${id}r)`}
      />
      {/* Cusps' shading and the fissure between them */}
      <path
        d="M70 44C80 50 90 50 100 44C110 50 120 50 130 44"
        fill="none"
        stroke={edge}
        strokeOpacity="0.28"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* Reflections */}
      <ellipse
        cx="70"
        cy="54"
        rx="15"
        ry="22"
        fill="#ffffff"
        opacity="0.75"
        transform="rotate(-24 70 54)"
        filter={`url(#${id}blur)`}
      />
      <ellipse
        cx="66"
        cy="50"
        rx="5"
        ry="9"
        fill="#ffffff"
        opacity="0.95"
        transform="rotate(-24 66 50)"
      />
      <ellipse cx="80" cy="170" rx="3" ry="16" fill="#ffffff" opacity="0.35" />
    </svg>
  );
};

/** A dental implant: the crown on a threaded post */
export const Implant3D = ({
  tone = "neon",
  className,
}: {
  tone?: Tone;
  className?: string;
}) => {
  const id = useId().replace(/:/g, "");
  const [hi, light, body, edge] = TONES[tone];
  const [mhi, mlight, mbody, medge] = TONES.ink;
  return (
    <svg
      viewBox="0 0 120 240"
      className={cn("overflow-visible", className)}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`${id}c`} cx="0.35" cy="0.28" r="0.85">
          <stop offset="0" stopColor={hi} />
          <stop offset="0.25" stopColor={light} />
          <stop offset="0.65" stopColor={body} />
          <stop offset="1" stopColor={edge} />
        </radialGradient>
        <linearGradient id={`${id}m`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={mbody} />
          <stop offset="0.3" stopColor={mhi} />
          <stop offset="0.55" stopColor={mlight} />
          <stop offset="1" stopColor={medge} />
        </linearGradient>
      </defs>
      <path
        d="M22 44C20 22 36 10 50 18C56 10 64 10 70 18C84 10 100 22 98 44C96 62 88 76 60 80C32 76 24 62 22 44Z"
        fill={`url(#${id}c)`}
      />
      <ellipse
        cx="42"
        cy="34"
        rx="7"
        ry="12"
        fill="#ffffff"
        opacity="0.85"
        transform="rotate(-24 42 34)"
      />
      <rect x="44" y="80" width="32" height="10" rx="3" fill={`url(#${id}m)`} />
      {Array.from({ length: 9 }, (_, i) => (
        <rect
          key={i}
          x={42 + i * 0.9}
          y={94 + i * 14}
          width={36 - i * 1.8}
          height="9"
          rx="4.5"
          fill={`url(#${id}m)`}
        />
      ))}
      <path d="M50 220L60 234L70 220Z" fill={`url(#${id}m)`} />
    </svg>
  );
};

/** A glossy sphere */
export const Sphere3D = ({
  tone = "neon",
  size,
  style,
  className,
}: {
  tone?: Tone;
  size: number;
  style?: React.CSSProperties;
  className?: string;
}) => {
  const [hi, light, body, edge] = TONES[tone];
  return (
    <span
      className={cn("absolute rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 32% 28%, ${hi} 0%, ${light} 18%, ${body} 55%, ${edge} 100%)`,
        boxShadow: `inset -${size / 10}px -${size / 10}px ${size / 5}px rgba(0,0,0,0.12), 0 ${size / 6}px ${size / 3}px -${size / 6}px rgba(18,18,20,0.35)`,
        ...style,
      }}
      aria-hidden
    />
  );
};

/**
 * The hero composition: a big molar in a cloud of spheres and a small
 * implant — the reference's 3D bubbles, dental and pink.
 */
export const DentalCloud = ({ className }: { className?: string }) => (
  <div className={cn("pointer-events-none relative", className)} aria-hidden>
    {[
      [8, 30, 44, "neon"],
      [60, 8, 26, "soft"],
      [78, 62, 34, "neon"],
      [14, 70, 20, "soft"],
      [86, 22, 16, "neon"],
      [40, 4, 14, "neon"],
      [4, 52, 12, "neon"],
      [66, 80, 18, "soft"],
      [50, 88, 10, "neon"],
      [92, 44, 22, "soft"],
      [28, 14, 18, "soft"],
    ].map(([left, top, size, tone], index) => (
      <Sphere3D
        key={index}
        tone={tone as Tone}
        size={size as number}
        style={{ left: `${left}%`, top: `${top}%` }}
      />
    ))}
    <Molar3D className="absolute top-[12%] left-[22%] w-[52%] drop-shadow-[0_24px_30px_rgba(255,46,147,0.35)]" />
    <Implant3D
      className="absolute top-[40%] left-[68%] w-[20%] rotate-[18deg]"
      tone="soft"
    />
  </div>
);
