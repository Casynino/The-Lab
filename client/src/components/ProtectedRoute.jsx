import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { PageSpinner } from '@/components/ui';

// Guards a route subtree. Optionally restricts to specific roles.
export default function ProtectedRoute({ children, roles }) {
  const { isAuthenticated, loading, reconnecting, hasRole } = useAuth();
  const location = useLocation();

  if (loading) return <PageSpinner label={reconnecting ? 'No connection to ZELab yet. Trying again…' : 'Checking your session…'} />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  if (roles && !hasRole(...roles)) return <Navigate to="/" replace />;

  return children;
}
