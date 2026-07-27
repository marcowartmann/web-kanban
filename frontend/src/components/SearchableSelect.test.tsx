import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import DrawerShell from "./DrawerShell";
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

it("allowCreate: shows a create row for an unmatched query and commits it", () => {
  const onChange = vi.fn();
  render(<SearchableSelect value={null} options={options} onChange={onChange} allowCreate />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "NewVendor" } });
  const createRow = screen.getByText('Use “NewVendor”');
  expect(createRow).toBeInTheDocument();
  fireEvent.mouseDown(createRow);
  expect(onChange).toHaveBeenCalledWith("NewVendor");
});

it("allowCreate: no create row when the query exactly matches an existing option", () => {
  render(<SearchableSelect value={null} options={options} onChange={() => {}} allowCreate />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "Marco Wartmann" } });
  expect(screen.queryByText('Use “Marco Wartmann”')).toBeNull();
});

it("allowCreate: falls back to No matches when the query is empty", () => {
  render(<SearchableSelect value={null} options={[]} onChange={() => {}} allowCreate />);
  fireEvent.focus(screen.getByRole("combobox"));
  expect(screen.getByText("No matches")).toBeInTheDocument();
});

it("without allowCreate: shows No matches instead of a create row", () => {
  const onChange = vi.fn();
  render(<SearchableSelect value={null} options={options} onChange={onChange} />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "NewVendor" } });
  expect(screen.getByText("No matches")).toBeInTheDocument();
  expect(screen.queryByText('Use “NewVendor”')).toBeNull();
});

it("Escape closes only the open popover, not a containing DrawerShell", async () => {
  const onClose = vi.fn();
  render(
    <DrawerShell title="Widget" onClose={onClose} footer={{ onCancel: vi.fn(), onSave: vi.fn() }}>
      <SearchableSelect value={null} options={options} onChange={vi.fn()} />
    </DrawerShell>,
  );
  // userEvent (not fireEvent.focus) actually moves DOM focus onto the input,
  // so the later Escape keypress targets it — required for the root div's
  // onKeyDown to see (and stop) the event before it reaches the document.
  await userEvent.click(screen.getByRole("combobox"));
  expect(screen.getByText("Marco Wartmann")).toBeInTheDocument();

  await userEvent.keyboard("{Escape}");
  expect(screen.queryByText("Marco Wartmann")).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
});
