import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/Layout";
import { useApp } from "./context/Auth";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import InvoiceUpload from "./pages/InvoiceUpload";
import Invoices from "./pages/Invoices";
import InvoiceDetail from "./pages/InvoiceDetail";
import FraudDashboard from "./pages/FraudDashboard";
import Assistant from "./pages/Assistant";
import Marketplace from "./pages/Marketplace";
import Portfolio from "./pages/Portfolio";
import Tokens from "./pages/Tokens";
import Transactions from "./pages/Transactions";
import Profile from "./pages/Profile";
import Admin from "./pages/Admin";

function RoleGate({ roles, children }) {
  const { user } = useApp();
  return roles.includes(user?.role) ? children : <Navigate to="/app" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/app" element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="upload" element={<RoleGate roles={["supplier"]}><InvoiceUpload /></RoleGate>} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/:id" element={<InvoiceDetail />} />
        <Route path="fraud" element={<FraudDashboard />} />
        <Route path="assistant" element={<Assistant />} />
        <Route path="marketplace" element={<RoleGate roles={["financier", "admin"]}><Marketplace /></RoleGate>} />
        <Route path="portfolio" element={<RoleGate roles={["financier"]}><Portfolio /></RoleGate>} />
        <Route path="tokens" element={<Tokens />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="profile" element={<Profile />} />
        <Route path="admin" element={<RoleGate roles={["admin"]}><Admin /></RoleGate>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
