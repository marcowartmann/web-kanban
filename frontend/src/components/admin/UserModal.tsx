import { useState } from "react";
import { ConflictError, createUser, updateUser } from "../../api/client";
import type { AuthUser, Team } from "../../types";

/** Extracts the server's `detail` message from a thrown request error. */
function errorDetail(e: unknown): string {
  if (e instanceof ConflictError) return e.detail;
  const m = e instanceof Error ? /"detail"\s*:\s*"([^"]+)"/.exec(e.message) : null;
  return m?.[1] ?? "Could not save user.";
}

export default function UserModal({
  mode,
  user,
  teams,
  currentUserId,
  onSaved,
  onClose,
}: {
  mode: "create" | "edit";
  user?: AuthUser; // required when mode === "edit"
  teams: Team[];
  currentUserId: number;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(user?.display_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [teamId, setTeamId] = useState<number | null>(user?.team_id ?? null);
  const [role, setRole] = useState<"admin" | "member">(user?.role ?? "member");
  const [active, setActive] = useState(user?.is_active ?? true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSelf = mode === "edit" && user?.id === currentUserId;
  const emailOk = email.trim() === "" || email.trim().length >= 3;
  const passwordOk =
    password === "" ? true : password.length >= 8 && email.trim().length >= 3;
  const valid = name.trim().length > 0 && emailOk && passwordOk;

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "create") {
        await createUser({
          email: email.trim() === "" ? null : email.trim(),
          display_name: name.trim(),
          password: password === "" ? null : password,
          role,
          team_id: teamId,
        });
      } else if (user) {
        const diff: Parameters<typeof updateUser>[1] = {};
        if (name.trim() !== user.display_name) diff.display_name = name.trim();
        const trimmedEmail = email.trim();
        const currentEmail = user.email ?? "";
        if (trimmedEmail.toLowerCase() !== currentEmail) {
          diff.email = trimmedEmail === "" ? null : trimmedEmail;
        }
        if ((user.team_id ?? null) !== teamId) diff.team_id = teamId;
        if (role !== user.role) diff.role = role;
        if (active !== user.is_active) diff.is_active = active;
        if (password) diff.password = password;
        if (Object.keys(diff).length) await updateUser(user.id, diff);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(errorDetail(e));
    } finally {
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm transition focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100";
  const caption = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400";

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold text-gray-900">
          {mode === "create" ? "Add user" : `Edit ${user?.display_name}`}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 block">
            <span className={caption}>Display name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </label>
          <label className="col-span-2 block">
            <span className={caption}>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Optional — needed to log in"
              className={field}
            />
          </label>
          <label className="block">
            <span className={caption}>Team</span>
            <select
              value={teamId ?? ""}
              onChange={(e) => setTeamId(e.target.value === "" ? null : Number(e.target.value))}
              className={field}
            >
              <option value="">No team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={caption}>Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "member")}
              disabled={isSelf}
              className={field}
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <label className="col-span-2 block">
            <span className={caption}>
              {mode === "create" ? "Password" : "New password (leave empty to keep)"}
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={field}
            />
          </label>
          {mode === "edit" && !isSelf && (
            <label className="col-span-2 flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              Active
            </label>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={!valid || busy}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
