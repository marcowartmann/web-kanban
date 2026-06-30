import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import SearchableSelect from "./SearchableSelect";

const options = ["Marco Wartmann", "Adrian Senn"];

it("filters options as you type", () => {
  render(<SearchableSelect value={null} options={options} onChange={() => {}} />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "adr" } });
  expect(screen.getByText("Adrian Senn")).toBeInTheDocument();
  expect(screen.queryByText("Marco Wartmann")).toBeNull();
});

it("commits a clicked option via onChange", () => {
  const onChange = vi.fn();
  render(<SearchableSelect value={null} options={options} onChange={onChange} />);
  fireEvent.focus(screen.getByRole("combobox"));
  fireEvent.mouseDown(screen.getByText("Marco Wartmann"));
  expect(onChange).toHaveBeenCalledWith("Marco Wartmann");
});

it("clear button sets null", () => {
  const onChange = vi.fn();
  render(<SearchableSelect value="Marco Wartmann" options={options} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: /clear/i }));
  expect(onChange).toHaveBeenCalledWith(null);
});

it("does not commit free text (strict)", () => {
  const onChange = vi.fn();
  render(<SearchableSelect value={null} options={options} onChange={onChange} />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Nobody" } });
  expect(onChange).not.toHaveBeenCalled();
});
