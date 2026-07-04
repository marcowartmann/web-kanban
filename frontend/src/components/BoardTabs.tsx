import type { Board } from "../types";

export default function BoardTabs({
  boards,
  activeId,
  onSelect,
}: {
  boards: Board[];
  activeId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-gray-200 bg-surface px-6">
      {boards.map((board) => (
        <button
          key={board.id}
          onClick={() => onSelect(board.id)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            board.id === activeId
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          {board.name}
        </button>
      ))}
    </div>
  );
}
