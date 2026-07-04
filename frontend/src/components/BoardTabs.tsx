import type { Board } from "../types";

export default function BoardTabs({
  boards,
  activeId,
  onSelect,
  objectivesActive = false,
  onSelectObjectives,
}: {
  boards: Board[];
  activeId: number | null;
  onSelect: (id: number) => void;
  objectivesActive?: boolean;
  onSelectObjectives?: () => void;
}) {
  const tab = (active: boolean) =>
    `-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
      active ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-800"
    }`;
  return (
    <div className="flex gap-1 border-b border-gray-200 bg-surface px-6">
      {boards.map((board) => (
        <button
          key={board.id}
          onClick={() => onSelect(board.id)}
          className={tab(!objectivesActive && board.id === activeId)}
        >
          {board.name}
        </button>
      ))}
      {onSelectObjectives && (
        <button onClick={onSelectObjectives} className={tab(objectivesActive)}>
          PI Objectives
        </button>
      )}
    </div>
  );
}
