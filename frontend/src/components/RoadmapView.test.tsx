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
}));

import { createStream, getProductRoadmap, getProducts, updateStream } from "../api/client";

describe("RoadmapView", () => {
  beforeEach(() => {
    vi.mocked(getProducts).mockResolvedValue(products);
    vi.mocked(getProductRoadmap).mockResolvedValue(streams);
    vi.mocked(createStream).mockResolvedValue(
      { id: 3, name: "Datacenter", product_id: 1, position: 2, items: [] },
    );
    vi.mocked(updateStream).mockResolvedValue(streams[0]);
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

  it("renames a stream inline", async () => {
    render(<RoadmapView />);
    await screen.findByText("Campus");
    await userEvent.click(screen.getByRole("button", { name: "Rename Campus" }));
    const input = screen.getByRole("textbox", { name: "Rename Campus" });
    await userEvent.clear(input);
    await userEvent.type(input, "Campus LAN{Enter}");
    expect(updateStream).toHaveBeenCalledWith(1, { name: "Campus LAN" });
  });
});
