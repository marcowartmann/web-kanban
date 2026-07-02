import { useState } from "react";
import { changeMyPassword, logout } from "../api/client";
import type { AuthUser } from "../types";

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
    await logout();
    onLoggedOut();
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
      <button
        onClick={() => setChanging(true)}
        className="rounded-lg px-2 py-1 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
      >
        Change password
      </button>
      <button
        onClick={() => void doLogout()}
        className="rounded-lg px-2 py-1 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
      >
        Log out
      </button>

      {changing && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm"
          onClick={() => setChanging(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Change password</h2>
            <label className="mb-3 block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
                Current password
              </span>
              <input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="mb-4 block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">
                New password
              </span>
              <input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setChanging(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={() => void savePassword()}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700"
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
