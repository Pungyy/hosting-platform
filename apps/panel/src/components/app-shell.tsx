"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import {
  Boxes,
  Database,
  Globe,
  HardDrive,
  LayoutDashboard,
  Menu,
  Rocket,
  Server,
  X,
  type LucideIcon,
} from "lucide-react"

import { cn } from "cn"

type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  soon?: boolean
}

type NavSection = {
  title: string
  items: NavItem[]
}

const navigation: NavSection[] = [
  {
    title: "Plateforme",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/sites", label: "Sites", icon: Globe },
      { href: "/domains", label: "Domaines", icon: Globe },
      { href: "/servers", label: "Serveurs", icon: Server },
      { href: "/deployments", label: "Déploiements", icon: Rocket },
    ],
  },
  {
    title: "Bientôt",
    items: [
      { href: "/databases", label: "Bases de données", icon: Database, soon: true },
      { href: "/backups", label: "Sauvegardes", icon: HardDrive, soon: true },
    ],
  },
]

function isActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/"
  }

  return pathname === href || pathname.startsWith(`${href}/`)
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Boxes className="size-[18px]" />
      </span>

      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold tracking-tight">
          Hosting Platform
        </span>
        <span className="text-xs text-muted-foreground">Infrastructure</span>
      </span>
    </Link>
  )
}

function SidebarNav({ pathname }: { pathname: string }) {
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
      {navigation.map((section) => (
        <div key={section.title} className="space-y-1">
          <p className="px-3 pb-1 text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground/70">
            {section.title}
          </p>

          {section.items.map((item) => {
            const active = isActive(pathname, item.href)
            const Icon = item.icon

            if (item.soon) {
              return (
                <span
                  key={item.href}
                  className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground/50"
                >
                  <Icon className="size-4" />
                  <span className="flex-1">{item.label}</span>
                  <span className="rounded-full border border-border px-1.5 py-px text-[0.625rem] font-medium text-muted-foreground/60">
                    Bientôt
                  </span>
                </span>
              )
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                )}
              >
                <Icon
                  className={cn(
                    "size-4",
                    active ? "text-brand" : "text-muted-foreground"
                  )}
                />
                {item.label}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

function SidebarUser() {
  return (
    <div className="border-t border-sidebar-border p-3">
      <div className="flex items-center gap-3 rounded-lg px-2 py-2">
        <span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
          IA
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-medium">Ibrahim</p>
          <p className="truncate text-xs text-muted-foreground">Administrateur</p>
        </div>
      </div>
    </div>
  )
}

function SidebarContent({ pathname }: { pathname: string }) {
  return (
    <>
      <div className="flex h-14 items-center px-5">
        <Brand />
      </div>
      <SidebarNav pathname={pathname} />
      <SidebarUser />
    </>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) {
      return
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }

    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <SidebarContent pathname={pathname} />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Fermer le menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[80vw] flex-col border-r border-sidebar-border bg-sidebar shadow-lg">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
            <SidebarContent pathname={pathname} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Ouvrir le menu"
            className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-foreground"
          >
            <Menu className="size-4" />
          </button>
          <Brand />
        </header>

        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  )
}
