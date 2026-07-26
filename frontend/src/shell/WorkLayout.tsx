import { useEffect, useMemo, useState } from "react";
import { Outlet, useOutletContext } from "react-router";
import ItemDrawer from "../components/ItemDrawer";
import StoryBoardModal from "../components/StoryBoardModal";
import type { BoardFilters } from "../components/Toolbar";
import { useAuth } from "../auth/AuthContext";
import { useBoard } from "../hooks/useBoard";
import { getContainers, getDepartments, getObjectiveLinkedFeatures, getPersonOptions, getTeams } from "../api/client";
import { ObjectiveLinksContext } from "../objectives/links";
import { statusOptionsByKind } from "../lib/boardLanes";
import type { AuthUser, Container, Department, PersonOption, Team } from "../types";

export type WorkContext = ReturnType<typeof useBoard> & {
  user: AuthUser;
  people: PersonOption[];
  teamOptions: Team[];
  containers: Container[];
  departments: Department[];
  teams: string[]; // distinct leading teams from items
  assignees: string[];
  containerNames: string[];
  departmentNames: string[];
  refreshKey: number;
  openItem: (id: number) => void;
  onChanged: () => void;
  onOpenStories: (featureId: number) => void;
  activeBoardId: number | null;
  setActiveBoardId: (id: number | null) => void;
  objectivesTab: boolean;
  setObjectivesTab: (v: boolean) => void;
  filters: BoardFilters;
  setFilters: React.Dispatch<React.SetStateAction<BoardFilters>>;
};

export default function WorkLayout() {
  const { user } = useAuth();
  const board = useBoard();
  const { boards, items, reload } = board;

  // Panels are docked right-to-left: the rightmost is the primary item, and a
  // related item docks beside it as [story, feature] (feature always on the right).
  const [panels, setPanels] = useState<number[]>([]);
  const [openStoriesFeatureId, setOpenStoriesFeatureId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [teamOptions, setTeamOptions] = useState<Team[]>([]);
  const [containers, setContainers] = useState<Container[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [objectiveLinks, setObjectiveLinks] = useState<Set<number>>(new Set());

  // Board-local UI state lives here (not in BoardPage) so it survives
  // switching between work routes (Board/Planning/Timeline/Ranking), which
  // all mount under this always-mounted layout.
  const [activeBoardId, setActiveBoardId] = useState<number | null>(null);
  const [objectivesTab, setObjectivesTab] = useState(false);
  const [filters, setFilters] = useState<BoardFilters>({});

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

  useEffect(() => {
    void getPersonOptions().then(setPeople);
  }, [refreshKey]);

  useEffect(() => {
    void getTeams().then(setTeamOptions);
    void getContainers().then(setContainers);
    void getDepartments().then(setDepartments);
    void getObjectiveLinkedFeatures().then((ids) => setObjectiveLinks(new Set(ids)));
  }, [refreshKey]);

  useEffect(() => {
    if (activeBoardId == null && boards.length) setActiveBoardId(boards[0].id);
  }, [boards, activeBoardId]);

  const statusOptions = useMemo(() => statusOptionsByKind(boards), [boards]);

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
  const departmentNames = useMemo(
    () => [...new Set(departments.map((d) => d.name))].sort(),
    [departments],
  );

  const handleChanged = () => {
    closePanels();
    setRefreshKey((k) => k + 1);
    void reload();
  };

  const ctx: WorkContext = {
    ...board,
    user,
    people,
    teamOptions,
    containers,
    departments,
    teams,
    assignees,
    containerNames,
    departmentNames,
    refreshKey,
    openItem,
    onChanged: handleChanged,
    onOpenStories: setOpenStoriesFeatureId,
    activeBoardId,
    setActiveBoardId,
    objectivesTab,
    setObjectivesTab,
    filters,
    setFilters,
  };

  return (
    <ObjectiveLinksContext.Provider value={objectiveLinks}>
      <Outlet context={ctx} />
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
        <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={closePanels}>
          {panels.map((id) => (
            <ItemDrawer
              key={id}
              itemId={id}
              compact={panels.length > 1}
              people={people}
              statusOptionsByKind={statusOptions}
              planningIntervalOptions={board.planningIntervals}
              leadingTeamOptions={teamOptions.map((t) => t.name)}
              containers={containers}
              departments={departments}
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
    </ObjectiveLinksContext.Provider>
  );
}

export function useWork(): WorkContext {
  return useOutletContext<WorkContext>();
}
