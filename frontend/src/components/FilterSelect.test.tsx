import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import FilterSelect from "./FilterSelect";

it("shows the value (or All) and opens the option list on click", async () => {
  render(
    <FilterSelect label="Team" value={undefined} options={["Network", "Platform"]} onChange={() => {}} />,
  );
  const trigger = screen.getByRole("button", { name: /team/i });
  expect(trigger).toHaveTextContent("All");
  await userEvent.click(trigger);
  expect(screen.getByRole("option", { name: "Network" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Platform" })).toBeInTheDocument();
});

it("emits the chosen option, and undefined when All is picked", async () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <FilterSelect label="Team" value={undefined} options={["Network"]} onChange={onChange} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /team/i }));
  await userEvent.click(screen.getByRole("option", { name: "Network" }));
  expect(onChange).toHaveBeenLastCalledWith("Network");

  rerender(<FilterSelect label="Team" value="Network" options={["Network"]} onChange={onChange} />);
  await userEvent.click(screen.getByRole("button", { name: /team/i }));
  await userEvent.click(screen.getByRole("option", { name: "All" }));
  expect(onChange).toHaveBeenLastCalledWith(undefined);
});
