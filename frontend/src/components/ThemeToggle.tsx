import { useTheme } from "../theme/ThemeContext";
import { btnGhost } from "./ui";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={`${btnGhost} text-lg leading-none`}
    >
      {isDark ? "☀️" : "🌙"}
    </button>
  );
}
