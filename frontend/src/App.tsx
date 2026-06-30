import { useEffect, useState } from "react";
import Board from "./components/Board";
import ImportButton from "./components/ImportButton";
import ItemDrawer from "./components/ItemDrawer";
import NewItemBar from "./components/NewItemBar";
import Toolbar, { type BoardFilters } from "./components/Toolbar";
import { listItems } from "./api/client";

export default function App() {
  const [openItemId, setOpenItemId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filters, setFilters] = useState<BoardFilters>({});
  const [iterations, setIterations] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[]>([]);

  useEffect(() => {
    void listItems().then((items) => {
      setIterations([...new Set(items.map((i) => i.iteration).filter(Boolean) as string[])].sort());
      setTeams([...new Set(items.map((i) => i.leading_team).filter(Boolean) as string[])].sort());
    });
  }, [refreshKey]);

  const handleChanged = () => {
    setOpenItemId(null);
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">SAFe Kanban</h1>
        <div className="flex items-center gap-3">
          <ImportButton onImported={handleChanged} />
          <NewItemBar onCreated={handleChanged} />
        </div>
      </header>
      <Toolbar filters={filters} onChange={setFilters} iterations={iterations} teams={teams} />
      <Board key={refreshKey} filters={filters} onOpenCard={setOpenItemId} />
      {openItemId != null && (
        <ItemDrawer
          itemId={openItemId}
          onClose={() => setOpenItemId(null)}
          onChanged={handleChanged}
        />
      )}
    </div>
  );
}
