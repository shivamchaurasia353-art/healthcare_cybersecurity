import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useLayoutEffect } from 'react';
import useAuthStore from './store/authStore';

// Pages
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import ConsentPage from './pages/ConsentPage';
import RecordsPage from './pages/RecordsPage';
import AuditPage from './pages/AuditPage';
import ProfilePage from './pages/ProfilePage';
import Layout from './components/Layout';

function PrivateRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const initialized = useAuthStore((s) => s.initialized);
  if (!initialized) return null; // wait for localStorage read before routing
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const initialize = useAuthStore((s) => s.initialize);

  // useLayoutEffect runs synchronously before browser paint — no flash/redirect
  useLayoutEffect(() => {
    initialize();
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="consent" element={<ConsentPage />} />
          <Route path="records" element={<RecordsPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
