import { useEffect, useRef, useState, type ReactNode } from "react";

import { motionAllowed } from "./motion";

/** The first number of a text: «29,48», «1 250 000», «-8 000», «86%» */
const NUMBER = /-?\d[\d\s\u00a0\u202f]*(?:[.,]\d+)?/;

type Parsed = {
  before: string;
  after: string;
  value: number;
  decimals: number;
  decimalMark: string;
  group: string | null;
};

export const parseNumber = (text: string): Parsed | null => {
  const match = text.match(NUMBER);
  if (!match || match.index == null) return null;
  const raw = match[0].replace(/[\s\u00a0\u202f]+$/, "");
  const mark = raw.match(/[.,](\d+)$/);
  const group = raw.match(/\d([\s\u00a0\u202f])\d/)?.[1] ?? null;
  const digits = raw.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  return {
    before: text.slice(0, match.index),
    after: text.slice(match.index + raw.length),
    value,
    decimals: mark ? mark[1].length : 0,
    decimalMark: mark ? raw[raw.length - mark[1].length - 1] : ",",
    group,
  };
};

/** Writes a number the way the original text did */
export const formatLike = (parsed: Parsed, value: number) => {
  const fixed = Math.abs(value).toFixed(parsed.decimals);
  const [whole, fraction] = fixed.split(".");
  const grouped = parsed.group
    ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, parsed.group)
    : whole;
  const sign = value < 0 && Number(fixed) !== 0 ? "-" : "";
  return `${parsed.before}${sign}${grouped}${
    fraction ? parsed.decimalMark + fraction : ""
  }${parsed.after}`;
};

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * A figure that counts up to its value when it appears and glides to the
 * new one when it changes: «0 → 29,48 млн». Anything that is not a plain
 * text or number is shown as is.
 */
export const CountUp = ({
  children,
  duration = 800,
}: {
  children: ReactNode;
  duration?: number;
}) => {
  const text =
    typeof children === "string" || typeof children === "number"
      ? String(children)
      : null;
  const parsed = text != null ? parseNumber(text) : null;
  const target = parsed?.value ?? null;
  const [shown, setShown] = useState<string | null>(() =>
    parsed && motionAllowed() ? formatLike(parsed, 0) : text,
  );
  const from = useRef(0);

  useEffect(() => {
    if (text == null || parsed == null || target == null || !motionAllowed()) {
      setShown(text);
      if (target != null) from.current = target;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const value = origin + (target - origin) * ease(t);
      setShown(t < 1 ? formatLike(parsed, value) : text);
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = target;
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      from.current = target;
    };
    // The text carries the value and its format
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  if (text == null) return <>{children}</>;
  return <>{shown ?? text}</>;
};
