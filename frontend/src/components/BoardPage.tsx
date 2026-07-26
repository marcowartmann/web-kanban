import { useState } from "react";
import BoardTabs from "./BoardTabs";
import BoardView from "./BoardView";
import PIObjectivesBoard, { canAddObjective } from "./PIObjectivesBoard";
import NewItemBar from "./NewItemBar";
import { SkeletonBoard } from "./Skeleton";
import Toolbar from "./Toolbar";
import { btnPrimary, btnSecondary } from "./ui";
import PageHeader from "../shell/PageHeader";
import { useWork } from "../shell/WorkLayout";

export default function BoardPage() {
  const {
    boards,
    items,
    links,
    planningIntervals,
    loading,
    error,
    user,
    teams,
    assignees,
    containerNames,
    departmentNames,
    containers,
    openItem,
    onChanged,
    onOpenStories,
    teamOptions,
    activeBoardId,
    setActiveBoardId,
    objectivesTab,
    setObjectivesTab,
    filters,
    setFilters,
  } = useWork();
  const isAdmin = user.role === "admin";

  const [objTeam, setObjTeam] = useState<string | null>(null);
  const [addObjectiveSignal, setAddObjectiveSignal] = useState(0);
  const [laneEditing, setLaneEditing] = useState(false);

  const activeBoard = boards.find((b) => b.id === activeBoardId) ?? null;

  const selectBoard = (id: number) => {
    setObjectivesTab(false);
    setActiveBoardId(id);
    setFilters((f) => ({ ...f, kinds: undefined })); // reset kind narrowing per board
  };

  const objTeamObj = objTeam ? teamOptions.find((t) => t.name === objTeam) ?? null : null;
  const boardActions = objectivesTab ? (
    <button
      onClick={() => setAddObjectiveSignal((s) => s + 1)}
      disabled={!canAddObjective(user, objTeamObj)}
      title={canAddObjective(user, objTeamObj) ? undefined : "Select your team first"}
      className={btnPrimary}
    >
      + New objective
    </button>
  ) : (
    <>
      <NewItemBar onCreated={onChanged} />
      {isAdmin && activeBoard && (
        <button onClick={() => setLaneEditing((v) => !v)} className={btnSecondary}>
          {laneEditing ? "Done" : "Edit lanes"}
        </button>
      )}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Board" actions={boardActions} />
      {loading && !activeBoard ? (
        <SkeletonBoard />
      ) : error ? (
        <div className="p-8 text-red-600">{error}</div>
      ) : activeBoard ? (
        <>
          <BoardTabs
            boards={boards}
            activeId={objectivesTab ? null : activeBoardId}
            onSelect={selectBoard}
            objectivesActive={objectivesTab}
            onSelectObjectives={() => setObjectivesTab(true)}
          />
          {objectivesTab ? (
            <PIObjectivesBoard
              teams={teamOptions}
              planningIntervals={planningIntervals}
              user={user}
              features={items.filter((i) => i.kind === "feature")}
              onChanged={onChanged}
              team={objTeam}
              onTeamChange={setObjTeam}
              addSignal={addObjectiveSignal}
            />
          ) : (
            <>
              <Toolbar
                filters={filters}
                onChange={setFilters}
                planningIntervals={planningIntervals}
                teams={teams}
                assignees={assignees}
                containerNames={containerNames}
                departmentNames={departmentNames}
                kindOptions={activeBoard.kinds}
              />
              <BoardView
                board={activeBoard}
                items={items}
                links={links}
                filters={filters}
                containers={containers}
                onOpenCard={openItem}
                onOpenStories={onOpenStories}
                onChanged={onChanged}
                canEditLanes={isAdmin}
                laneEditing={laneEditing}
              />
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
