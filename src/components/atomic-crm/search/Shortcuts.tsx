import { useEffect, useRef, useState } from "react";
import { useTranslate } from "ra-core";
import { useNavigate } from "react-router";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { focusGlobalSearch } from "./GlobalSearch";
import {
  createShortcutReader,
  isTypingTarget,
  SHORTCUTS,
  type ShortcutHit,
} from "./shortcuts";

/**
 * Keyboard shortcuts of the whole CRM: «/» and Ctrl/Cmd+K — search, «?» —
 * this help, N — new deal, Shift+N — new patient, g + letter — sections.
 */
export const GlobalShortcuts = () => {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const readRef = useRef(createShortcutReader());

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      // Dialogs (forms, confirmations) keep their keys
      const inDialog =
        event.target instanceof Element &&
        event.target.closest("[role='dialog'], [role='alertdialog']");
      const hit: ShortcutHit = readRef.current({
        code: event.code,
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        typing: isTypingTarget(event.target) || !!inDialog,
        time: event.timeStamp || Date.now(),
      });
      if (!hit) return;
      event.preventDefault();
      if ("to" in hit) {
        navigate(hit.to);
        return;
      }
      switch (hit.action) {
        case "search":
          focusGlobalSearch();
          break;
        case "help":
          setHelpOpen(true);
          break;
        case "new_deal":
          navigate("/deals/create");
          break;
        case "new_patient":
          navigate("/patients/create");
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  return <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />;
};

const Keys = ({ keys }: { keys: string[] }) => {
  const translate = useTranslate();
  const sequence = keys[0] === "g";
  return (
    <span className="flex items-center gap-1">
      {keys.map((key, index) => (
        <span key={index} className="flex items-center gap-1">
          {index > 0 ? (
            <span className="text-xs text-muted-foreground">
              {sequence ? translate("search.shortcuts.then") : "+"}
            </span>
          ) : null}
          <kbd className="min-w-6 rounded-sm border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-xs">
            {key}
          </kbd>
        </span>
      ))}
    </span>
  );
};

export const ShortcutsHelp = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const translate = useTranslate();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{translate("search.shortcuts.title")}</DialogTitle>
        <DialogDescription>
          {translate("search.shortcuts.hint")}
        </DialogDescription>
        <dl className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 text-sm">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys.join("+")} className="contents">
              <dt>{translate(shortcut.label)}</dt>
              <dd className="flex items-center gap-1">
                <Keys keys={shortcut.keys} />
                {shortcut.alt ? (
                  <>
                    <span className="text-xs text-muted-foreground">
                      {translate("search.shortcuts.or")}
                    </span>
                    <Keys keys={shortcut.alt} />
                  </>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
};

/** «?» in the top bar: opens the list of shortcuts */
export const ShortcutsButton = () => {
  const translate = useTranslate();
  const [open, setOpen] = useState(false);
  const label = translate("search.shortcuts.title");
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex size-9 items-center justify-center rounded-md text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={label}
        title={`${label} (?)`}
      >
        ?
      </button>
      <ShortcutsHelp open={open} onOpenChange={setOpen} />
    </>
  );
};
