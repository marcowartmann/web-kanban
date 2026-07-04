import { useEffect, useState } from "react";
import { getAuthConfig, login } from "../api/client";
import type { AuthUser } from "../types";
import { captionClass, inputClass } from "./ui";

type Method = "ldap" | "local";

export default function LoginPage({ onLoggedIn }: { onLoggedIn: (user: AuthUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState<Method>("ldap");
  const [ldapEnabled, setLdapEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAuthConfig()
      .then((c) => {
        setLdapEnabled(c.ldap_enabled);
        setMethod(c.ldap_enabled ? "ldap" : "local");
      })
      .catch(() => {
        setLdapEnabled(false);
        setMethod("local");
      });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLoggedIn(await login(username.trim(), password, method));
    } catch {
      setError("Invalid username or password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-sm rounded-2xl border border-gray-200 bg-surface p-8 shadow-xs ring-1 ring-black/5"
      >
        <h1 className="text-lg font-semibold text-gray-900">SAFe Kanban</h1>
        <p className="mb-6 mt-0.5 text-sm text-gray-500">Sign in to your workspace.</p>

        {ldapEnabled && (
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1">
            {(["ldap", "local"] as Method[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  method === m ? "bg-surface text-gray-900 shadow-xs" : "text-gray-500"
                }`}
              >
                {m === "ldap" ? "LDAP" : "Local"}
              </button>
            ))}
          </div>
        )}

        <label className="mb-3 block">
          <span className={`mb-1 block ${captionClass}`}>Username</span>
          <input
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={`w-full ${inputClass}`}
          />
        </label>
        <label className="mb-5 block">
          <span className={`mb-1 block ${captionClass}`}>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`w-full ${inputClass}`}
          />
        </label>
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
