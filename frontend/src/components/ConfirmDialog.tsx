import { btnDanger, btnGhost, modalPanelClass, overlayClass, zConfirm } from "./ui";

/** Styled replacement for window.confirm — always danger-flavored, since it
 *  guards destructive actions. Cancel is autofocused so Enter can never
 *  destroy. The caller owns the open/closed state: onConfirm runs the action
 *  (the caller also clears its pending state), onClose is cancel. */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label={title}
      className={`${overlayClass} ${zConfirm}`}
      onClick={(e) => {
        // Mounted inside the drawer tree, a bubbling click would reach the
        // app's panel backdrop and close every open panel.
        e.stopPropagation();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // Same bubbling risk as the click guard above: an unstopped Escape
          // would continue to DrawerShell's document-level listener and
          // close the drawer underneath too.
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className={`${modalPanelClass} max-w-md`} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <p className="mt-2 whitespace-pre-line text-sm text-gray-600">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button autoFocus onClick={onClose} className={btnGhost}>
            Cancel
          </button>
          <button onClick={() => void onConfirm()} className={btnDanger}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
