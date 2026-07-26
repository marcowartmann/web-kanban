/** Loading placeholders. Gray-ramp colors are dark-remapped; motion-safe
 *  respects prefers-reduced-motion. Containers carry aria-label="Loading". */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`motion-safe:animate-pulse rounded bg-gray-100 ${className}`} />;
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-label="Loading" role="status" className="flex flex-col gap-2 py-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} data-testid="skeleton-row">
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <div aria-label="Loading" role="status" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}

export function SkeletonBoard({ columns = 4 }: { columns?: number }) {
  return (
    <div aria-label="Loading" role="status" className="flex gap-4 px-6 pt-4">
      {Array.from({ length: columns }, (_, i) => (
        <div key={i} className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-gray-100 p-3">
          <Skeleton className="h-5 w-24 bg-gray-200" />
          <Skeleton className="h-20 bg-gray-200" />
          <Skeleton className="h-20 bg-gray-200" />
        </div>
      ))}
    </div>
  );
}
