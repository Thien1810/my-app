import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { isSupabaseConfigured } from './lib/supabase'
import { AuthProvider, useAuth } from './lib/AuthContext'
import SetupScreen from './components/SetupScreen'
import PendingApprovalScreen from './components/PendingApprovalScreen'
import Layout from './components/Layout'
import AuthPage from './pages/AuthPage'
import DashboardPage from './pages/DashboardPage'
import ItemsPage from './pages/ItemsPage'
import ItemDetailPage from './pages/ItemDetailPage'
import MovementsPage from './pages/MovementsPage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import TemplatesPage from './pages/TemplatesPage'
import PartnersPage from './pages/PartnersPage'
import ReportsPage from './pages/ReportsPage'
import UsersPage from './pages/UsersPage'
import './App.css'

function AppRouter() {
  const { session, loading, isPending } = useAuth()

  if (!isSupabaseConfigured) {
    return <SetupScreen />
  }

  if (loading) {
    return (
      <div className="auth-wrapper">
        <div className="loading-state">Đang tải thông tin phiên đăng nhập...</div>
      </div>
    )
  }

  if (!session) {
    return <AuthPage />
  }

  if (isPending) {
    return <PendingApprovalScreen />
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/vat-tu" element={<ItemsPage />} />
          <Route path="/vat-tu/:id" element={<ItemDetailPage />} />
          <Route path="/phieu-kho" element={<MovementsPage />} />
          <Route path="/du-an" element={<ProjectsPage />} />
          <Route path="/du-an/:id" element={<ProjectDetailPage />} />
          <Route path="/mau-set" element={<TemplatesPage />} />
          <Route path="/doi-tac" element={<PartnersPage />} />
          <Route path="/bao-cao" element={<ReportsPage />} />
          <Route path="/nguoi-dung" element={<UsersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  )
}
