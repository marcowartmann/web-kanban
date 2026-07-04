import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBullseye } from "../icons";
import { isObjectiveLinked, useObjectiveLinks } from "../objectives/links";
import type { ItemKind } from "../types";

/** 🎯 shown when this card's feature (or a story's parent feature) is linked to
 *  a PI Objective. Renders nothing otherwise. */
export default function ObjectiveLinkBadge({
  kind,
  id,
  parentId,
}: {
  kind: ItemKind | string;
  id: number;
  parentId?: number | null;
}) {
  const links = useObjectiveLinks();
  if (!isObjectiveLinked(links, kind, id, parentId)) return null;
  return (
    <span role="img" aria-label="linked to a PI objective" title="Linked to a PI Objective" className="text-xs text-blue-500">
      <FontAwesomeIcon icon={faBullseye} aria-hidden />
    </span>
  );
}
