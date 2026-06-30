import { useEffect, useState } from "react";
import Board from "./components/Board";
import ImportButton from "./components/ImportButton";
import ItemDrawer from "./components/ItemDrawer";
import NewItemBar from "./components/NewItemBar";
import StoryBoardModal from "./components/StoryBoardModal";
import Toolbar, { type BoardFilters } from "./components/Toolbar";
import AdminView from "./components/admin/AdminView";
import { getTeamMembers, listItems } from "./api/client";

export default function App() {
  const [view, setView] = useState<"board" | "admin">("board");
  const [openItemId, setOpenItemId] = useState<number | null>(null);
  const [openStoriesFeatureId, setOpenStoriesFeatureId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filters, setFilters] = useState<BoardFilters>({ kinds: ["feature", "risk"] });
  const [iterations, setIterations] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [assigneeOptions, setAssigneeOptions] = useState<string[]>([]);

  useEffect(() => {
    void listItems().then((items) => {
      setIterations([...new Set(items.map((i) => i.iteration).filter(Boolean) as string[])].sort());
      setTeams([...new Set(items.map((i) => i.leading_team).filter(Boolean) as string[])].sort());
    });
    void getTeamMembers().then((ms) => setAssigneeOptions(ms.map((m) => m.name)));
  }, [refreshKey]);

  const handleChanged = () => {
    setOpenItemId(null);
    setRefreshKey((k) => k + 1);
  };

  const navButton = (target: "board" | "admin", label: string) => (
    <button
      onClick={() => setView(target)}
      className={`rounded px-3 py-1 text-sm font-medium ${
        view === target ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-gray-900">SAFe Kanban</h1>
          <nav className="flex gap-1">
            {navButton("board", "Board")}
            {navButton("admin", "Admin")}
          </nav>
        </div>
        {view === "board" && (
          <div className="flex items-center gap-3">
            <ImportButton onImported={handleChanged} />
            <NewItemBar onCreated={handleChanged} />
          </div>
        )}
      </header>

      {view === "board" ? (
        <>
          <Toolbar filters={filters} onChange={setFilters} iterations={iterations} teams={teams} />
          <Board
            key={refreshKey}
            filters={filters}
            onOpenCard={setOpenItemId}
            onOpenStories={setOpenStoriesFeatureId}
          />
        </>
      ) : (
        <AdminView onChanged={handleChanged} />
      )}

      {openStoriesFeatureId != null && (
        <StoryBoardModal
          featureId={openStoriesFeatureId}
          refreshSignal={refreshKey}
          onClose={() => setOpenStoriesFeatureId(null)}
          onOpenItem={setOpenItemId}
          onChanged={handleChanged}
        />
      )}
      {openItemId != null && (
        <ItemDrawer
          itemId={openItemId}
          assigneeOptions={assigneeOptions}
          onClose={() => setOpenItemId(null)}
          onChanged={handleChanged}
        />
      )}
    </div>
  );
}
