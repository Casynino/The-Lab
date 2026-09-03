import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/context/AuthContext';
import { ROLES } from '@/lib/constants';
import { PageSpinner } from '@/components/ui';

import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import RepDashboard from '@/pages/RepDashboard';
import Products from '@/pages/Products';
import Inventory from '@/pages/Inventory';
import Transfers from '@/pages/Transfers';
import Sales from '@/pages/Sales';
import Customers from '@/pages/Customers';
import Returns from '@/pages/Returns';
import SalesReps from '@/pages/SalesReps';
import SalesRepProfile from '@/pages/SalesRepProfile';
import Reorder from '@/pages/Reorder';
import Finance from '@/pages/Finance';
import AuditLogs from '@/pages/AuditLogs';
import Users from '@/pages/Users';
import Settings from '@/pages/Settings';
import Notifications from '@/pages/Notifications';
import Purchases from '@/pages/Purchases';
import StockRequests from '@/pages/StockRequests';
import Settlements from '@/pages/Settlements';
import Commissions from '@/pages/Commissions';
import DailyReports from '@/pages/DailyReports';
import Activity from '@/pages/Activity';
import Profile from '@/pages/Profile';
import NotFound from '@/pages/NotFound';

// Lazy-loaded so the PDF library (jspdf) only downloads when a user actually
// opens the Invoice Generator, keeping the main bundle small.
const InvoiceGenerator = lazy(() => import('@/pages/InvoiceGenerator'));

// Sales reps get a personal dashboard; everyone else gets the management one.
function DashboardRouter() {
  const { role } = useAuth();
  return role === ROLES.SALES_REP ? <RepDashboard /> : <Dashboard />;
}

// One page, both audiences — it picks the rep view or the admin view from the
// role itself. Staff used to be bounced to the Finance tab, which meant the
// sidebar could never carry Commissions as a place of its own. It still lives
// inside Finance as a tab; this is the same component, reached directly.
function CommissionsRouter() {
  return <Commissions />;
}

const W = [ROLES.WAREHOUSE_STAFF]; // ADMIN always allowed by hasRole

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardRouter />} />
        <Route path="/products" element={<ProtectedRoute roles={W}><Products /></ProtectedRoute>} />
        <Route path="/inventory" element={<ProtectedRoute roles={W}><Inventory /></ProtectedRoute>} />
        <Route path="/purchases" element={<ProtectedRoute roles={W}><Purchases /></ProtectedRoute>} />
        <Route path="/transfers" element={<ProtectedRoute roles={W}><Transfers /></ProtectedRoute>} />
        <Route path="/stock-requests" element={<StockRequests />} />
        <Route path="/settlements" element={<Settlements />} />
        <Route path="/commissions" element={<CommissionsRouter />} />
        <Route path="/daily-reports" element={<DailyReports />} />
        <Route path="/invoice-generator" element={<Suspense fallback={<PageSpinner />}><InvoiceGenerator /></Suspense>} />
        <Route path="/activity" element={<ProtectedRoute roles={W}><Activity /></ProtectedRoute>} />
        <Route path="/sales" element={<ProtectedRoute roles={W}><Sales /></ProtectedRoute>} />
        <Route path="/customers" element={<ProtectedRoute roles={W}><Customers /></ProtectedRoute>} />
        <Route path="/returns" element={<Returns />} />
        <Route path="/reps" element={<ProtectedRoute roles={W}><SalesReps /></ProtectedRoute>} />
        <Route path="/reps/:id" element={<ProtectedRoute roles={W}><SalesRepProfile /></ProtectedRoute>} />
        <Route path="/reorder" element={<ProtectedRoute roles={W}><Reorder /></ProtectedRoute>} />
        {/* Reports now lives inside Finance */}
        <Route path="/reports" element={<Navigate to="/finance?tab=reports" replace />} />
        {/* Profit & Margins now lives inside Finance */}
        <Route path="/profit" element={<Navigate to="/finance?tab=profit" replace />} />
        <Route path="/finance" element={<ProtectedRoute roles={W}><Finance /></ProtectedRoute>} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/audit" element={<ProtectedRoute roles={[ROLES.ADMIN]}><AuditLogs /></ProtectedRoute>} />
        <Route path="/users" element={<ProtectedRoute roles={[ROLES.ADMIN]}><Users /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute roles={[ROLES.ADMIN]}><Settings /></ProtectedRoute>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
