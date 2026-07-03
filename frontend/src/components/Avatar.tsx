const PALETTE = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-cyan-600",
  "bg-orange-500",
  "bg-teal-500",
];

/** Deterministic background class for a display name. */
export function avatarColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** Initials avatar with a stable per-name color. Decorative (aria-hidden) —
 *  always pair it with the person's name in text. */
export default function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const dims = size === "sm" ? "h-5 w-5 text-[9px]" : "h-6 w-6 text-[10px]";
  return (
    <span
      aria-hidden
      data-testid="avatar"
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white ${dims} ${avatarColor(name)}`}
    >
      {initialsOf(name)}
    </span>
  );
}
