import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../../api/client";
import ContainersSection from "./ContainersSection";

afterEach(() => vi.restoreAllMocks());

const TEAMS = [
  { id: 1, name: "Network" },
  { id: 2, name: "Cloud" },
];

const CONTAINERS = [
  { id: 1, name: "Operations", planning_interval: "PI1-Q3", team_id: 1 },
  { id: 2, name: "Strategic Items", planning_interval: "PI1-Q3", team_id: 2 },
  { id: 3, name: "Later Ops", planning_interval: "PI2-Q4", team_id: 1 },
];

function mocks() {
  vi.spyOn(client, "getContainers").mockResolvedValue(CONTAINERS);
  vi.spyOn(client, "getTeams").mockResolvedValue(TEAMS);
}

it("shows the selected PI's containers grouped by team; pills switch scope", async () => {
  mocks();
  render(<ContainersSection planningIntervals={["PI1-Q3", "PI2-Q4"]} />);
  expect(await screen.findByText("Operations")).toBeInTheDocument();
  expect(screen.getByText("Strategic Items")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Network" })).toBeInTheDocument(); // team subheading
  expect(screen.queryByText("Later Ops")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "PI2-Q4" }));
  expect(screen.getByText("Later Ops")).toBeInTheDocument();
  expect(screen.queryByText("Operations")).toBeNull();
});

it("team filter narrows the list", async () => {
  mocks();
  render(<ContainersSection planningIntervals={["PI1-Q3"]} />);
  await screen.findByText("Operations");

  fireEvent.click(screen.getByRole("button", { name: /team all/i }));
  // The add-row's native <option>s share the role — scope to the popover.
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Cloud" }));
  expect(screen.getByText("Strategic Items")).toBeInTheDocument();
  expect(screen.queryByText("Operations")).toBeNull();
});

it("adds a container in the selected PI and team", async () => {
  mocks();
  const create = vi.spyOn(client, "createContainer").mockResolvedValue({
    id: 9, name: "Operational Stability", planning_interval: "PI1-Q3", team_id: 1,
  });
  render(<ContainersSection planningIntervals={["PI1-Q3"]} />);
  await screen.findByText("Operations");

  fireEvent.change(screen.getByLabelText("Team for new container"), { target: { value: "1" } });
  fireEvent.change(screen.getByPlaceholderText(/new container name/i), {
    target: { value: "Operational Stability" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith({
      name: "Operational Stability",
      planning_interval: "PI1-Q3",
      team_id: 1,
    }),
  );
});

it("delete conflict opens the confirm dialog; Delete anyway forces", async () => {
  mocks();
  const del = vi
    .spyOn(client, "deleteContainer")
    .mockRejectedValueOnce(new client.ConflictError("Container 'Operations' is used by 2 items"))
    .mockResolvedValueOnce(undefined);
  render(<ContainersSection planningIntervals={["PI1-Q3"]} />);
  await screen.findByText("Operations");

  fireEvent.click(screen.getByRole("button", { name: "remove container 1" }));
  const dialog = await screen.findByRole("alertdialog", { name: "Delete container?" });
  expect(dialog).toHaveTextContent("used by 2 items");
  fireEvent.click(screen.getByRole("button", { name: "Delete anyway" }));
  await waitFor(() => expect(del).toHaveBeenLastCalledWith(1, true));
});
