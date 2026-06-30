import { useState } from "react";
import Board from "./components/Board";
import ItemDrawer from "./components/ItemDrawer";

export default function App() {
  const [openItemId, setOpenItemId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleChanged = () => {
    setOpenItemId(null);
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">SAFe Kanban</h1>
      </header>
      <Board key={refreshKey} onOpenCard={setOpenItemId} />
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
