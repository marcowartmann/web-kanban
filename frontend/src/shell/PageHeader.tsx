import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { faChevronLeft } from "../icons";

/** Canonical first row of every routed view: title left, actions right.
 *  Page anatomy: Sidebar | PageHeader → tabs → filter bar → content. */
export default function PageHeader({
  title,
  subtitle,
  backTo,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  backTo?: { label: string; to: string };
  actions?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-surface px-6 py-3">
      <div className="min-w-0">
        {backTo && (
          <Link to={backTo.to} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
            <FontAwesomeIcon icon={faChevronLeft} aria-hidden className="text-[10px]" />
            {backTo.label}
          </Link>
        )}
        <h1 className="truncate text-lg font-semibold text-gray-900">{title}</h1>
        {subtitle && <p className="truncate text-sm text-gray-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
