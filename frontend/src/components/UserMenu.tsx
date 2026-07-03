import { useState } from "react";
import { changeMyPassword, logout } from "../api/client";
import type { AuthUser } from "../types";
import { btnGhost, captionClass, inputClass, modalPanelClass, overlayClass } from "./ui";

export default function UserMenu({
  user,
  onLoggedOut,
}: {
  user: AuthUser;
  onLoggedOut: () => void;
}) {
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
        {user.display_name}
        {user.role === "admin" && (
          <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
            admin
          </span>
        )}
      </span>
      <button onClick={() => setChanging(true)} className={btnGhost}>
        Change password
      </button>
      <button onClick={() => void doLogout()} className={btnGhost}>
        Log out
      </button>

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
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
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
