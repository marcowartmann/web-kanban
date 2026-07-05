import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useState } from "react";
import { getLdapConfig, saveLdapConfig, testLdap } from "../../api/client";
import { faLock } from "../../icons";
import type { LdapConfig } from "../../types";
import { btnPrimary, btnSecondary } from "../ui";
import { adminCardClass, adminInputClass } from "./AdminCard";

const PRESETS = {
  openldap: {
    user_filter: "(&(objectClass=inetOrgPerson)(uid={uid}))",
    attr_email: "mail",
    attr_display_name: "cn",
  },
  ad: {
    user_filter: "(&(objectCategory=person)(objectClass=user)(sAMAccountName={uid}))",
    attr_email: "mail",
    attr_display_name: "displayName",
  },
} as const;

export default function LdapSection() {
  const [cfg, setCfg] = useState<LdapConfig | null>(null);
  const [password, setPassword] = useState("");
  const [testUser, setTestUser] = useState("");
  const [testPass, setTestPass] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getLdapConfig().then(setCfg);
  }, []);

  if (!cfg) return <div className={adminCardClass}>Loading…</div>;

  const patch = (p: Partial<LdapConfig>) => setCfg({ ...cfg, ...p });
  const field = (label: string, node: React.ReactNode) => (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      {node}
    </label>
  );

  const save = async () => {
    setBusy(true); setError(null); setStatus(null);
    try {
      const { has_password: _hp, ...rest } = cfg;
      const saved = await saveLdapConfig({ ...rest, password: password || undefined });
      setCfg(saved);
      setPassword("");
      setStatus("Configuration saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true); setError(null); setStatus(null);
    try {
      const res = await testLdap({
        server_uri: cfg.server_uri,
        start_tls: cfg.start_tls,
        ca_cert: cfg.ca_cert ?? undefined,
        bind_dn: cfg.bind_dn ?? undefined,
        password: password || undefined,
        base_dn: cfg.base_dn,
        user_filter: cfg.user_filter,
        attr_email: cfg.attr_email,
        attr_display_name: cfg.attr_display_name,
        test_username: testUser || undefined,
        test_password: testPass || undefined,
      });
      setStatus(res.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`flex flex-col ${adminCardClass}`}>
      <header className="mb-4 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-base text-indigo-600" aria-hidden>
          <FontAwesomeIcon icon={faLock} />
        </span>
        <h2 className="text-sm font-semibold text-gray-900">LDAP / Active Directory authentication</h2>
      </header>

      <label className="mb-4 flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
        Enable LDAP login (local admin login always remains available)
      </label>

      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Preset</span>
        <button type="button" onClick={() => patch(PRESETS.openldap)} className={btnSecondary}>OpenLDAP</button>
        <button type="button" onClick={() => patch(PRESETS.ad)} className={btnSecondary}>Active Directory</button>
      </div>

      <div className="grid gap-x-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Server</h3>
          {field("Server URI", <input aria-label="Server URI" value={cfg.server_uri} onChange={(e) => patch({ server_uri: e.target.value })} placeholder="ldaps://dc.corp.example.com:636" className={`w-full ${adminInputClass}`} />)}
          <label className="mb-3 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={cfg.start_tls} onChange={(e) => patch({ start_tls: e.target.checked })} /> Use StartTLS (for ldap:// on port 389)
          </label>
          {field("Bind DN (service account)", <input aria-label="Bind DN" value={cfg.bind_dn ?? ""} onChange={(e) => patch({ bind_dn: e.target.value })} placeholder="svc-jamra@corp.example.com" className={`w-full ${adminInputClass}`} />)}
          {field("Bind password", (
            <>
              <input aria-label="Bind password" type="password" value={password} placeholder={cfg.has_password ? "•••••• (unchanged)" : ""} onChange={(e) => setPassword(e.target.value)} className={`w-full ${adminInputClass}`} />
              {cfg.has_password && <span className="mt-1 block text-[11px] text-gray-400">Password is set — leave blank to keep it.</span>}
            </>
          ))}
          {field("CA certificate (PEM, optional for LDAPS)", <textarea aria-label="CA certificate" rows={4} value={cfg.ca_cert ?? ""} onChange={(e) => patch({ ca_cert: e.target.value })} placeholder="-----BEGIN CERTIFICATE-----" className={`w-full font-mono text-xs ${adminInputClass}`} />)}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Directory mapping</h3>
          {field("Base DN", <input aria-label="Base DN" value={cfg.base_dn} onChange={(e) => patch({ base_dn: e.target.value })} placeholder="DC=corp,DC=example,DC=com" className={`w-full ${adminInputClass}`} />)}
          {field("User filter ({uid} = login name)", <input aria-label="User filter" value={cfg.user_filter} onChange={(e) => patch({ user_filter: e.target.value })} className={`w-full font-mono text-xs ${adminInputClass}`} />)}
          {field("Email attribute", <input aria-label="Email attribute" value={cfg.attr_email} onChange={(e) => patch({ attr_email: e.target.value })} className={`w-full ${adminInputClass}`} />)}
          {field("Display-name attribute", <input aria-label="Display-name attribute" value={cfg.attr_display_name} onChange={(e) => patch({ attr_display_name: e.target.value })} className={`w-full ${adminInputClass}`} />)}

          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">Test a login (optional)</h3>
          {field("Test username", <input aria-label="Test username" value={testUser} onChange={(e) => setTestUser(e.target.value)} className={`w-full ${adminInputClass}`} />)}
          {field("Test password", <input aria-label="Test password" type="password" value={testPass} onChange={(e) => setTestPass(e.target.value)} className={`w-full ${adminInputClass}`} />)}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={() => void save()} disabled={busy} className={btnPrimary}>Save</button>
        <button onClick={() => void test()} disabled={busy} className={btnSecondary}>Test connection</button>
        {status && <span className="text-xs font-medium text-emerald-700">{status}</span>}
        {error && <span className="text-xs font-medium text-red-600">{error}</span>}
      </div>
    </section>
  );
}
