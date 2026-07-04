import { useEffect, useState } from "react";
import { ConflictError, deleteUser, getDepartments, getTeams, listUsers } from "../../api/client";
import type { AuthUser, Department, Team } from "../../types";
import ConfirmDialog from "../ConfirmDialog";
import UserModal from "./UserModal";

const statusPill = (active: boolean) =>
  active
    ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
    : "rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700";

export default function UsersSection({ currentUserId }: { currentUserId: number }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [editing, setEditing] = useState<AuthUser | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forceDelete, setForceDelete] = useState<{ user: AuthUser; detail: string } | null>(null);

  const reload = () => {
    void listUsers().then(setUsers);
    void getTeams().then(setTeams);
    void getDepartments().then(setDepartments);
  };
  useEffect(reload, []);

  const remove = async (u: AuthUser) => {
    setError(null);
    try {
      await deleteUser(u.id);
    } catch (e) {
      if (e instanceof ConflictError) {
        // Comment-guarded deletes are never forceable; everything else asks.
        if (e.detail.includes("deactivate instead")) setError(e.detail);
        else setForceDelete({ user: u, detail: e.detail });
      } else {
        setError(e instanceof Error ? e.message : "Could not delete the user.");
      }
      return;
    }
    reload();
  };

  const forceRemove = async () => {
    if (!forceDelete) return;
    const { user } = forceDelete;
    setForceDelete(null);
    try {
      await deleteUser(user.id, true);
    } catch (forced) {
      setError(forced instanceof Error ? forced.message : "Could not delete the user.");
      return;
    }
    reload();
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-surface p-5 shadow-xs ring-1 ring-black/5">
      <header className="mb-4 flex items-center gap-2.5">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-base text-rose-600"
          aria-hidden
        >
          👤
        </span>
        <h2 className="text-sm font-semibold text-gray-900">Users</h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
          {users.length}
        </span>
        <button
          onClick={() => setAdding(true)}
          className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-xs transition hover:bg-blue-700"
        >
          + Add person
        </button>
      </header>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-2 pr-3 font-semibold">Name</th>
              <th className="px-2 py-2 font-semibold">Email</th>
              <th className="px-2 py-2 font-semibold">Team</th>
              <th className="px-2 py-2 font-semibold">Role</th>
              <th className="px-2 py-2 font-semibold">Auth</th>
              <th className="px-2 py-2 font-semibold">Status</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-gray-100 last:border-0">
                <td
                  className={`whitespace-nowrap py-2 pr-3 font-medium ${
                    u.is_active ? "text-gray-800" : "text-gray-400 line-through"
                  }`}
                >
                  {u.display_name}
                </td>
                <td className="px-2 py-2 text-gray-600">{u.email ?? "—"}</td>
                <td className="px-2 py-2 text-gray-600">{u.team_name ?? "—"}</td>
                <td className="px-2 py-2 text-gray-600">{u.role}</td>
                <td className="px-2 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      u.auth_provider === "ldap"
                        ? "bg-indigo-50 text-indigo-700"
                        : u.auth_provider === "oidc"
                          ? "bg-violet-50 text-violet-700"
                          : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {u.auth_provider === "ldap" ? "LDAP" : u.auth_provider === "oidc" ? "OIDC" : "Local"}
                  </span>
                </td>
                <td className="px-2 py-2">
                  <span className={statusPill(u.is_active)}>{u.is_active ? "active" : "inactive"}</span>
                </td>
                <td className="px-2 py-2 text-right">
                  <span className="inline-flex gap-1.5">
                    <button
                      aria-label={`edit user ${u.display_name}`}
                      onClick={() => setEditing(u)}
                      className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                    >
                      Edit
                    </button>
                    {u.id !== currentUserId && (
                      <button
                        aria-label={`delete user ${u.display_name}`}
                        onClick={() => void remove(u)}
                        className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                      >
                        Delete
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-gray-400">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {adding && (
        <UserModal
          mode="create"
          teams={teams}
          departments={departments}
          currentUserId={currentUserId}
          onSaved={reload}
          onClose={() => setAdding(false)}
        />
      )}
      {editing && (
        <UserModal
          mode="edit"
          user={editing}
          teams={teams}
          departments={departments}
          currentUserId={currentUserId}
          onSaved={reload}
          onClose={() => setEditing(null)}
        />
      )}
      {forceDelete && (
        <ConfirmDialog
          title="Delete user?"
          message={forceDelete.detail}
          confirmLabel="Delete anyway"
          onConfirm={() => void forceRemove()}
          onClose={() => setForceDelete(null)}
        />
      )}
    </section>
  );
}
