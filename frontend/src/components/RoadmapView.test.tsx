import { render, screen } from "@testing-library/react";
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
    expect(await screen.findByText("Campus")).toBeInTheDocument();
    expect(screen.getByText("Backbone")).toBeInTheDocument();
    const bar = await screen.findByText("Wi-Fi 7 rollout");
    expect(bar.closest("button")?.className).toContain("bg-violet-100");
    expect(screen.getByText("Jan 26")).toBeInTheDocument();
  });

  it("adds a stream", async () => {
    render(<RoadmapView />);
    await screen.findByText("Campus");
    await userEvent.type(screen.getByPlaceholderText("New stream name"), "Datacenter");
    await userEvent.click(screen.getByRole("button", { name: "Add stream" }));
    expect(createStream).toHaveBeenCalledWith("Datacenter", 1);
  });

  it("reorders streams by swapping positions", async () => {
    render(<RoadmapView />);
    await screen.findByText("Campus");
    await userEvent.click(screen.getByRole("button", { name: "Move Backbone up" }));
    expect(updateStream).toHaveBeenCalledWith(2, { position: 0 });
    expect(updateStream).toHaveBeenCalledWith(1, { position: 1 });
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
    await screen.findByText("Campus");
    await userEvent.click(screen.getByRole("button", { name: "Move Backbone up" }));
    // Index-derived positions ensure distinct calls even from corrupted state:
    // Backbone (id 2) at index 1, moving up (direction -1) → position 0
    // Campus (id 1) at index 0 → position 1
    expect(updateStream).toHaveBeenCalledWith(2, { position: 0 });
    expect(updateStream).toHaveBeenCalledWith(1, { position: 1 });
  });

  it("renames a stream inline", async () => {
    render(<RoadmapView />);
    await screen.findByText("Campus");
    await userEvent.click(screen.getByRole("button", { name: "Rename Campus" }));
    const input = screen.getByRole("textbox", { name: "Rename Campus" });
    await userEvent.clear(input);
    await userEvent.type(input, "Campus LAN{Enter}");
    expect(updateStream).toHaveBeenCalledWith(1, { name: "Campus LAN" });
  });

  it("creates an item from a lane's Add item button", async () => {
    vi.mocked(createRoadmapItem).mockResolvedValue(itemFixture);
    render(<RoadmapView />);
    await screen.findByText("Campus");
    await userEvent.click(screen.getAllByRole("button", { name: "Add item" })[0]);
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
    await userEvent.click(screen.getAllByRole("button", { name: "Add item" })[0]);
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
});
