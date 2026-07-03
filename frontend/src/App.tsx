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
import RankingView from "./components/RankingView";
import TimelineView from "./components/TimelineView";
import UserMenu from "./components/UserMenu";
import { useAuth } from "./auth/AuthContext";
import { useBoard } from "./hooks/useBoard";
import { getContainers, getPersonOptions, getTeams } from "./api/client";
import { statusOptionsByKind } from "./lib/boardLanes";
import type { Container, PersonOption, Team } from "./types";

type View = "board" | "admin" | "planning" | "timeline" | "ranking";

export default function App() {
  const { user, setUser } = useAuth();
  const isAdmin = user.role === "admin";
  const { boards, items, links, planningIntervals, loading, error, reload } = useBoard();
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
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [teamOptions, setTeamOptions] = useState<Team[]>([]);
  const [containers, setContainers] = useState<Container[]>([]);

  useEffect(() => {
    if (activeBoardId == null && boards.length) setActiveBoardId(boards[0].id);
  }, [boards, activeBoardId]);

  useEffect(() => {
    void getPersonOptions().then(setPeople);
  }, [refreshKey]);

  useEffect(() => {
    void getTeams().then(setTeamOptions);
    void getContainers().then(setContainers);
  }, [refreshKey]);

  const statusOptions = useMemo(() => statusOptionsByKind(boards), [boards]);

  const activeBoard = boards.find((b) => b.id === activeBoardId) ?? null;

  const teams = useMemo(
    () => [...new Set(items.map((i) => i.leading_team).filter(Boolean) as string[])].sort(),
    [items],
  );
  const assignees = useMemo(
    () => [...new Set(items.map((i) => i.assignee).filter(Boolean) as string[])].sort(),
    [items],
  );
  const containerNames = useMemo(
    () => [...new Set(containers.map((c) => c.name))].sort(),
    [containers],
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

  // Segmented control, matching the drawer's Comments|Activity tabs.
  const navButton = (target: View, label: string) => (
    <button
      onClick={() => setView(target)}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-100 ${
        view === target ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
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
          <nav className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5">
            {navButton("board", "Board")}
            {navButton("planning", "Planning")}
            {navButton("timeline", "Timeline")}
            {navButton("ranking", "Ranking")}
            {isAdmin && navButton("admin", "Admin")}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {view === "board" && (
            <>
              {isAdmin && <ImportButton onImported={handleChanged} />}
              <NewItemBar onCreated={handleChanged} />
            </>
          )}
          <UserMenu user={user} onLoggedOut={() => setUser(null)} />
        </div>
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
      ) : view === "timeline" ? (
        <TimelineView
          items={items}
          links={links}
          planningIntervals={planningIntervals}
          onOpenCard={openItem}
          onChanged={handleChanged}
        />
      ) : view === "ranking" ? (
        <RankingView
          items={items}
          planningIntervals={planningIntervals}
          teams={teams}
          containers={containers}
          user={user}
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
            containerNames={containerNames}
            kindOptions={activeBoard.kinds}
          />
          <BoardView
            board={activeBoard}
            items={items}
            links={links}
            filters={filters}
            containers={containers}
            onOpenCard={openItem}
            onOpenStories={setOpenStoriesFeatureId}
            onChanged={handleChanged}
            canEditLanes={isAdmin}
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
              compact={panels.length > 1}
              people={people}
              statusOptionsByKind={statusOptions}
              planningIntervalOptions={planningIntervals}
              leadingTeamOptions={teamOptions.map((t) => t.name)}
              containers={containers}
              teams={teamOptions}
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
