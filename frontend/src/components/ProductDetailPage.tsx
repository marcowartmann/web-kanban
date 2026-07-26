import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { getProduct } from "../api/client";
import type { Product } from "../types";
import ProductDetail from "./ProductDetail";
import { SkeletonRows } from "./Skeleton";

/** Route wrapper: resolves :productId to a Product, with a not-found state. */
export default function ProductDetailPage() {
  const { productId } = useParams();
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = Number(productId);

  useEffect(() => {
    if (!Number.isInteger(id)) {
      setError("Product not found.");
      return;
    }
    getProduct(id)
      .then(setProduct)
      .catch(() => setError("Product not found."));
  }, [id]);

  if (error) {
    return (
      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        <Link to="/products" className="text-sm text-blue-600 hover:underline">
          ← Back to products
        </Link>
      </div>
    );
  }
  if (!product)
    return (
      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <SkeletonRows rows={6} />
      </div>
    );
  return <ProductDetail product={product} />;
}
