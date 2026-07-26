import { useEffect, useRef, useState, type ReactNode } from "react";
import { popoverClass } from "./ui";

export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean };

/** Accessible popover menu: outside-click/Escape close, arrow-key roving
 *  focus (disabled items skipped), focus returns to the trigger on close. */
export default function Menu({
  trigger,
  items,
  ariaLabel,
}: {
  trigger: (props: { open: boolean }) => ReactNode;
  items: MenuItem[];
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const enabled = items.map((it, i) => ({ it, i })).filter(({ it }) => !it.disabled);
  const focusAt = (pos: number) => {
    const target = enabled[(pos + enabled.length) % enabled.length];
    if (target) itemRefs.current[target.i]?.focus();
  };
  const currentPos = () =>
    enabled.findIndex(({ i }) => itemRefs.current[i] === document.activeElement);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); close(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); focusAt(currentPos() + 1); }
    if (e.key === "ArrowUp") { e.preventDefault(); focusAt(currentPos() - 1); }
    if (e.key === "Home") { e.preventDefault(); focusAt(0); }
    if (e.key === "End") { e.preventDefault(); focusAt(enabled.length - 1); }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (open && e.key === "Escape") { e.stopPropagation(); close(true); return; }
          if (!open && e.key === "ArrowDown") { e.preventDefault(); setOpen(true); return; }
          // Click-open leaves focus on the trigger (not the menu div), so the
          // menu's own onKeyDown never sees this ArrowDown — handle it here too.
          if (open && e.key === "ArrowDown") { e.preventDefault(); focusAt(0); }
        }}
        className="rounded-lg px-1.5 py-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-hidden focus:ring-2 focus:ring-blue-100"
      >
        {trigger({ open })}
      </button>
      {open && (
        <div role="menu" onKeyDown={onMenuKeyDown} className={`absolute left-0 z-20 mt-1 w-44 ${popoverClass}`}>
          {items.map((it, i) => (
            <button
              key={it.label}
              ref={(el) => { itemRefs.current[i] = el; }}
              role="menuitem"
              disabled={it.disabled}
              onClick={() => { close(true); it.onSelect(); }}
              className={`flex w-full items-center rounded-lg px-3 py-1.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                it.danger ? "text-red-600 hover:bg-red-50" : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
