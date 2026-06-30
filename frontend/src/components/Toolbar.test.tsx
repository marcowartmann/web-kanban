import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import Toolbar from "./Toolbar";

it("emits the search query on type", async () => {
  const onChange = vi.fn();
  render(<Toolbar filters={{}} onChange={onChange} iterations={["PI1-Q3"]} teams={["Network"]} kindOptions={["feature", "story", "risk"]} />);
  await userEvent.type(screen.getByPlaceholderText(/search/i), "teton");
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ q: "teton" }));
});

it("emits an iteration filter on select", async () => {
  const onChange = vi.fn();
  render(<Toolbar filters={{}} onChange={onChange} iterations={["PI1-Q3"]} teams={["Network"]} kindOptions={["feature", "story", "risk"]} />);
  await userEvent.selectOptions(screen.getByLabelText(/iteration/i), "PI1-Q3");
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ iteration: "PI1-Q3" }));
});

it("adds a kind when its checkbox is ticked", async () => {
  const onChange = vi.fn();
  render(
    <Toolbar
      filters={{ kinds: ["feature", "risk"] }}
      onChange={onChange}
      iterations={["PI1-Q3"]}
      teams={["Network"]}
      kindOptions={["feature", "story", "risk"]}
    />,
  );
  await userEvent.click(screen.getByRole("checkbox", { name: /story/i }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ kinds: ["feature", "risk", "story"] }),
  );
});

it("removes a kind when its checkbox is unticked", async () => {
  const onChange = vi.fn();
  render(
    <Toolbar
      filters={{ kinds: ["feature", "risk"] }}
      onChange={onChange}
      iterations={["PI1-Q3"]}
      teams={["Network"]}
      kindOptions={["feature", "story", "risk"]}
    />,
  );
  await userEvent.click(screen.getByRole("checkbox", { name: /risk/i }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ kinds: ["feature"] }),
  );
});
