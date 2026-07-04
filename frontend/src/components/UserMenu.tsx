import { useEffect, useRef, useState } from "react";
import { changeMyPassword, logout } from "../api/client";
import type { AuthUser } from "../types";
import Avatar from "./Avatar";
import { btnGhost, captionClass, inputClass, modalPanelClass, overlayClass, popoverClass } from "./ui";

export default function UserMenu({
  user,
  onLoggedOut,
}: {
  user: AuthUser;
  onLoggedOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

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
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-gray-200 bg-surface py-1 pl-1 pr-2.5 text-sm shadow-xs transition hover:bg-gray-50 focus:outline-hidden focus:ring-2 focus:ring-blue-100"
      >
        <Avatar name={user.display_name} />
        <span className="font-medium text-gray-700">{user.display_name}</span>
        {user.role === "admin" && (
          <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
            admin
          </span>
        )}
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div role="menu" className={`absolute right-0 z-30 mt-2 w-52 ${popoverClass}`}>
          <div className="border-b border-gray-100 px-3 py-2">
            <p className="truncate text-sm font-medium text-gray-900">{user.display_name}</p>
            {user.email && <p className="truncate text-xs text-gray-400">{user.email}</p>}
          </div>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setChanging(true);
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-gray-700 transition hover:bg-gray-50"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4 text-gray-400">
              <path
                fillRule="evenodd"
                d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
                clipRule="evenodd"
              />
            </svg>
            Change password
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void doLogout();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-red-600 transition hover:bg-red-50"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path
                fillRule="evenodd"
                d="M3 4a1 1 0 011-1h6a1 1 0 110 2H5v10h5a1 1 0 110 2H4a1 1 0 01-1-1V4zm10.293 2.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L14.586 11H8a1 1 0 110-2h6.586l-1.293-1.293a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
            Log out
          </button>
        </div>
      )}

      {changing && (
        <div className={`${overlayClass} z-30`} onClick={() => setChanging(false)}>
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
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setChanging(false)} className={btnGhost}>
                Cancel
              </button>
              <button
                onClick={() => void savePassword()}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-xs transition hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-200"
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
