import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { NotifyProvider } from './context/NotifyContext'
import { ThemeProvider } from './context/ThemeContext'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import { PageLoader, RouteProgress } from './components/ui.jsx'

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const Processes = lazy(() => import('./pages/Processes.jsx'))
const Applications = lazy(() => import('./pages/Applications.jsx'))
const ApplicationDetail = lazy(() => import('./pages/ApplicationDetail.jsx'))
const Containers = lazy(() => import('./pages/Containers.jsx'))
const Databases = lazy(() => import('./pages/Databases.jsx'))
const Domains = lazy(() => import('./pages/Domains.jsx'))
const Files = lazy(() => import('./pages/Files.jsx'))
const Services = lazy(() => import('./pages/Services.jsx'))
const Backups = lazy(() => import('./pages/Backups.jsx'))
const Cron = lazy(() => import('./pages/Cron.jsx'))
const SshKeys = lazy(() => import('./pages/SshKeys.jsx'))
const Settings = lazy(() => import('./pages/Settings.jsx'))
const Marketplace = lazy(() => import('./pages/Marketplace.jsx'))
const Aurex = lazy(() => import('./pages/Aurex.jsx'))
const Integrations = lazy(() => import('./pages/Integrations.jsx'))

function Protected({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="p-8"><PageLoader label="Signing you in..." /></div>
  // If auth is disabled on backend, user will be 'dev' even without token — allow
  // On refresh with no/invalid session, bounce to login and remember where
  // the user was so a fresh sign-in can return them there.
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return children
}

function Fallback() {
  return <RouteProgress />
}

export default function App() {
  return (
    <ThemeProvider>
    <NotifyProvider>
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<Fallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Protected><Layout /></Protected>}>
              <Route index element={<Dashboard />} />
              <Route path="processes" element={<Processes />} />
              <Route path="applications" element={<Applications />} />
              <Route path="applications/:name" element={<ApplicationDetail />} />
              <Route path="containers" element={<Containers />} />
              <Route path="databases" element={<Databases />} />
              <Route path="domains" element={<Domains />} />
              <Route path="files" element={<Files />} />
              <Route path="services" element={<Services />} />
              <Route path="backups" element={<Backups />} />
              <Route path="cron" element={<Cron />} />
              <Route path="ssh-keys" element={<SshKeys />} />
              <Route path="marketplace" element={<Marketplace />} />
              <Route path="aurex" element={<Aurex />} />
              <Route path="integrations" element={<Integrations />} />
              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
    </NotifyProvider>
    </ThemeProvider>
  )
}
