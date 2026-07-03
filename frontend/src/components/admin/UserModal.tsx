import { useState } from "react";
import { ConflictError, createUser, setUserDepartments, updateUser } from "../../api/client";
import type { AuthUser, Department, Team } from "../../types";
import { btnGhost, captionClass, inputClass, modalPanelClass, overlayClass } from "../ui";

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
  departments,
  currentUserId,
  onSaved,
  onClose,
}: {
  mode: "create" | "edit";
  user?: AuthUser; // required when mode === "edit"
  teams: Team[];
  departments: Department[];
  currentUserId: number;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(user?.display_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [teamId, setTeamId] = useState<number | null>(user?.team_id ?? null);
  const [role, setRole] = useState<"admin" | "member">(user?.role ?? "member");
  const [active, setActive] = useState(user?.is_active ?? true);
  const [password, setPassword] = useState("");
  const [deptIds, setDeptIds] = useState<number[]>(user?.department_ids ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSelf = mode === "edit" && user?.id === currentUserId;
  const emailOk = email.trim() === "" || email.trim().length >= 3;
  const passwordOk =
    password === "" ? true : password.length >= 8 && username.trim() !== "";
  const valid = name.trim().length > 0 && emailOk && passwordOk;

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "create") {
        const created = await createUser({
          email: email.trim() === "" ? null : email.trim(),
          username: username.trim() === "" ? null : username.trim(),
          display_name: name.trim(),
          password: password === "" ? null : password,
          role,
          team_id: teamId,
        });
        if (deptIds.length) await setUserDepartments(created.id, deptIds);
      } else if (user) {
        const diff: Parameters<typeof updateUser>[1] = {};
        if (name.trim() !== user.display_name) diff.display_name = name.trim();
        const trimmedEmail = email.trim();
        const currentEmail = user.email ?? "";
        if (trimmedEmail.toLowerCase() !== currentEmail) {
          diff.email = trimmedEmail === "" ? null : trimmedEmail;
        }
        const trimmedUsername = username.trim();
        if (trimmedUsername !== (user.username ?? "")) {
          diff.username = trimmedUsername === "" ? null : trimmedUsername;
        }
        if ((user.team_id ?? null) !== teamId) diff.team_id = teamId;
        if (role !== user.role) diff.role = role;
        if (active !== user.is_active) diff.is_active = active;
        if (password) diff.password = password;
        if (Object.keys(diff).length) await updateUser(user.id, diff);
        const before = user.department_ids ?? [];
        const changed =
          deptIds.length !== before.length || deptIds.some((id) => !before.includes(id));
        if (changed) await setUserDepartments(user.id, deptIds);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(errorDetail(e));
    } finally {
      setBusy(false);
    }
  };

  const field = `w-full ${inputClass}`;
  const caption = `mb-1 block ${captionClass}`;

  return (
    <div className={`${overlayClass} z-30`} onClick={onClose}>
      <div className={`${modalPanelClass} max-w-md`} onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-sm font-semibold text-gray-900">
          {mode === "create" ? "Add user" : `Edit ${user?.display_name}`}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 block">
            <span className={caption}>Display name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </label>
          <label className="col-span-2 block">
            <span className={caption}>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Optional — needed to log in"
              className={field}
            />
          </label>
          <label className="col-span-2 block">
            <span className={caption}>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Optional"
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
          {departments.length > 0 && (
            <div className="col-span-2">
              <span className={caption}>Departments</span>
              <div className="mt-1 grid grid-cols-2 gap-1">
                {departments.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={deptIds.includes(d.id)}
                      onChange={() =>
                        setDeptIds((ids) =>
                          ids.includes(d.id) ? ids.filter((x) => x !== d.id) : [...ids, d.id],
                        )
                      }
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    {d.name} <span className="text-xs text-gray-400">· {d.team_name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
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
          <button onClick={onClose} className={btnGhost}>
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={!valid || busy}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
