import { useState } from "react";
import { login } from "../api/client";
import type { AuthUser } from "../types";
import { captionClass, inputClass } from "./ui";

export default function LoginPage({ onLoggedIn }: { onLoggedIn: (user: AuthUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLoggedIn(await login(email.trim(), password));
    } catch {
      setError("Invalid email or password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm ring-1 ring-black/5"
      >
        <h1 className="text-lg font-semibold text-gray-900">SAFe Kanban</h1>
        <p className="mb-6 mt-0.5 text-sm text-gray-500">Sign in to your workspace.</p>
        <label className="mb-3 block">
          <span className={`mb-1 block ${captionClass}`}>Email</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
