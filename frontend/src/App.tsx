import { BrowserRouter, Navigate, Route, Routes } from "react-router";
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
import Sidebar from "./shell/Sidebar";
import WorkLayout, { useWork } from "./shell/WorkLayout";
import { useAuth } from "./auth/AuthContext";

export function AppShell() {
  const { user, setUser } = useAuth();
  const isAdmin = user.role === "admin";

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar onLoggedOut={() => setUser(null)} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
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
      </main>
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
