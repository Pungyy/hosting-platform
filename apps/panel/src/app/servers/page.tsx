"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import {
  Activity,
  ArrowUpRight,
  Bell,
  CircleHelp,
  Database,
  HardDrive,
  LayoutDashboard,
  Plus,
  Rocket,
  Server,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

type ServerMetrics = {
  cpuUsage: number | null
  memoryUsage: number | null
  diskUsage: number | null
  memoryTotal: number | null
  memoryUsed: number | null
  diskTotal: number | null
  diskUsed: number | null
  uptimeSeconds: number | null
}

type ServerData = {
  id: string
  name: string
  hostname: string
  ipAddress: string | null
  status: string
  agentVersion: string | null
  metrics: ServerMetrics
  lastSeenAt: string | null
  enrolledAt: string | null
  createdAt: string
  updatedAt: string
}

export default function ServersPage() {
  const [servers, setServers] =
    useState<ServerData[]>([])

  const [loading, setLoading] =
    useState(true)

  const [error, setError] =
    useState<string | null>(null)

  const loadServers = useCallback(
    async () => {
      try {
        const response =
          await fetch(
            "/api/servers",
            {
              cache: "no-store",
            },
          )

        if (!response.ok) {
          throw new Error(
            "Impossible de récupérer les serveurs.",
          )
        }

        const data =
          await response.json()

        if (data.status !== "ok") {
          throw new Error(
            data.message ??
              "Impossible de récupérer les serveurs.",
          )
        }

        setServers(
          data.servers ?? [],
        )

        setError(null)
      } catch (error) {
        console.error(
          "Erreur lors du chargement des serveurs :",
          error,
        )

        setError(
          "Impossible de récupérer les serveurs.",
        )
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    loadServers()

    const interval =
      setInterval(
        loadServers,
        10000,
      )

    return () =>
      clearInterval(interval)
  }, [loadServers])

  const onlineServers =
    servers.filter(
      (server) =>
        server.status === "online",
    ).length

  const offlineServers =
    servers.filter(
      (server) =>
        server.status === "offline",
    ).length

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="flex min-h-screen">

        {/* SIDEBAR */}
        <aside className="hidden w-64 border-r bg-background lg:flex lg:flex-col">
          <div className="flex h-16 items-center px-6">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Rocket className="h-5 w-5" />
              </div>

              <div>
                <p className="font-semibold">
                  Hosting Platform
                </p>

                <p className="text-xs text-muted-foreground">
                  Infrastructure
                </p>
              </div>
            </div>
          </div>

          <Separator />

          <nav className="flex-1 space-y-1 p-4">
            <NavItem
              href="/"
              icon={
                <LayoutDashboard className="h-4 w-4" />
              }
              label="Dashboard"
            />

            <NavItem
              href="/sites"
              icon={
                <GlobeIcon />
              }
              label="Sites"
            />

            <NavItem
              href="/domains"
              icon={
                <GlobeIcon />
              }
              label="Domaines"
            />

            <NavItem
              href="/servers"
              icon={
                <Server className="h-4 w-4" />
              }
              label="Serveurs"
              active
            />

            <NavItem
              href="/deployments"
              icon={
                <Rocket className="h-4 w-4" />
              }
              label="Deployments"
            />

            <NavItem
              href="/databases"
              icon={
                <Database className="h-4 w-4" />
              }
              label="Bases de données"
            />

            <NavItem
              href="/backups"
              icon={
                <HardDrive className="h-4 w-4" />
              }
              label="Backups"
            />

            <Separator className="my-4" />

            <NavItem
              href="/clients"
              icon={
                <Users className="h-4 w-4" />
              }
              label="Clients"
            />

            <NavItem
              href="/settings"
              icon={
                <Settings className="h-4 w-4" />
              }
              label="Paramètres"
            />

            <NavItem
              href="/support"
              icon={
                <CircleHelp className="h-4 w-4" />
              }
              label="Support"
            />
          </nav>

          {/* USER */}
          <div className="border-t p-4">
            <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                IA
              </div>

              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  Ibrahim
                </p>

                <p className="truncate text-xs text-muted-foreground">
                  Administrateur
                </p>
              </div>
            </div>
          </div>
        </aside>

        {/* MAIN */}
        <main className="flex-1">

          {/* HEADER */}
          <header className="flex h-16 items-center justify-between border-b bg-background px-6">
            <div>
              <h1 className="text-lg font-semibold">
                Serveurs
              </h1>

              <p className="text-sm text-muted-foreground">
                Gestion et surveillance de votre infrastructure
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-lg border bg-background hover:bg-muted"
              >
                <CircleHelp className="h-4 w-4" />
              </button>

              <button
                type="button"
                className="relative flex h-9 w-9 items-center justify-center rounded-lg border bg-background hover:bg-muted"
              >
                <Bell className="h-4 w-4" />

                <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" />
              </button>

              <div className="ml-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                IA
              </div>
            </div>
          </header>

          <div className="space-y-6 p-6">

            {/* TITLE */}
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  Infrastructure
                </h2>

                <p className="mt-1 text-sm text-muted-foreground">
                  Surveillez l'état et les ressources de vos serveurs.
                </p>
              </div>

              <Link
                href="/servers/new"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                Ajouter un serveur
              </Link>
            </div>

            {/* STATS */}
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard
                title="Serveurs"
                value={
                  loading
                    ? "..."
                    : String(
                        servers.length,
                      )
                }
                description="Serveurs enregistrés"
                icon={
                  <Server className="h-4 w-4" />
                }
              />

              <StatCard
                title="En ligne"
                value={
                  loading
                    ? "..."
                    : String(
                        onlineServers,
                      )
                }
                description="Serveurs opérationnels"
                icon={
                  <Activity className="h-4 w-4" />
                }
              />

              <StatCard
                title="Hors ligne"
                value={
                  loading
                    ? "..."
                    : String(
                        offlineServers,
                      )
                }
                description="Serveurs déconnectés"
                icon={
                  <ShieldCheck className="h-4 w-4" />
                }
              />
            </div>

            {/* ERROR */}
            {error && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <p className="text-sm text-destructive">
                  {error}
                </p>
              </div>
            )}

            {/* SERVERS */}
            <div className="space-y-4">
              {loading ? (
                <LoadingCard />
              ) : servers.length === 0 ? (
                <EmptyServers />
              ) : (
                servers.map(
                  (server) => (
                    <ServerCard
                      key={server.id}
                      server={server}
                    />
                  ),
                )
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

/* -------------------------------- */
/* SERVER CARD                      */
/* -------------------------------- */

function ServerCard({
  server,
}: {
  server: ServerData
}) {
  const online =
    server.status === "online"

  const metrics =
    server.metrics

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
                online
                  ? "bg-green-500/10"
                  : "bg-red-500/10"
              }`}
            >
              <Server
                className={`h-6 w-6 ${
                  online
                    ? "text-green-500"
                    : "text-red-500"
                }`}
              />
            </div>

            <div>
              <CardTitle>
                {server.name}
              </CardTitle>

              <CardDescription className="mt-1">
                {server.hostname}
              </CardDescription>
            </div>
          </div>

          <Badge
            variant={
              online
                ? "default"
                : "secondary"
            }
            className="w-fit gap-2"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                online
                  ? "bg-green-500"
                  : "bg-red-500"
              }`}
            />

            {online
              ? "Online"
              : "Offline"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">

        {/* METRICS */}
        <div className="grid gap-4 md:grid-cols-3">

          <Metric
            label="CPU"
            value={
              metrics.cpuUsage
            }
            icon={
              <Activity className="h-4 w-4" />
            }
          />

          <Metric
            label="Mémoire"
            value={
              metrics.memoryUsage
            }
            icon={
              <Database className="h-4 w-4" />
            }
            details={
              formatBytes(
                metrics.memoryUsed,
              ) +
              " / " +
              formatBytes(
                metrics.memoryTotal,
              )
            }
          />

          <Metric
            label="Stockage"
            value={
              metrics.diskUsage
            }
            icon={
              <HardDrive className="h-4 w-4" />
            }
            details={
              formatBytes(
                metrics.diskUsed,
              ) +
              " / " +
              formatBytes(
                metrics.diskTotal,
              )
            }
          />
        </div>

        {/* INFO */}
        <div className="grid gap-4 border-t pt-5 text-sm sm:grid-cols-2 lg:grid-cols-4">

          <InfoItem
            label="IP"
            value={
              server.ipAddress
                ? server.ipAddress.replace(
                    "/32",
                    "",
                  )
                : "Non définie"
            }
          />

          <InfoItem
            label="Agent"
            value={
              server.agentVersion ??
              "Inconnu"
            }
          />

          <InfoItem
            label="Uptime"
            value={
              formatUptime(
                metrics.uptimeSeconds,
              )
            }
          />

          <InfoItem
            label="Dernier signal"
            value={
              formatLastSeen(
                server.lastSeenAt,
              )
            }
          />
        </div>

        {/* ACTIONS */}
        <div className="flex items-center justify-end border-t pt-4">
          <Link
            href={`/servers/${server.id}`}
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Gérer le serveur
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

/* -------------------------------- */
/* METRIC                            */
/* -------------------------------- */

function Metric({
  label,
  value,
  icon,
  details,
}: {
  label: string
  value: number | null
  icon: React.ReactNode
  details?: string
}) {
  const safeValue =
    value !== null
      ? Math.max(
          0,
          Math.min(100, value),
        )
      : 0

  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <div className="text-muted-foreground">
            {icon}
          </div>

          {label}
        </div>

        <span className="text-sm font-semibold">
          {value !== null
            ? `${value.toFixed(2)}%`
            : "—"}
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${
            safeValue >= 90
              ? "bg-red-500"
              : safeValue >= 75
                ? "bg-yellow-500"
                : "bg-primary"
          }`}
          style={{
            width: `${safeValue}%`,
          }}
        />
      </div>

      {details && (
        <p className="mt-2 text-xs text-muted-foreground">
          {details}
        </p>
      )}
    </div>
  )
}

/* -------------------------------- */
/* STAT CARD                         */
/* -------------------------------- */

function StatCard({
  title,
  value,
  description,
  icon,
}: {
  title: string
  value: string
  description: string
  icon: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">
            {title}
          </p>

          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </div>
        </div>

        <div className="mt-4">
          <p className="text-3xl font-semibold">
            {value}
          </p>

          <p className="mt-1 text-xs text-muted-foreground">
            {description}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

/* -------------------------------- */
/* INFO ITEM                         */
/* -------------------------------- */

function InfoItem({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">
        {label}
      </p>

      <p className="mt-1 truncate font-medium">
        {value}
      </p>
    </div>
  )
}

/* -------------------------------- */
/* NAV ITEM                          */
/* -------------------------------- */

function NavItem({
  href,
  icon,
  label,
  active = false,
}: {
  href: string
  icon: React.ReactNode
  label: string
  active?: boolean
}) {
  return (
    <Link
      href={href}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </Link>
  )
}

/* -------------------------------- */
/* EMPTY                             */
/* -------------------------------- */

function EmptyServers() {
  return (
    <Card>
      <CardContent className="flex min-h-64 items-center justify-center">
        <div className="text-center">
          <Server className="mx-auto h-10 w-10 text-muted-foreground" />

          <p className="mt-4 font-medium">
            Aucun serveur
          </p>

          <p className="mt-1 text-sm text-muted-foreground">
            Ajoutez votre premier serveur pour commencer.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

/* -------------------------------- */
/* LOADING                           */
/* -------------------------------- */

function LoadingCard() {
  return (
    <Card>
      <CardContent className="flex min-h-48 items-center justify-center">
        <div className="text-center">
          <Activity className="mx-auto h-8 w-8 animate-pulse text-muted-foreground" />

          <p className="mt-3 text-sm text-muted-foreground">
            Chargement des serveurs...
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

/* -------------------------------- */
/* HELPERS                           */
/* -------------------------------- */

function formatBytes(
  bytes: number | null,
) {
  if (
    bytes === null ||
    !Number.isFinite(bytes)
  ) {
    return "—"
  }

  if (bytes === 0) {
    return "0 B"
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB",
  ]

  const index = Math.floor(
    Math.log(bytes) /
      Math.log(1024),
  )

  const safeIndex =
    Math.min(
      index,
      units.length - 1,
    )

  return `${(
    bytes /
    Math.pow(
      1024,
      safeIndex,
    )
  ).toFixed(2)} ${units[safeIndex]}`
}

function formatUptime(
  seconds: number | null,
) {
  if (
    seconds === null ||
    !Number.isFinite(seconds)
  ) {
    return "—"
  }

  const days = Math.floor(
    seconds / 86400,
  )

  const hours = Math.floor(
    (seconds % 86400) /
      3600,
  )

  const minutes = Math.floor(
    (seconds % 3600) /
      60,
  )

  if (days > 0) {
    return `${days}j ${hours}h`
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  return `${minutes}m`
}

function formatLastSeen(
  date: string | null,
) {
  if (!date) {
    return "Jamais"
  }

  const timestamp =
    new Date(date).getTime()

  if (
    Number.isNaN(timestamp)
  ) {
    return "Inconnu"
  }

  const diff =
    Math.floor(
      (Date.now() -
        timestamp) /
        1000,
    )

  if (diff < 10) {
    return "À l'instant"
  }

  if (diff < 60) {
    return `Il y a ${diff}s`
  }

  const minutes =
    Math.floor(
      diff / 60,
    )

  if (minutes < 60) {
    return `Il y a ${minutes} min`
  }

  const hours =
    Math.floor(
      minutes / 60,
    )

  return `Il y a ${hours}h`
}

function GlobeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
      />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}