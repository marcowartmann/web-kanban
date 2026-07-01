import { useEffect, useMemo, useState } from "react";
import BoardTabs from "./components/BoardTabs";
import BoardView from "./components/BoardView";
import ImportButton from "./components/ImportButton";
import ItemDrawer from "./components/ItemDrawer";
import NewItemBar from "./components/NewItemBar";
import StoryBoardModal from "./components/StoryBoardModal";
import Toolbar, { type BoardFilters } from "./components/Toolbar";
import AdminView from "./components/admin/AdminView";
import PlanningView from "./components/PlanningView";
import { useBoard } from "./hooks/useBoard";
import { getTeamMembers } from "./api/client";

type View = "board" | "admin" | "planning";

export default function App() {
  const { boards, items, links, loading, error, reload } = useBoard();
  const [view, setView] = useState<View>("board");
  const [activeBoardId, setActiveBoardId] = useState<number | null>(null);
  // Panels are docked right-to-left: the rightmost is the primary item, and a
  // related item docks beside it as [story, feature] (feature always on the right).
  const [panels, setPanels] = useState<number[]>([]);
  const [openStoriesFeatureId, setOpenStoriesFeatureId] = useState<number | null>(null);

  const openItem = (id: number) => setPanels([id]);
  // A child story docks to the LEFT of the feature (the rightmost panel).
  const openChild = (storyId: number) =>
    setPanels((p) => {
      const feature = p[p.length - 1];
      return feature != null ? [storyId, feature] : [storyId];
    });
  // A parent feature docks to the RIGHT; the story shifts to the left.
  const openParent = (featureId: number) =>
    setPanels((p) => {
      const story = p[0];
      return story != null ? [story, featureId] : [featureId];
    });
  // A linked item docks to the left of the current stack (dependency navigation).
  const openItemDocked = (id: number) =>
    setPanels((p) => (p.includes(id) ? p : [id, ...p]));
  const closePanel = (id: number) => setPanels((p) => p.filter((x) => x !== id));
  const closePanels = () => setPanels([]);
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

  const planningIntervals = useMemo(
    () => [...new Set(items.map((i) => i.planning_interval).filter(Boolean) as string[])].sort(),
    [items],
  );
  const teams = useMemo(
    () => [...new Set(items.map((i) => i.leading_team).filter(Boolean) as string[])].sort(),
    [items],
  );
  const assignees = useMemo(
    () => [...new Set(items.map((i) => i.assignee).filter(Boolean) as string[])].sort(),
    [items],
  );

  const selectBoard = (id: number) => {
    setActiveBoardId(id);
    setFilters((f) => ({ ...f, kinds: undefined })); // reset kind narrowing per board
  };

  const handleChanged = () => {
    closePanels();
    setRefreshKey((k) => k + 1);
    void reload();
  };

  const navButton = (target: View, label: string) => (
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
            {navButton("planning", "Planning")}
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
        <AdminView onChanged={handleChanged} planningIntervals={planningIntervals} />
      ) : view === "planning" ? (
        <PlanningView
          items={items}
          links={links}
          planningIntervals={planningIntervals}
          onOpenCard={openItem}
          onChanged={handleChanged}
        />
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
            planningIntervals={planningIntervals}
            teams={teams}
            assignees={assignees}
            kindOptions={activeBoard.kinds}
          />
          <BoardView
            board={activeBoard}
            items={items}
            links={links}
            filters={filters}
            onOpenCard={openItem}
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
          onOpenItem={openItem}
          onChanged={handleChanged}
        />
      )}
      {panels.length > 0 && (
        <div
          className="fixed inset-0 z-30 flex justify-end bg-black/30"
          onClick={closePanels}
        >
          {panels.map((id) => (
            <ItemDrawer
              key={id}
              itemId={id}
              assigneeOptions={assigneeOptions}
              openIds={panels}
              onClose={() => closePanel(id)}
              onChanged={handleChanged}
              onOpenParent={openParent}
              onOpenChild={openChild}
              onOpenItem={openItemDocked}
              onLinksChanged={reload}
            />
          ))}
        </div>
      )}
    </div>
  );
}
