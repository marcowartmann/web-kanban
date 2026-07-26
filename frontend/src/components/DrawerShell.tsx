import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, type ReactNode } from "react";
import { faXmark } from "../icons";
import { btnDangerGhost, btnPrimary, btnSecondary, closeButtonClass, zDrawer } from "./ui";

/** Shared right-docked drawer: backdrop, Escape, ✕, Delete|Cancel+Save footer. */
export default function DrawerShell({
  title,
  headerExtra,
  onClose,
  footer,
  children,
}: {
  title: string;
  headerExtra?: ReactNode;
  onClose: () => void;
  footer: {
    onDelete?: () => void;
    deleteLabel?: string;
    onCancel: () => void;
    onSave: () => void;
    saveLabel?: string;
    saving?: boolean;
  };
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-testid="drawer-backdrop"
      className={`fixed inset-0 ${zDrawer} bg-black/40 backdrop-blur-xs`}
      onClick={onClose}
    >
      <aside
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="fixed inset-y-0 right-0 flex w-[26rem] flex-col border-l border-gray-200 bg-surface shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-2 pt-5">
          <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold text-gray-900">
            <span className="truncate">{title}</span>
            {headerExtra}
          </h2>
          <button onClick={onClose} aria-label="Close" className={closeButtonClass}>
            <FontAwesomeIcon icon={faXmark} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">{children}</div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-gray-100 px-5 py-3">
          {footer.onDelete ? (
            <button onClick={footer.onDelete} className={btnDangerGhost}>
              {footer.deleteLabel ?? "Delete"}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button onClick={footer.onCancel} className={btnSecondary}>
              Cancel
            </button>
            <button onClick={footer.onSave} disabled={footer.saving} className={btnPrimary}>
              {footer.saveLabel ?? "Save"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
