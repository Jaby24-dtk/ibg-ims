import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import { AuthProvider } from '@/context/AuthContext'
import AuthGate from '@/components/layout/AuthGate'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthGate>
        <div style={{ display: 'flex', minHeight: '100vh', background: '#F8FAFC' }}>
          <Sidebar />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Header />
            <main style={{ flex: 1, padding: 24, overflow: 'auto' }}>
              {children}
            </main>
          </div>
        </div>
      </AuthGate>
    </AuthProvider>
  )
}
