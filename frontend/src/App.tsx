import { useEffect, useMemo, useState } from "react";
import BoardTabs from "./components/BoardTabs";
import BoardView from "./components/BoardView";
import ImportButton from "./components/ImportButton";
import ItemDrawer from "./components/ItemDrawer";
import NewItemBar from "./components/NewItemBar";
import StoryBoardModal from "./components/StoryBoardModal";
import Toolbar, { type BoardFilters } from "./components/Toolbar";
import AdminView from "./components/admin/AdminView";
import { useBoard } from "./hooks/useBoard";
import { getTeamMembers } from "./api/client";

export default function App() {
  const { boards, items, loading, error, reload } = useBoard();
  const [view, setView] = useState<"board" | "admin">("board");
  const [activeBoardId, setActiveBoardId] = useState<number | null>(null);
  const [openItemId, setOpenItemId] = useState<number | null>(null);
  const [openStoriesFeatureId, setOpenStoriesFeatureId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filters, setFilters] = useState<BoardFilters>({});
  const [assigneeOptions, setAssigneeOptions] = useState<string[]>([]);

  useEffect(() => {
    if (activeBoardId == null && boards.length) setActiveBoardId(boards[0].id);
  }, [boards, activeBoardId]);

  useEffect(() => {
    void getTeamMembers().then((ms) => setAssigneeOptions(ms.map((m) => m.name)));
  }, [refreshKey]);

  const activeBoard = boards.find((b) => b.id === activeBoardId) ?? null;

  const iterations = useMemo(
    () => [...new Set(items.map((i) => i.iteration).filter(Boolean) as string[])].sort(),
    [items],
  );
  const teams = useMemo(
    () => [...new Set(items.map((i) => i.leading_team).filter(Boolean) as string[])].sort(),
    [items],
  );

  const selectBoard = (id: number) => {
    setActiveBoardId(id);
    setFilters((f) => ({ ...f, kinds: undefined })); // reset kind narrowing per board
  };

  const handleChanged = () => {
    setOpenItemId(null);
    setRefreshKey((k) => k + 1);
    void reload();
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

      {view === "admin" ? (
        <AdminView onChanged={handleChanged} />
      ) : loading && !activeBoard ? (
        <div className="p-8 text-gray-500">Loading board…</div>
      ) : error ? (
        <div className="p-8 text-red-600">{error}</div>
      ) : activeBoard ? (
        <>
          <BoardTabs boards={boards} activeId={activeBoardId} onSelect={selectBoard} />
          <Toolbar
            filters={filters}
            onChange={setFilters}
            iterations={iterations}
            teams={teams}
            kindOptions={activeBoard.kinds}
          />
          <BoardView
            board={activeBoard}
            items={items}
            filters={filters}
            onOpenCard={setOpenItemId}
            onOpenStories={setOpenStoriesFeatureId}
            onChanged={handleChanged}
          />
        </>
      ) : null}

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
