import ImportButton from "../ImportButton";

export default function ImportSection({ onImported }: { onImported: () => void }) {
  return (
    <section>
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Import CSV</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Replace all board data from a CSV file. A snapshot is saved automatically before the import.
        </p>
      </header>
      <ImportButton onImported={() => onImported()} />
    </section>
  );
}
