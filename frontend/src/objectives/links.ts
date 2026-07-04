import { createContext, useContext } from "react";
import type { ItemKind } from "../types";

/** Feature ids linked to at least one PI Objective. Empty by default so card
 *  components render fine outside a provider (e.g. in unit tests). */
export const ObjectiveLinksContext = createContext<Set<number>>(new Set());

export const useObjectiveLinks = (): Set<number> => useContext(ObjectiveLinksContext);

/** A card is "linked to a PI Objective" when it is a linked feature, or a story
 *  whose parent feature is linked. */
export function isObjectiveLinked(
  links: Set<number>,
  kind: ItemKind | string,
  id: number,
  parentId: number | null | undefined,
): boolean {
  if (kind === "feature") return links.has(id);
  if (kind === "story") return parentId != null && links.has(parentId);
  return false;
}
