import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product, Stream } from "../types";
import RoadmapView from "./RoadmapView";

const products: Product[] = [
  { id: 1, name: "Network", description: null, art_id: 1, art_name: "Platform ART",
    team_id: null, team_name: null, service_count: 0 },
];

const streams: Stream[] = [
  {
    id: 1,
    name: "Campus",
    product_id: 1,
    position: 0,
    items: [
      {
        id: 9,
        title: "Wi-Fi 7 rollout",
        description: null,
        stream_id: 1,
        status: "committed",
        start_date: "2026-01-01",
        end_date: "2026-06-30",
        features: [],
      },
    ],
  },
  { id: 2, name: "Backbone", product_id: 1, position: 1, items: [] },
];

vi.mock("../api/client", () => ({
  getProducts: vi.fn(),
  getProductRoadmap: vi.fn(),
  createStream: vi.fn(),
  updateStream: vi.fn(),
  deleteStream: vi.fn(),
  createRoadmapItem: vi.fn(),
  updateRoadmapItem: vi.fn(),
  deleteRoadmapItem: vi.fn(),
  linkRoadmapFeature: vi.fn(),
  unlinkRoadmapFeature: vi.fn(),
  listItems: vi.fn(),
}));

import {
  createRoadmapItem,
  createStream,
  deleteRoadmapItem,
  getProductRoadmap,
  getProducts,
  linkRoadmapFeature,
  listItems,
  unlinkRoadmapFeature,
  updateRoadmapItem,
  updateStream,
} from "../api/client";

const itemFixture = streams[0].items[0];

async function openStreamMenu(name: string) {
  await userEvent.click(await screen.findByRole("button", { name: `Stream actions for ${name}` }));
}

