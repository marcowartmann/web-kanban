import { faMoon, faSun } from "@fortawesome/pro-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
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
      className={`${btnGhost} text-base leading-none text-gray-500`}
    >
      {/* FA icon: sized by font-size (text-base = 1em), colored via currentColor. */}
      <FontAwesomeIcon icon={isDark ? faSun : faMoon} />
    </button>
  );
}
