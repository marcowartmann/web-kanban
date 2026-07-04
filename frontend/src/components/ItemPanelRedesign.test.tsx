import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as client from "../api/client";
import Avatar, { avatarColor, initialsOf } from "./Avatar";
import ItemDrawer from "./ItemDrawer";

afterEach(() => vi.restoreAllMocks());

const item = {
  id: 5, kind: "feature", type: "Feature", title: "Panel Feature",
  status: "Analyzing", wsjf_score: null, business_value: null, time_criticality: null,
  risk_reduction: null, cost_of_delay: null, job_size: null, parent_id: null,
  position: 0, description: "the described", planning_interval: null, iteration: null,
  leading_team: null, story_points: null, tshirt_size: null, kategorie: null, art: null,
  sdi_prio: null, supporting_team: null, externer_partner: null, assignee: null,
  assignee_id: null, akzeptanzkriterien: null, bo_stakeholder: null,
  definition_of_done: null, children: [], version: 1,
};

function mount(extra: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  vi.spyOn(client, "getItem").mockResolvedValue({ ...item, ...extra } as never);
  return render(
    <ItemDrawer itemId={5} onClose={() => {}} onChanged={() => {}} {...props} />,
  );
}

it("renders wide two-zone layout by default and compact grid when compact", async () => {
  const wide = mount();
  expect(await screen.findByDisplayValue("Panel Feature")).toBeInTheDocument();
  expect(screen.getByTestId("item-panel").className).toContain("w-160");
  wide.unmount();

  mount({}, { compact: true });
  expect(await screen.findByDisplayValue("Panel Feature")).toBeInTheDocument();
  expect(screen.getByTestId("item-panel").className).toContain("w-104");
});

it("saves description, acceptance criteria and definition of done", async () => {
  const update = vi.spyOn(client, "updateItem").mockResolvedValue(item as never);
  mount();
  await screen.findByDisplayValue("Panel Feature");

  const description = screen.getByLabelText("Description");
  await userEvent.clear(description);
  await userEvent.type(description, "new description");
  await userEvent.type(screen.getByLabelText("Acceptance criteria"), "criteria!");
  await userEvent.type(screen.getByLabelText("Definition of Done"), "done means done");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  expect(update).toHaveBeenCalledWith(
    5,
    expect.objectContaining({
      description: "new description",
      akzeptanzkriterien: "criteria!",
      definition_of_done: "done means done",
      version: 1,
    }),
  );
});

it("saves supporting team, t-shirt size and stakeholder from the properties rail", async () => {
  const update = vi.spyOn(client, "updateItem").mockResolvedValue(item as never);
  mount();
  await screen.findByDisplayValue("Panel Feature");

  const tshirt = screen.getByRole("combobox", { name: "T-Shirt Size" });
  await userEvent.click(tshirt);
  await userEvent.click(screen.getByRole("option", { name: "XL" }));
  await userEvent.type(screen.getByLabelText("Stakeholder"), "CTO office");
  await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

  expect(update).toHaveBeenCalledWith(
    5,
    expect.objectContaining({ tshirt_size: "XL", bo_stakeholder: "CTO office" }),
  );
});

it("Save stays disabled until something is edited", async () => {
  mount();
  await screen.findByDisplayValue("Panel Feature");
  const save = screen.getByRole("button", { name: /^save$/i });
  expect(save).toBeDisabled();
  expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();

  await userEvent.type(screen.getByLabelText("Description"), "!");
  expect(save).toBeEnabled();
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
});

it("Comments and Activity are tabs; Activity mounts only when selected", async () => {
  mount();
  await screen.findByDisplayValue("Panel Feature");

  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((t) => t.textContent)).toEqual(["Comments", "Activity"]);
  // Comments panel visible by default (unauthenticated render shows the empty state).
  expect(await screen.findByText(/no comments yet/i)).toBeVisible();

  await userEvent.click(screen.getByRole("tab", { name: "Activity" }));
  expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByText(/no comments yet/i)).not.toBeVisible();
});

it("shows an avatar beside the current assignee", async () => {
  mount(
    { assignee: "Manuela Roth", assignee_id: 24 },
    { people: [{ id: 24, display_name: "Manuela Roth", team_id: null }] },
  );
  await screen.findByDisplayValue("Panel Feature");
  expect(screen.getByTestId("avatar").textContent).toBe("MR");
});

it("avatar helpers derive stable initials and colors", () => {
  expect(initialsOf("Manuela Roth")).toBe("MR");
  expect(initialsOf("Admin")).toBe("A");
  expect(avatarColor("Manuela Roth")).toBe(avatarColor("Manuela Roth"));
  const { container } = render(<Avatar name="Manuela Roth" />);
  expect(container.textContent).toBe("MR");
});
