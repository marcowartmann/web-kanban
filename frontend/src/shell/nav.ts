import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faArrowsSpin, faBoxesStacked, faFileContract, faGear, faListCheck,
  faMapLocationDot, faRankingStar, faTableColumns, faTimeline,
} from "../icons";

export type NavItem = { path: string; label: string; icon: IconDefinition };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Work",
    items: [
      { path: "/board", label: "Board", icon: faTableColumns },
      { path: "/planning", label: "Planning", icon: faListCheck },
      { path: "/timeline", label: "Timeline", icon: faTimeline },
      { path: "/ranking", label: "Ranking", icon: faRankingStar },
    ],
  },
  {
    label: "Catalog",
    items: [
      { path: "/products", label: "Products", icon: faBoxesStacked },
      { path: "/lifecycle", label: "Lifecycle", icon: faArrowsSpin },
      { path: "/contracts", label: "Contracts", icon: faFileContract },
      { path: "/roadmap", label: "Roadmap", icon: faMapLocationDot },
    ],
  },
];

export const ADMIN_ITEM: NavItem = { path: "/admin", label: "Admin", icon: faGear };
