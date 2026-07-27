import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import { changeMyPassword, logout } from "../api/client";
import { faArrowRightFromBracket, faChevronDown, faLock } from "../icons";
import type { AuthUser } from "../types";
import Avatar from "./Avatar";
import Banner from "./Banner";
import {
  btnGhost,
  btnPrimary,
  captionClass,
  inputClass,
  modalPanelClass,
  overlayClass,
  popoverClass,
  zModal,
  zPopover,
} from "./ui";

export default function UserMenu({
  user,
  onLoggedOut,
  compact = false,
  dropUp = false,
}: {
  user: AuthUser;
  onLoggedOut: () => void;
  compact?: boolean;
  dropUp?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setChanging(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Escape returns focus to the trigger (mirrors Menu's close(refocus) shape);
  // the two menuitem buttons move with ArrowDown/ArrowUp, wrapping between them.
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const focusAt = (pos: number) => {
    const count = itemRefs.current.length;
    itemRefs.current[((pos % count) + count) % count]?.focus();
  };
  const currentPos = () => itemRefs.current.findIndex((el) => el === document.activeElement);
  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); close(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); focusAt(currentPos() + 1); }
    if (e.key === "ArrowUp") { e.preventDefault(); focusAt(currentPos() - 1); }
  };

  const doLogout = async () => {
    try {
      await logout();
    } finally {
      onLoggedOut();
    }
  };

  const savePassword = async () => {
    setError(null);
    try {
      await changeMyPassword(current, next);
      setChanging(false);
      setCurrent("");
      setNext("");
    } catch {
      setError("Password change failed — check your current password.");
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={compact ? user.display_name : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (open && e.key === "Escape") { e.stopPropagation(); close(true); return; }
          // Click-open leaves focus on the trigger, so the menu's own
          // onKeyDown never sees this ArrowDown — handle it here too.
          if (open && e.key === "ArrowDown") { e.preventDefault(); focusAt(0); }
        }}
        className="flex items-center gap-2 rounded-full border border-gray-200 bg-surface py-1 pl-1 pr-2.5 text-sm shadow-xs transition hover:bg-gray-50 focus:outline-hidden focus:ring-2 focus:ring-blue-100"
      >
        <Avatar name={user.display_name} />
        {!compact && (
          <>
            <span className="font-medium text-gray-700">{user.display_name}</span>
            {user.role === "admin" && (
              <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                admin
              </span>
            )}
            <FontAwesomeIcon
              icon={faChevronDown}
              className={`text-xs text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          onKeyDown={onMenuKeyDown}
          className={`absolute ${zPopover} w-52 ${dropUp ? "bottom-full left-0 mb-2" : "right-0 mt-2"} ${popoverClass}`}
        >
          <div className="border-b border-gray-100 px-3 py-2">
            <p className="truncate text-sm font-medium text-gray-900">{user.display_name}</p>
            {user.email && <p className="truncate text-xs text-gray-400">{user.email}</p>}
          </div>
          <button
            ref={(el) => { itemRefs.current[0] = el; }}
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setChanging(true);
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-gray-700 transition hover:bg-gray-50"
          >
            <FontAwesomeIcon icon={faLock} className="w-4 text-xs text-gray-400" />
            Change password
          </button>
          <button
            ref={(el) => { itemRefs.current[1] = el; }}
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void doLogout();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-red-600 transition hover:bg-red-50"
          >
            <FontAwesomeIcon icon={faArrowRightFromBracket} className="w-4 text-xs" />
            Log out
          </button>
        </div>
      )}

      {changing && (
        <div className={`${overlayClass} ${zModal}`} onClick={() => setChanging(false)}>
          <div className={`${modalPanelClass} max-w-sm`} onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Change password</h2>
            <label className="mb-3 block">
              <span className={`mb-1 block ${captionClass}`}>Current password</span>
              <input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className={`w-full ${inputClass}`}
              />
            </label>
            <label className="mb-4 block">
              <span className={`mb-1 block ${captionClass}`}>New password</span>
              <input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                className={`w-full ${inputClass}`}
              />
            </label>
            {error && (
              <div className="mb-3">
                <Banner tone="error">{error}</Banner>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setChanging(false)} className={btnGhost}>
                Cancel
              </button>
              <button
                onClick={() => void savePassword()}
                className={btnPrimary}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
