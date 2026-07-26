import type { ReactNode } from "react";

/** View/tab-level empty state. Keep wordings at the call site. */
export default function EmptyState({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="py-12 text-center text-sm text-gray-400">
      <div>{children}</div>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}
