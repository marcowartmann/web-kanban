import { useState } from "react";

/** Single-line inline creator: Enter submits (non-blank), Escape cancels,
 *  blurring while empty cancels. Replaces window.prompt() flows. */
export default function InlineAddInput({
  placeholder,
  ariaLabel,
  onSubmit,
  onCancel,
  className = "",
}: {
  placeholder: string;
  ariaLabel: string;
  onSubmit: (title: string) => void | Promise<void>;
  onCancel: () => void;
  className?: string;
}) {
  const [value, setValue] = useState("");
  return (
    <input
      autoFocus
      value={value}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && value.trim()) void onSubmit(value.trim());
        if (e.key === "Escape") onCancel();
      }}
      onBlur={() => {
        if (!value.trim()) onCancel();
      }}
      className={`w-full rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm text-gray-900 shadow-sm transition placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 ${className}`}
    />
  );
}
