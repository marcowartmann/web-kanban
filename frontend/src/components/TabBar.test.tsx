import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TabBar from "./TabBar";

describe("TabBar", () => {
  it("renders tabs with the active underline and selects on click", async () => {
    const onSelect = vi.fn();
    render(
      <TabBar
        active="b"
        onSelect={onSelect}
        tabs={[
          { key: "a", label: "Services" },
          { key: "b", label: "Systems" },
        ]}
      />,
    );
    expect(screen.getByRole("tab", { name: "Systems" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "Services" }));
    expect(onSelect).toHaveBeenCalledWith("a");
  });
});
