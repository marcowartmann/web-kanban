import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router";
import BoardPage from "./components/BoardPage";
import ContractsView from "./components/ContractsView";
import LifecycleView from "./components/LifecycleView";
import AdminView from "./components/admin/AdminView";
import PlanningView from "./components/PlanningView";
import ProductDetailPage from "./components/ProductDetailPage";
import ProductsView from "./components/ProductsView";
import RankingView from "./components/RankingView";
import RoadmapView from "./components/RoadmapView";
import TimelineView from "./components/TimelineView";
import ThemeToggle from "./components/ThemeToggle";
import UserMenu from "./components/UserMenu";
import WorkLayout, { useWork } from "./shell/WorkLayout";
import { useAuth } from "./auth/AuthContext";

export function AppShell() {
  const { user, setUser } = useAuth();
  const isAdmin = user.role === "admin";

  const navLink = (target: string, label: string) => (
    <NavLink
      to={target}
      className={({ isActive }) =>
        `rounded-md px-3 py-1.5 text-sm font-medium transition focus:outline-hidden focus:ring-2 focus:ring-blue-100 ${
          isActive ? "bg-surface text-gray-900 shadow-xs" : "text-gray-500 hover:text-gray-700"
        }`
      }
    >
      {label}
    </NavLink>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      <header className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-surface px-6 py-4">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-gray-900">JAMra</h1>
          <nav className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5">
            {navLink("/board", "Board")}
            {navLink("/planning", "Planning")}
            {navLink("/timeline", "Timeline")}
            {navLink("/ranking", "Ranking")}
            {navLink("/products", "Products")}
            {navLink("/lifecycle", "Lifecycle")}
            {navLink("/contracts", "Contracts")}
            {navLink("/roadmap", "Roadmap")}
            {isAdmin && navLink("/admin", "Admin")}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <UserMenu user={user} onLoggedOut={() => setUser(null)} />
        </div>
      </header>

      <Routes>
        <Route element={<WorkLayout />}>
          <Route path="/board" element={<BoardPage />} />
          <Route path="/planning" element={<PlanningRoute />} />
          <Route path="/timeline" element={<TimelineRoute />} />
          <Route path="/ranking" element={<RankingRoute />} />
          <Route
            path="/admin"
            element={isAdmin ? <Navigate to="/admin/users" replace /> : <Navigate to="/board" replace />}
          />
          <Route
            path="/admin/:section"
            element={isAdmin ? <AdminRoute /> : <Navigate to="/board" replace />}
          />
        </Route>
        <Route path="/products" element={<ProductsView />} />
        <Route path="/products/:productId" element={<ProductDetailPage />} />
        <Route path="/lifecycle" element={<LifecycleView />} />
        <Route path="/contracts" element={<ContractsView />} />
        <Route path="/roadmap" element={<RoadmapView />} />
        <Route path="*" element={<Navigate to="/board" replace />} />
      </Routes>
    </div>
  );
}

function PlanningRoute() {
  const w = useWork();
  return (
    <PlanningView
      items={w.items}
      links={w.links}
      planningIntervals={w.planningIntervals}
      departmentNames={w.departmentNames}
      onOpenCard={w.openItem}
      onChanged={w.onChanged}
    />
  );
}

function TimelineRoute() {
  const w = useWork();
  return (
    <TimelineView
      items={w.items}
      links={w.links}
      planningIntervals={w.planningIntervals}
      departmentNames={w.departmentNames}
      onOpenCard={w.openItem}
      onChanged={w.onChanged}
    />
  );
}

function RankingRoute() {
  const w = useWork();
  return (
    <RankingView
      items={w.items}
      planningIntervals={w.planningIntervals}
      teams={w.teams}
      containers={w.containers}
      departmentNames={w.departmentNames}
      user={w.user}
      onOpenCard={w.openItem}
      onChanged={w.onChanged}
    />
  );
}

function AdminRoute() {
  const w = useWork();
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <AdminView onChanged={w.onChanged} planningIntervals={w.planningIntervals} />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
