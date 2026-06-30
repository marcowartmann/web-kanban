import { useBoard } from "../hooks/useBoard";
import Column from "./Column";

export default function Board({
  onOpenCard,
}: {
  onOpenCard: (id: number) => void;
}) {
  const { columns, loading, error } = useBoard();

  if (loading) return <div className="p-8 text-gray-500">Loading board…</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;

  return (
    <div className="flex gap-4 overflow-x-auto p-6">
      {columns.map((column) => (
        <Column key={column.status} column={column} onOpenCard={onOpenCard} />
      ))}
    </div>
  );
}
