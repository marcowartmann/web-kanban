import Board from "./components/Board";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">SAFe Kanban</h1>
      </header>
      <Board onOpenCard={() => {}} />
    </div>
  );
}
