import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/context/AuthContext';
import { ROLES } from '@/lib/constants';
import ThemeColor from '@/components/ThemeColor';
import { lazyPage, WarmPages } from '@/components/LazyPage';

// Every page is its own file (see lib/pages.js): the first screen downloads the
// shell and that one page, not the whole app. The files of the pages in a
// person's menu are fetched in the quiet after the first screen and the moment
// a link is touched, so a click finds its page already here.
const Login = lazyPage('Login');
const Nino = lazyPage('Nino');
const Dashboard = lazyPage('Dashboard');
const RepDashboard = lazyPage('RepDashboard');
const Products = lazyPage('Products');
const Inventory = lazyPage('Inventory');
const Sales = lazyPage('Sales');
const Customers = lazyPage('Customers');
const Returns = lazyPage('Returns');
const SalesReps = lazyPage('SalesReps');
const SalesRepProfile = lazyPage('SalesRepProfile');
const Finance = lazyPage('Finance');
const AuditLogs = lazyPage('AuditLogs');
const Users = lazyPage('Users');
const Settings = lazyPage('Settings');
const Notifications = lazyPage('Notifications');
const StockRequests = lazyPage('StockRequests');
const Settlements = lazyPage('Settlements');
const Commissions = lazyPage('Commissions');
const DailyReports = lazyPage('DailyReports');
const Activity = lazyPage('Activity');
const Profile = lazyPage('Profile');
const NotFound = lazyPage('NotFound');
// The PDF library (jspdf) and the QR maker come with these two only.
const InvoiceGenerator = lazyPage('InvoiceGenerator');
const ProductLabel = lazyPage('ProductLabel');

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

// The owner's own pages now open inside his profile (and the Label inside Products). An old link,
// bookmark or notification still works: for him it goes there; anyone else keeps the page itself.
// Staff open this page inside another one (Invoice inside Sales); a rep, who has no such page, keeps it.
function RepOnlyElse({ to, children }) {
  const { role } = useAuth();
  return role === ROLES.SALES_REP ? children : <Navigate to={to} replace />;
}

function OwnerAt({ to, children }) {
  const { role } = useAuth();
  return role === ROLES.ADMIN ? <Navigate to={to} replace /> : children;
}

export default function App() {
  return (
    <>
      <ThemeColor />
      {/* The strip behind the phone's clock when the app runs from the home
          screen: the page runs under the status bar, and this keeps the clock
          on the app's own ground rather than on whatever scrolled up there.
          No height at all in a browser tab. See .status-strip in index.css. */}
      <div aria-hidden className="status-strip" />
      <Routes>
      <Route path="/login" element={<><WarmPages /><Login /></>} />
      {/* Public on purpose: it hangs off the sign-in screen, so everyone who
          would ever read it is signed out. It shows nothing of the business. */}
      <Route path="/nino" element={<Nino />} />

      <Route
        element={
          <ProtectedRoute>
            <WarmPages />
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardRouter />} />
        <Route path="/products" element={<ProtectedRoute roles={W}><Products /></ProtectedRoute>} />
        <Route path="/inventory" element={<ProtectedRoute roles={W}><Inventory /></ProtectedRoute>} />
        <Route path="/purchases" element={<ProtectedRoute roles={W}><Navigate to="/inventory?tab=purchases" replace /></ProtectedRoute>} />
        <Route path="/transfers" element={<ProtectedRoute roles={W}><Navigate to="/inventory?tab=transfers" replace /></ProtectedRoute>} />
        <Route path="/stock-requests" element={<StockRequests />} />
        <Route path="/settlements" element={<Settlements />} />
        <Route path="/commissions" element={<CommissionsRouter />} />
        <Route path="/daily-reports" element={<OwnerAt to="/profile?tab=reports"><DailyReports /></OwnerAt>} />
        <Route path="/invoice-generator" element={<RepOnlyElse to="/sales?tab=invoice"><InvoiceGenerator /></RepOnlyElse>} />
        <Route path="/activity" element={<ProtectedRoute roles={W}><OwnerAt to="/profile?tab=activity"><Activity /></OwnerAt></ProtectedRoute>} />
        <Route path="/sales" element={<ProtectedRoute roles={W}><Sales /></ProtectedRoute>} />
        <Route path="/customers" element={<ProtectedRoute roles={W}><Customers /></ProtectedRoute>} />
        <Route path="/returns" element={<Returns />} />
        <Route path="/reps" element={<ProtectedRoute roles={W}><SalesReps /></ProtectedRoute>} />
        <Route path="/reps/:id" element={<ProtectedRoute roles={W}><SalesRepProfile /></ProtectedRoute>} />
        <Route path="/reorder" element={<ProtectedRoute roles={W}><Navigate to="/inventory?tab=reorder" replace /></ProtectedRoute>} />
        {/* Reports now lives inside Finance */}
        <Route path="/reports" element={<Navigate to="/finance?tab=reports" replace />} />
        {/* Profit & Margins now lives inside Finance */}
        <Route path="/profit" element={<Navigate to="/finance?tab=profit" replace />} />
        <Route path="/finance" element={<ProtectedRoute roles={W}><Finance /></ProtectedRoute>} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/audit" element={<ProtectedRoute roles={[ROLES.ADMIN]}><OwnerAt to="/profile?tab=audit"><AuditLogs /></OwnerAt></ProtectedRoute>} />
        <Route path="/users" element={<ProtectedRoute roles={[ROLES.ADMIN]}><OwnerAt to="/profile?tab=users"><Users /></OwnerAt></ProtectedRoute>} />
        <Route path="/label" element={<ProtectedRoute roles={[ROLES.ADMIN]}><OwnerAt to="/products?tab=label"><ProductLabel /></OwnerAt></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute roles={[ROLES.ADMIN]}><OwnerAt to="/profile?tab=settings"><Settings /></OwnerAt></ProtectedRoute>} />
        <Route path="*" element={<NotFound />} />
      </Route>
      </Routes>
    </>
  );
}
