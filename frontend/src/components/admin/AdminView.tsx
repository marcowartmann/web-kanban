import { useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import AuditLogSection from "./AuditLogSection";
import CapacitySection from "./CapacitySection";
import ContainersSection from "./ContainersSection";
import ImportSection from "./ImportSection";
import PlanningIntervalsSection from "./PlanningIntervalsSection";
import SnapshotsSection from "./SnapshotsSection";
import TeamsSection from "./TeamsSection";
import UsersSection from "./UsersSection";

type AdminSection = "users" | "teams" | "intervals" | "containers" | "import" | "snapshots" | "audit";

const SECTIONS: { id: AdminSection; label: string; icon: string }[] = [
  { id: "users", label: "Users", icon: "👤" },
  { id: "teams", label: "Teams & Capacity", icon: "👥" },
  { id: "intervals", label: "Planning Intervals", icon: "🗓️" },
  { id: "containers", label: "Containers", icon: "📦" },
  { id: "import", label: "Import CSV", icon: "📥" },
  { id: "snapshots", label: "Snapshots", icon: "🗂️" },
  { id: "audit", label: "Audit Log", icon: "📜" },
];

export default function AdminView({
  onChanged,
  planningIntervals = [],
}: {
  onChanged: () => void;
  planningIntervals?: string[];
}) {
  const { user } = useAuth();
  const [section, setSection] = useState<AdminSection>("users");
  // Bumped on team changes so the capacity grid remounts with fresh teams/people.
  const [capacityKey, setCapacityKey] = useState(0);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Administration</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Manage teams, people, planning intervals, and capacity.
        </p>
      </header>
      <div className="flex items-start gap-6">
        <nav aria-label="Admin sections" className="sticky top-8 w-52 shrink-0">
          <ul className="flex flex-col gap-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => setSection(s.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-100 ${
                    section === s.id
                      ? "bg-blue-50 font-medium text-blue-700"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  <span aria-hidden>{s.icon}</span>
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        {/* Only the active section mounts, so each visit refetches its data. */}
        <div className="min-w-0 flex-1">
          {section === "users" && <UsersSection currentUserId={user.id} />}
          {section === "teams" && (
            <div className="flex flex-col gap-4">
              <TeamsSection
                onChanged={() => {
                  onChanged();
                  setCapacityKey((k) => k + 1);
                }}
              />
              <CapacitySection key={capacityKey} planningIntervals={planningIntervals} />
            </div>
          )}
          {section === "intervals" && <PlanningIntervalsSection onChanged={onChanged} />}
          {section === "containers" && (
            <ContainersSection planningIntervals={planningIntervals} />
          )}
          {section === "import" && <ImportSection onImported={onChanged} />}
          {section === "snapshots" && <SnapshotsSection onChanged={onChanged} />}
          {section === "audit" && <AuditLogSection />}
        </div>
      </div>
    </div>
  );
}
