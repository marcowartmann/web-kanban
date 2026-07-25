import type { Product } from "../types";

export default function ProductDetail({
  product,
  onBack,
}: {
  product: Product;
  onBack: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 py-6">
      <button onClick={onBack} className="self-start text-sm text-blue-600">
        ← Back
      </button>
      <h1 className="mt-2 text-lg font-semibold text-gray-900">{product.name}</h1>
    </div>
  );
}
