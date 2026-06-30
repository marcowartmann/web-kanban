export default function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string | number | null;
  onChange: (value: string) => void;
  type?: "text" | "number";
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
      />
    </label>
  );
}
