import TeamMembersSection from "./TeamMembersSection";
import TeamsSection from "./TeamsSection";

export default function AdminView({ onChanged }: { onChanged: () => void }) {
  return (
    <div className="grid gap-4 p-6 md:grid-cols-2">
      <TeamsSection onChanged={onChanged} />
      <TeamMembersSection onChanged={onChanged} />
    </div>
  );
}
