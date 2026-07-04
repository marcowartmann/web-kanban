/** Shared design-language tokens: the canonical class strings for controls,
 *  inputs, and modal shells, so every surface stays visually consistent.
 *
 *  Compose only with non-conflicting utilities (w-*, max-w-*, max-h-*,
 *  flex-1, ml-auto, z-*, cursor-*, overflow-*). Never append a utility that
 *  conflicts with one inside the token (e.g. a second px-*) — Tailwind's
 *  stylesheet order, not class order, would decide the winner. Deliberate
 *  size variants keep a full literal string at the call site instead. */

export const btnPrimary =
  "rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-xs transition hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-200 disabled:opacity-60";

export const btnSecondary =
  "rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-xs transition hover:bg-gray-50 focus:outline-hidden focus:ring-2 focus:ring-blue-100";

export const btnGhost =
  "rounded-lg px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100 focus:outline-hidden focus:ring-2 focus:ring-blue-100";

export const btnDanger =
  "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white shadow-xs transition hover:bg-red-700 focus:outline-hidden focus:ring-2 focus:ring-red-200 disabled:opacity-60";

export const btnDangerGhost =
  "rounded-lg px-3 py-1.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 focus:outline-hidden focus:ring-2 focus:ring-red-100";

export const inputClass =
  "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 transition placeholder:text-gray-400 focus:border-blue-400 focus:outline-hidden focus:ring-2 focus:ring-blue-100";

export const captionClass = "text-[11px] font-medium uppercase tracking-wide text-gray-400";

export const overlayClass =
  "fixed inset-0 flex items-center justify-center bg-black/40 p-6 backdrop-blur-xs";

export const modalPanelClass = "w-full rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-black/5";

export const popoverClass =
  "rounded-xl border border-gray-200 bg-white p-1 shadow-lg ring-1 ring-black/5";

export const closeButtonClass =
  "rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700";
