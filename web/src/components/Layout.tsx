import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

const LINKS = [
  { to: '/', label: 'Chat', icon: '💬', end: true },
  { to: '/prompt', label: 'Master prompt', icon: '📝', end: false },
  { to: '/briefs', label: 'Briefs', icon: '☀️', end: false },
  { to: '/settings', label: 'Settings', icon: '⚙️', end: false },
]

/** Top bar on desktop, bottom tab bar on a phone (safe-area aware, as in Newsdesk). */
export function Layout({ children }: { children: ReactNode }) {
  const cls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-ink-200 font-medium dark:bg-ink-800' : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-900'}`
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-ink-200 bg-ink-50/90 backdrop-blur dark:border-ink-800 dark:bg-ink-950/90" style={{ paddingTop: 'var(--au-safe-top)' }}>
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2">
          <span className="text-lg font-semibold tracking-tight">🌅 Aube</span>
          <nav className="hidden gap-1 sm:flex">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={cls}>
                {l.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 pb-[calc(var(--au-tabbar)+1rem)] sm:pb-6">{children}</main>
      <nav
        className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-ink-200 bg-ink-50/95 sm:hidden dark:border-ink-800 dark:bg-ink-950/95"
        style={{ height: 'var(--au-tabbar)', paddingBottom: 'var(--au-safe-bottom)' }}
      >
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `flex flex-1 flex-col items-center justify-center text-xs ${isActive ? 'font-semibold' : 'text-ink-500'}`}>
            <span className="text-lg leading-none">{l.icon}</span>
            {l.label.split(' ')[0]}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
