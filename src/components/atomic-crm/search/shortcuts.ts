/**
 * Keyboard shortcuts of the CRM (stage 31). Keys are read by their physical
 * position (KeyboardEvent.code), so they work the same with the Russian
 * layout: «g» then «d» is «п» then «в» on a Russian keyboard.
 */

export type ShortcutAction = "search" | "help" | "new_deal" | "new_patient";

export type Shortcut = {
  /** Keys shown in the help, e.g. ["g", "d"] or ["Ctrl", "K"] */
  keys: string[];
  /** Another way to press it, shown after «или» */
  alt?: string[];
  /** A route to open, or an action */
  to?: string;
  action?: ShortcutAction;
  /** i18n key of the description */
  label: string;
};

export const SHORTCUTS: Shortcut[] = [
  {
    keys: ["/"],
    alt: ["Ctrl", "K"],
    action: "search",
    label: "search.shortcuts.search",
  },
  { keys: ["?"], action: "help", label: "search.shortcuts.help" },
  { keys: ["N"], action: "new_deal", label: "search.shortcuts.new_deal" },
  {
    keys: ["Shift", "N"],
    action: "new_patient",
    label: "search.shortcuts.new_patient",
  },
  { keys: ["g", "h"], to: "/", label: "search.shortcuts.go_dashboard" },
  { keys: ["g", "d"], to: "/deals", label: "search.shortcuts.go_deals" },
  { keys: ["g", "i"], to: "/inbox", label: "search.shortcuts.go_inbox" },
  { keys: ["g", "t"], to: "/tasks", label: "search.shortcuts.go_tasks" },
  { keys: ["g", "s"], to: "/schedule", label: "search.shortcuts.go_schedule" },
  { keys: ["g", "p"], to: "/patients", label: "search.shortcuts.go_patients" },
  { keys: ["g", "r"], to: "/reports", label: "search.shortcuts.go_reports" },
];

/** Routes of the «g x» sequences, by the code of the second key */
const GO_ROUTES: Record<string, string> = {
  KeyH: "/",
  KeyD: "/deals",
  KeyI: "/inbox",
  KeyT: "/tasks",
  KeyS: "/schedule",
  KeyP: "/patients",
  KeyR: "/reports",
};

/** How long the second key of «g x» is awaited */
export const SEQUENCE_TIMEOUT_MS = 1500;

export type KeyInput = {
  code: string;
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  /** The focus is in a text field: only Ctrl/Cmd+K works there */
  typing?: boolean;
  /** Milliseconds (event.timeStamp or Date.now()) */
  time: number;
};

export type ShortcutHit = { action: ShortcutAction } | { to: string } | null;

/**
 * A stateful reader of key presses: returns what a press triggers, keeping
 * the first key of a «g x» sequence.
 */
export const createShortcutReader = () => {
  let pendingG: number | null = null;
  return (input: KeyInput): ShortcutHit => {
    const { code, key, ctrlKey, metaKey, altKey, shiftKey, typing, time } =
      input;
    // Ctrl+K / Cmd+K: everywhere, even in a text field
    if ((ctrlKey || metaKey) && !altKey && code === "KeyK") {
      pendingG = null;
      return { action: "search" };
    }
    if (typing || ctrlKey || metaKey || altKey) {
      pendingG = null;
      return null;
    }
    if (pendingG != null) {
      const started = pendingG;
      pendingG = null;
      if (time - started <= SEQUENCE_TIMEOUT_MS && !shiftKey) {
        const to = GO_ROUTES[code];
        if (to) return { to };
      }
    }
    // «?» is Shift + the «/» key (in both layouts); «/» alone focuses search
    if (code === "Slash" || key === "?" || key === "/") {
      if (shiftKey || key === "?") return { action: "help" };
      return { action: "search" };
    }
    if (code === "KeyG" && !shiftKey) {
      pendingG = time;
      return null;
    }
    if (code === "KeyN") {
      return { action: shiftKey ? "new_patient" : "new_deal" };
    }
    return null;
  };
};

/** Is the element a place where keys type text */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!target || typeof (target as HTMLElement).tagName !== "string") {
    return false;
  }
  const element = target as HTMLElement;
  const tag = element.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") {
    const type = ((element as HTMLInputElement).type ?? "text").toLowerCase();
    return !["checkbox", "radio", "button", "submit", "reset"].includes(type);
  }
  return element.isContentEditable === true;
};
