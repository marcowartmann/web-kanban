import CapacitySection from "./CapacitySection";
import TeamMembersSection from "./TeamMembersSection";
import TeamsSection from "./TeamsSection";

export default function AdminView({
  onChanged,
  planningIntervals = [],
}: {
  onChanged: () => void;
  planningIntervals?: string[];
}) {
  return (
    <div className="space-y-4 p-6">
      <div className="grid gap-4 md:grid-cols-2">
        <TeamsSection onChanged={onChanged} />
        <TeamMembersSection onChanged={onChanged} />
      </div>
      <CapacitySection planningIntervals={planningIntervals} />
    </div>
  );
}
