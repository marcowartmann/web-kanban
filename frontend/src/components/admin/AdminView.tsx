import { useAuth } from "../../auth/AuthContext";
import AuditLogSection from "./AuditLogSection";
import CapacitySection from "./CapacitySection";
import PlanningIntervalsSection from "./PlanningIntervalsSection";
import TeamMembersSection from "./TeamMembersSection";
import TeamsSection from "./TeamsSection";
import UsersSection from "./UsersSection";

export default function AdminView({
  onChanged,
  planningIntervals = [],
}: {
  onChanged: () => void;
  planningIntervals?: string[];
}) {
  const { user } = useAuth();
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Administration</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Manage teams, members, planning intervals, and capacity.
        </p>
      </header>
      <div className="grid items-start gap-4 md:grid-cols-2 lg:grid-cols-3">
        <TeamsSection onChanged={onChanged} />
        <TeamMembersSection onChanged={onChanged} />
        <PlanningIntervalsSection onChanged={onChanged} />
      </div>
      <div className="mt-4">
        <UsersSection currentUserId={user.id} />
      </div>
      <div className="mt-4">
        <AuditLogSection />
      </div>
      <div className="mt-4">
        <CapacitySection planningIntervals={planningIntervals} />
      </div>
    </div>
  );
}
