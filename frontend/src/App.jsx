import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import ProtectedRoute from "./routes/ProtectedRoute";
import RoleLayout from "./layouts/RoleLayout";
import VisitorLayout from "./views/visitor/layouts/VisitorLayout";
import VisitorInquire from "./views/visitor/pages/Inquire";
import AlertsHost from "./views/components/AlertsHost";

// Admin pages
import BurialPlots from "./views/admin/pages/BurialPlots";
import BurialRecords from "./views/admin/pages/BurialRecords";
import RoadPlots from "./views/admin/pages/RoadPlots";
import BuildingPlots from "./views/admin/pages/BuildingPlots";
import ViewTickets from "./views/admin/pages/ViewTickets";
import BurialSchedule from "./views/admin/pages/BurialSchedule";
import MaintenanceSchedules from "./views/admin/pages/MaintenanceSchedule";
import VisitorManagement from "./views/admin/pages/Visitor"; // ⬅️ NEW

// Visitor pages
import SearchForDeceased from "./views/visitor/pages/SearchForDeceased";

// utils
import { getAuth } from "./utils/auth";

const AdminSet = lazy(() => import("./views/admin/pages/Settings"));

const VisitorHome = lazy(() => import("./views/visitor/pages/Home"));
const VisitorLogin = lazy(() => import("./views/login/Login"));
const VisitorSet = lazy(() => import("./views/visitor/pages/Settings"));

function Loading() {
  return <div className="p-6">Loading…</div>;
}

/* ---------- role helpers ---------- */
function canonicalRole(rawRole) {
  if (!rawRole) return null;
  const r = String(rawRole).toLowerCase();
  if (r === "super_admin" || r === "staff") return "admin";
  return r;
}

function defaultPathFor(role) {
  const r = canonicalRole(role);
  switch (r) {
    case "admin":
      return "/admin/plots";
    case "visitor":
      return "/visitor/home";
    default:
      return "/visitor/home";
  }
}

function RoleLanding() {
  const auth = getAuth();
  const role = auth?.user?.role;
  return <Navigate to={defaultPathFor(role)} replace />;
}

function PortalGuard({ allow, children }) {
  const auth = getAuth();
  const role = canonicalRole(auth?.user?.role);

  // If logged in but role not allowed for this portal, bounce to their default
  if (role && allow && !allow.includes(role)) {
    return <Navigate to={defaultPathFor(role)} replace />;
  }
  return children;
}

/* ---------- app routes ---------- */
export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <AlertsHost />
        <Routes>
          {/* Root: send logged-in users to their portal, others to visitor home */}
          <Route path="/" element={<RoleLanding />} />

          {/* VISITOR (public) */}
          <Route
            path="/visitor"
            element={
              <PortalGuard allow={["visitor"]}>
                <VisitorLayout />
              </PortalGuard>
            }
          >
            <Route index element={<Navigate to="home" replace />} />
            <Route path="home" element={<VisitorHome />} />
            <Route path="login" element={<VisitorLogin />} />
            <Route path="inquire" element={<VisitorInquire />} />
            <Route path="search" element={<SearchForDeceased />} />
            <Route path="settings" element={<VisitorSet />} />
            <Route path="*" element={<Navigate to="/visitor/home" replace />} />
          </Route>

          {/* ADMIN (includes former super_admin + staff features) */}
          <Route element={<ProtectedRoute allow={["admin"]} />}>
            <Route
              path="/admin/*"
              element={
                <PortalGuard allow={["admin"]}>
                  <RoleLayout base="/admin">
                    <Routes>
                      {/* Default admin landing: plots */}
                      <Route
                        index
                        element={<Navigate to="/admin/plots" replace />}
                      />

                      {/* 🔹 Visitors management (matches sidebar `to: "/visitor"`) */}
                      <Route path="visitor" element={<VisitorManagement />} />

                      {/* Plot management */}
                      <Route path="plots" element={<BurialPlots />} />
                      <Route path="road-plots" element={<RoadPlots />} />
                      <Route path="building-plots" element={<BuildingPlots />} />
                      <Route path="records" element={<BurialRecords />} />

                      {/* Staff features under admin */}
                      <Route path="tickets" element={<ViewTickets />} />
                      <Route path="burials" element={<BurialSchedule />} />
                      <Route
                        path="maintenance"
                        element={<MaintenanceSchedules />}
                      />

                      {/* Admin settings */}
                      <Route path="settings" element={<AdminSet />} />

                      {/* Any stray /admin path → plots */}
                      <Route
                        path="*"
                        element={<Navigate to="/admin/plots" replace />}
                      />
                    </Routes>
                  </RoleLayout>
                </PortalGuard>
              }
            />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
