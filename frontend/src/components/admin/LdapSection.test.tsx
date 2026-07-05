import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import type { LdapConfig } from "../../types";
import LdapSection from "./LdapSection";

afterEach(() => vi.restoreAllMocks());

const cfg: LdapConfig = {
  enabled: false, server_uri: "ldaps://ldap.internal:636", start_tls: false,
  ca_cert: null, bind_dn: "cn=reader,dc=x", base_dn: "dc=x",
  user_filter: "(&(objectClass=inetOrgPerson)(uid={uid}))",
  attr_email: "mail", attr_display_name: "cn", has_password: true,
};

it("loads config, masks the password, and applies the AD preset on save", async () => {
  vi.spyOn(client, "getLdapConfig").mockResolvedValue(cfg);
  const save = vi.spyOn(client, "saveLdapConfig").mockResolvedValue({ ...cfg, enabled: true });
  render(<LdapSection />);

  expect(await screen.findByDisplayValue("ldaps://ldap.internal:636")).toBeInTheDocument();
  expect(screen.getByLabelText(/bind password/i)).toHaveValue("");
  expect(screen.getByText(/password is set/i)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /active directory/i }));
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  await waitFor(() => expect(save).toHaveBeenCalled());
  const body = save.mock.calls[0][0];
  expect(body.user_filter).toContain("sAMAccountName={uid}");
  expect(body.attr_display_name).toBe("displayName");
});

it("runs a test connection and shows the result message", async () => {
  vi.spyOn(client, "getLdapConfig").mockResolvedValue(cfg);
  vi.spyOn(client, "testLdap").mockResolvedValue({ ok: true, message: "Connection and service bind OK" });
  render(<LdapSection />);
  await screen.findByDisplayValue("ldaps://ldap.internal:636");

  await userEvent.click(screen.getByRole("button", { name: /test connection/i }));
  expect(await screen.findByText(/service bind ok/i)).toBeInTheDocument();
});
