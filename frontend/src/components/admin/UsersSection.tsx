import { useEffect, useState } from "react";
import { createUser, listUsers, updateUser } from "../../api/client";
import type { AuthUser } from "../../types";
import AdminCard, {
  adminAddButtonClass,
  adminEmptyClass,
  adminInputClass,
  adminRowClass,
} from "./AdminCard";

export default function UsersSection({ currentUserId }: { currentUserId: number }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");

  const reload = () => void listUsers().then(setUsers);
  useEffect(reload, []);

  const add = async () => {
    if (!name.trim() || !email.trim() || password.length < 8) return;
    await createUser({ email: email.trim(), display_name: name.trim(), password, role });
    setName("");
    setEmail("");
    setPassword("");
    setRole("member");
    reload();
  };

  const setUserRole = async (id: number, newRole: "admin" | "member") => {
    await updateUser(id, { role: newRole });
    reload();
  };

  const setActive = async (id: number, is_active: boolean) => {
    await updateUser(id, { is_active });
    reload();
  };

  const resetPassword = async (user: AuthUser) => {
    const pw = window.prompt(`New password for ${user.display_name} (min 8 chars)`);
    if (!pw || pw.length < 8) return;
    await updateUser(user.id, { password: pw });
  };

  return (
    <AdminCard title="Users" icon="👤" accent="bg-rose-50 text-rose-600" count={users.length}>
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className={`${adminInputClass} min-w-[6rem] flex-1`}
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className={`${adminInputClass} min-w-[8rem] flex-1`}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className={`${adminInputClass} min-w-[7rem] flex-1`}
        />
        <select
          aria-label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as "admin" | "member")}
          className={adminInputClass}
        >
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
        <button onClick={() => void add()} className={adminAddButtonClass}>
          Add
        </button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {users.map((u) => (
          <li key={u.id} className={adminRowClass}>
            <span className="flex min-w-0 items-center gap-2 truncate">
              <span className={`truncate font-medium ${u.is_active ? "text-gray-800" : "text-gray-400 line-through"}`}>
                {u.display_name}
              </span>
              <span className="truncate text-xs text-gray-400">{u.email}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <select
                aria-label={`role of ${u.display_name}`}
                value={u.role}
                onChange={(e) => void setUserRole(u.id, e.target.value as "admin" | "member")}
                className="rounded-lg border border-gray-200 px-1.5 py-0.5 text-xs text-gray-600"
                disabled={u.id === currentUserId}
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
              <button
                aria-label={`reset password of ${u.display_name}`}
                onClick={() => void resetPassword(u)}
                className="rounded-md px-1.5 py-0.5 text-xs text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              >
                reset
              </button>
              {u.id !== currentUserId &&
                (u.is_active ? (
                  <button
                    aria-label={`deactivate ${u.display_name}`}
                    onClick={() => void setActive(u.id, false)}
                    className="rounded-md px-1.5 py-0.5 text-xs text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                  >
                    deactivate
                  </button>
                ) : (
                  <button
                    aria-label={`activate ${u.display_name}`}
                    onClick={() => void setActive(u.id, true)}
                    className="rounded-md px-1.5 py-0.5 text-xs text-gray-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                  >
                    activate
                  </button>
                ))}
            </span>
          </li>
        ))}
        {users.length === 0 && <li className={adminEmptyClass}>No users yet.</li>}
      </ul>
    </AdminCard>
  );
}
