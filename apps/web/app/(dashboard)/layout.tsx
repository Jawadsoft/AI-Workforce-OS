import { Sidebar } from '@/components/shared/sidebar'
import { MobileNav } from '@/components/shared/mobile-nav'
import { Header } from '@/components/shared/header'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar — hidden on mobile, visible on sm+ */}
      <div className="hidden sm:flex">
        <Sidebar />
      </div>

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header />
        {/* On mobile, reduce bottom padding to account for bottom nav */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-6 md:p-8 pb-[52px] sm:pb-6 md:pb-8">
          {children}
        </main>
      </div>

      {/* Bottom nav — mobile only */}
      <MobileNav />
    </div>
  )
}
