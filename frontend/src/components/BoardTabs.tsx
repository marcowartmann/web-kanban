import type { Board } from "../types";
import TabBar from "./TabBar";

export default function BoardTabs({
  boards,
  activeId,
  onSelect,
  objectivesActive = false,
  onSelectObjectives,
}: {
  boards: Board[];
  activeId: number | null;
  onSelect: (id: number) => void;
  objectivesActive?: boolean;
  onSelectObjectives?: () => void;
}) {
  const tabs = [
    ...boards.map((board) => ({ key: String(board.id), label: board.name })),
    ...(onSelectObjectives ? [{ key: "objectives", label: "PI Objectives" }] : []),
  ];

  const active = objectivesActive ? "objectives" : (activeId !== null ? String(activeId) : null);

  const handleSelect = (k: string) => {
    if (k === "objectives") {
      onSelectObjectives?.();
    } else {
      onSelect(Number(k));
    }
  };

  return <TabBar tabs={tabs} active={active} onSelect={handleSelect} />;
}
