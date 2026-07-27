import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { getProduct } from "../api/client";
import { faChevronLeft } from "../icons";
import type { Product } from "../types";
import Banner from "./Banner";
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
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <div className="mb-4">
          <Banner tone="error">{error}</Banner>
        </div>
        <Link to="/products" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
          <FontAwesomeIcon icon={faChevronLeft} aria-hidden className="text-[10px]" />
          Back to products
        </Link>
      </div>
    );
  }
  if (!product)
    return (
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <SkeletonRows rows={6} />
      </div>
    );
  return <ProductDetail product={product} />;
}