describe("RoadmapView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProducts).mockResolvedValue(products);
    vi.mocked(getProductRoadmap).mockResolvedValue(streams);
    vi.mocked(createStream).mockResolvedValue(
      { id: 3, name: "Datacenter", product_id: 1, position: 2, items: [] },
    );
    vi.mocked(updateStream).mockResolvedValue(streams[0]);
    vi.mocked(createRoadmapItem).mockResolvedValue(itemFixture);
    vi.mocked(updateRoadmapItem).mockResolvedValue(itemFixture);
    vi.mocked(deleteRoadmapItem).mockResolvedValue(undefined);
    vi.mocked(linkRoadmapFeature).mockResolvedValue(itemFixture);
    vi.mocked(unlinkRoadmapFeature).mockResolvedValue(itemFixture);
    vi.mocked(listItems).mockResolvedValue([]);
  });

  it("renders lanes with status-colored bars and month axis", async () => {
    render(<RoadmapView />);
    expect(screen.getByRole("heading", { name: "Roadmap" })).toBeInTheDocument();
    expect(await screen.findByText("Campus")).toBeInTheDocument();
    expect(screen.getByText("Backbone")).toBeInTheDocument();
    const bar = await screen.findByText("Wi-Fi 7 rollout");
    expect(bar.closest("button")?.className).toContain("bg-violet-100");
    expect(screen.getByText("Jan 26")).toBeInTheDocument();
  });

  it("adds a stream", async () => {
    render(<RoadmapView />);
    await screen.findByText("Campus");
    await userEvent.click(screen.getByRole("button", { name: "+ Add stream" }));
    await userEvent.type(screen.getByPlaceholderText("New stream name"), "Datacenter");
    await userEvent.click(screen.getByRole("button", { name: "Add stream" }));
    expect(createStream).toHaveBeenCalledWith("Datacenter", 1);
  });

  it("Add stream lives in the page header and toggles the input row", async () => {
    render(<RoadmapView />);
    expect(screen.queryByPlaceholderText("New stream name")).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /add stream/i }));
    expect(screen.getByPlaceholderText("New stream name")).toBeInTheDocument();
  });

  it("reorders streams via the kebab menu", async () => {
    render(<RoadmapView />);
    await openStreamMenu("Campus");
    await userEvent.click(screen.getByRole("menuitem", { name: "Move down" }));
    expect(updateStream).toHaveBeenCalledWith(2, { position: 0 });
    expect(updateStream).toHaveBeenCalledWith(1, { position: 1 });
  });

  it("Move up is disabled for the first stream", async () => {
    render(<RoadmapView />);
    await openStreamMenu("Campus");
    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
  });

  it("Move down is disabled for the last stream", async () => {
    render(<RoadmapView />);
    await openStreamMenu("Backbone");
    expect(screen.getByRole("menuitem", { name: "Move down" })).toBeDisabled();
  });

  it("delete via the kebab shows the confirm and cancel keeps the stream", async () => {
    render(<RoadmapView />);
    await openStreamMenu("Campus");
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Campus")).toBeInTheDocument();
  });

  it("reorders self-heals when stored positions are duplicated", async () => {
    // Test that index-derived positions fix corrupted state where two streams
    // share the same stored position. Mock both streams with position: 0.
    const corruptedStreams: Stream[] = [
      { ...streams[0], position: 0 },
      { ...streams[1], position: 0 },
    ];
    vi.mocked(getProductRoadmap).mockResolvedValueOnce(corruptedStreams);
    render(<RoadmapView />);
    await openStreamMenu("Backbone");
    await userEvent.click(screen.getByRole("menuitem", { name: "Move up" }));
    // Index-derived positions ensure distinct calls even from corrupted state:
    // Backbone (id 2) at index 1, moving up (direction -1) → position 0
    // Campus (id 1) at index 0 → position 1
    expect(updateStream).toHaveBeenCalledWith(2, { position: 0 });
    expect(updateStream).toHaveBeenCalledWith(1, { position: 1 });
  });

  it("renames a stream inline", async () => {
    render(<RoadmapView />);
    await openStreamMenu("Campus");
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Rename Campus" });
    await userEvent.clear(input);
    await userEvent.type(input, "Campus LAN{Enter}");
    expect(updateStream).toHaveBeenCalledWith(1, { name: "Campus LAN" });
  });

  it("adds an item from the stream gutter", async () => {
    render(<RoadmapView />);
    await userEvent.click(await screen.findByRole("button", { name: "Add item to Campus" }));
    expect(await screen.findByRole("heading", { name: /new roadmap item/i })).toBeInTheDocument();
  });

  it("creates an item from a lane's Add item button", async () => {
    vi.mocked(createRoadmapItem).mockResolvedValue(itemFixture);
    render(<RoadmapView />);
    await screen.findByText("Campus");
    await userEvent.click(screen.getByRole("button", { name: "Add item to Campus" }));
    await userEvent.type(screen.getByLabelText("Title"), "New thing");
    await userEvent.type(screen.getByLabelText("Start date"), "2026-09-01");
    await userEvent.type(screen.getByLabelText("End date"), "2026-12-31");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(vi.mocked(createRoadmapItem).mock.calls[0][0]).toMatchObject({
      title: "New thing", stream_id: 1,
      start_date: "2026-09-01", end_date: "2026-12-31",
    });
  });

  it("blocks save when dates are inverted", async () => {
    render(<RoadmapView />);
    await screen.findByText("Campus");
    await userEvent.click(screen.getByRole("button", { name: "Add item to Campus" }));
    await userEvent.type(screen.getByLabelText("Title"), "Bad");
    await userEvent.type(screen.getByLabelText("Start date"), "2026-12-31");
    await userEvent.type(screen.getByLabelText("End date"), "2026-01-01");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Start date must not be after end date")).toBeInTheDocument();
    expect(createRoadmapItem).not.toHaveBeenCalled();
  });

  it("links a feature in edit mode", async () => {
    vi.mocked(listItems).mockResolvedValue([
      { id: 42, title: "Wi-Fi 7 APs", status: "New" } as never,
    ]);
    vi.mocked(linkRoadmapFeature).mockResolvedValue({
      ...itemFixture, features: [{ id: 42, title: "Wi-Fi 7 APs", status: "New" }],
    });
    render(<RoadmapView />);
    await userEvent.click(await screen.findByText("Wi-Fi 7 rollout"));
    await userEvent.click(await screen.findByRole("combobox", { name: "Link feature" }));
    await userEvent.click(screen.getByText("Wi-Fi 7 APs (#42)"));
    expect(linkRoadmapFeature).toHaveBeenCalledWith(9, 42);
  });


  it("add-stream row closes after a successful create", async () => {
    render(<RoadmapView />);
    await userEvent.click(await screen.findByRole("button", { name: /add stream/i }));
    await userEvent.type(screen.getByPlaceholderText("New stream name"), "Edge{Enter}");
    await waitFor(() => expect(screen.queryByPlaceholderText("New stream name")).not.toBeInTheDocument());
  });

  it("add-stream row stays open when the create fails", async () => {
    vi.mocked(createStream).mockRejectedValueOnce(new Error("boom"));
    render(<RoadmapView />);
    await userEvent.click(await screen.findByRole("button", { name: /add stream/i }));
    await userEvent.type(screen.getByPlaceholderText("New stream name"), "Edge{Enter}");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("New stream name")).toBeInTheDocument();
  });

  it("stacks overlapping items on separate rows", async () => {
    vi.mocked(getProductRoadmap).mockResolvedValue([
      {
        id: 1, name: "Campus", product_id: 1, position: 0,
        items: [
          { id: 9, title: "Wi-Fi 7 rollout", description: null, stream_id: 1,
            status: "committed", start_date: "2026-01-01", end_date: "2026-06-30",
            features: [] },
          { id: 10, title: "Switch refresh", description: null, stream_id: 1,
            status: "planned", start_date: "2026-03-01", end_date: "2026-09-30",
            features: [] },
        ],
      },
    ]);
    render(<RoadmapView />);
    const a = (await screen.findByText("Wi-Fi 7 rollout")).closest("button")!;
    const b = (await screen.findByText("Switch refresh")).closest("button")!;
    expect(a.style.top).not.toBe(b.style.top);
    expect(a.style.top).toBe("8px");
    expect(b.style.top).toBe("40px");
  });

});
