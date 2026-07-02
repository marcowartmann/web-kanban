import { useEffect, useState } from "react";
import { getTeams, listUsers } from "../../api/client";
import type { AuthUser, Team } from "../../types";
import UserModal from "./UserModal";

const statusPill = (active: boolean) =>
  active
    ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
    : "rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700";

export default function UsersSection({ currentUserId }: { currentUserId: number }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [editing, setEditing] = useState<AuthUser | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = () => {
    void listUsers().then(setUsers);
    void getTeams().then(setTeams);
  };
  useEffect(reload, []);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm ring-1 ring-black/5">
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
          className="ml-auto rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          + Add user
        </button>
      </header>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-2 pr-3 font-semibold">Name</th>
              <th className="px-2 py-2 font-semibold">Email</th>
              <th className="px-2 py-2 font-semibold">Team</th>
              <th className="px-2 py-2 font-semibold">Role</th>
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
                <td className="px-2 py-2 text-gray-600">{u.email}</td>
                <td className="px-2 py-2 text-gray-600">{u.team_name ?? "—"}</td>
                <td className="px-2 py-2 text-gray-600">{u.role}</td>
                <td className="px-2 py-2">
                  <span className={statusPill(u.is_active)}>{u.is_active ? "active" : "inactive"}</span>
                </td>
                <td className="px-2 py-2 text-right">
                  <button
                    aria-label={`edit user ${u.display_name}`}
                    onClick={() => setEditing(u)}
                    className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-gray-400">
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
          currentUserId={currentUserId}
          onSaved={reload}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
