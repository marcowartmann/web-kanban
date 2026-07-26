import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState } from "react";
import { NavLink } from "react-router";
import { useAuth } from "../auth/AuthContext";
import ThemeToggle from "../components/ThemeToggle";
import UserMenu from "../components/UserMenu";
import { captionClass } from "../components/ui";
import { faAnglesLeft, faAnglesRight } from "../icons";
import { ADMIN_ITEM, NAV_GROUPS, type NavGroup, type NavItem } from "./nav";

const COLLAPSE_KEY = "jamra.sidebarCollapsed";

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  return (
    <NavLink
      to={item.path}
      title={collapsed ? item.label : undefined}
      aria-label={item.label}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg text-sm transition focus:outline-hidden focus:ring-2 focus:ring-blue-100 ${
          collapsed ? "justify-center px-2 py-2" : "px-3 py-2"
        } ${isActive ? "bg-blue-50 font-medium text-blue-700" : "text-gray-600 hover:bg-gray-100"}`
      }
    >
      <FontAwesomeIcon icon={item.icon} fixedWidth aria-hidden />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );
}

function Group({ group, collapsed }: { group: NavGroup; collapsed: boolean }) {
  return (
    <div className="mb-1">
      {collapsed ? (
        <div aria-hidden className="mx-2 my-2 border-t border-gray-200" />
      ) : (
        <div className={`px-3 pb-1 pt-3 ${captionClass}`}>{group.label}</div>
      )}
      <div className="flex flex-col gap-0.5">
        {group.items.map((item) => (
          <SidebarLink key={item.path} item={item} collapsed={collapsed} />
        ))}
      </div>
    </div>
  );
}

/** Global navigation: grouped views, admin entry, collapse-to-rail, and the
 *  user/theme controls pinned to the footer. */
export default function Sidebar({ onLoggedOut }: { onLoggedOut: () => void }) {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");
  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-r border-gray-200 bg-surface ${collapsed ? "w-14" : "w-56"}`}
    >
      <div className={`flex items-center py-4 ${collapsed ? "justify-center" : "px-4"}`}>
        <span className="text-lg font-semibold text-gray-900">{collapsed ? "J" : "JAMra"}</span>
      </div>
      <nav aria-label="Main" className={`min-h-0 flex-1 overflow-y-auto ${collapsed ? "px-1.5" : "px-3"}`}>
        {NAV_GROUPS.map((g) => (
          <Group key={g.label} group={g} collapsed={collapsed} />
        ))}
        {user.role === "admin" && (
          <Group group={{ label: "Admin", items: [ADMIN_ITEM] }} collapsed={collapsed} />
        )}
      </nav>
      <div className={`shrink-0 border-t border-gray-200 py-3 ${collapsed ? "px-1.5" : "px-3"}`}>
        <div className={`mb-2 flex items-center ${collapsed ? "flex-col gap-1" : "justify-between"}`}>
          <ThemeToggle />
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          >
            <FontAwesomeIcon icon={collapsed ? faAnglesRight : faAnglesLeft} />
          </button>
        </div>
        <UserMenu user={user} onLoggedOut={onLoggedOut} compact={collapsed} dropUp />
      </div>
    </aside>
  );
}
