"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import {
  Activity,
  ArrowUpRight,
  Cpu,
  HardDrive,
  MemoryStick,
  Plus,
  Server,
  ShieldCheck,
} from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill } from "@/components/ui/status-pill"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/page-header"
import { cn } from "cn"

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
  const [servers, setServers] = useState<ServerData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadServers = useCallback(async () => {
    try {
      const response = await fetch("/api/servers", { cache: "no-store" })

      if (!response.ok) {
        throw new Error("Impossible de récupérer les serveurs.")
      }

      const data = await response.json()

      if (data.status !== "ok") {
        throw new Error(
          data.message ?? "Impossible de récupérer les serveurs."
        )
      }

      setServers(data.servers ?? [])
      setError(null)
    } catch (error) {
      console.error("Erreur lors du chargement des serveurs :", error)
      setError("Impossible de récupérer les serveurs.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadServers()
    const interval = setInterval(loadServers, 10000)
    return () => clearInterval(interval)
  }, [loadServers])

  const onlineServers = servers.filter((s) => s.status === "online").length
  const offlineServers = servers.filter((s) => s.status === "offline").length

  return (
    <div className="space-y-8">
      <PageHeader
        title="Serveurs"
        description="Surveillez l'état et les ressources de votre infrastructure."
        actions={
          <Link
            href="/servers/new"
            className={cn(buttonVariants({ variant: "primary" }))}
          >
            <Plus />
            Ajouter un serveur
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Serveurs"
          value={loading ? "—" : servers.length}
          hint="Serveurs enregistrés"
          icon={<Server />}
        />
        <StatCard
          label="En ligne"
          value={loading ? "—" : onlineServers}
          hint="Serveurs opérationnels"
          icon={<Activity />}
        />
        <StatCard
          label="Hors ligne"
          value={loading ? "—" : offlineServers}
          hint="Serveurs déconnectés"
          icon={<ShieldCheck />}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {loading ? (
          <div className="h-56 animate-pulse rounded-xl border border-border bg-muted/50" />
        ) : servers.length === 0 ? (
          <Card>
            <CardContent className="py-4">
              <EmptyState
                icon={<Server />}
                title="Aucun serveur"
                description="Ajoutez votre premier serveur pour commencer."
                action={
                  <Link
                    href="/servers/new"
                    className={cn(
                      buttonVariants({ variant: "primary", size: "sm" })
                    )}
                  >
                    <Plus />
                    Ajouter un serveur
                  </Link>
                }
              />
            </CardContent>
          </Card>
        ) : (
          servers.map((server) => (
            <ServerCard key={server.id} server={server} />
          ))
        )}
      </div>
    </div>
  )
}

function ServerCard({ server }: { server: ServerData }) {
  const online = server.status === "online"
  const metrics = server.metrics

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="flex items-center gap-4">
          <span
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5",
              online
                ? "bg-success/10 text-success"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Server />
          </span>

          <div>
            <CardTitle>{server.name}</CardTitle>
            <CardDescription className="mt-1 font-mono text-xs">
              {server.hostname}
            </CardDescription>
          </div>
        </div>

        <StatusPill tone={online ? "success" : "neutral"}>
          {online ? "En ligne" : "Hors ligne"}
        </StatusPill>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <Metric
            label="CPU"
            value={metrics.cpuUsage}
            icon={<Cpu />}
          />
          <Metric
            label="Mémoire"
            value={metrics.memoryUsage}
            icon={<MemoryStick />}
            details={`${formatBytes(metrics.memoryUsed)} / ${formatBytes(
              metrics.memoryTotal
            )}`}
          />
          <Metric
            label="Stockage"
            value={metrics.diskUsage}
            icon={<HardDrive />}
            details={`${formatBytes(metrics.diskUsed)} / ${formatBytes(
              metrics.diskTotal
            )}`}
          />
        </div>

        <div className="grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <InfoItem
            label="Adresse IP"
            value={
              server.ipAddress
                ? server.ipAddress.replace("/32", "")
                : "Non définie"
            }
          />
          <InfoItem label="Agent" value={server.agentVersion ?? "Inconnu"} />
          <InfoItem
            label="Uptime"
            value={formatUptime(metrics.uptimeSeconds)}
          />
          <InfoItem
            label="Dernier signal"
            value={formatLastSeen(server.lastSeenAt)}
          />
        </div>

        <div className="flex items-center justify-end border-t border-border pt-4">
          <Link
            href={`/servers/${server.id}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Gérer le serveur
            <ArrowUpRight className="size-4" />
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

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
    value !== null ? Math.max(0, Math.min(100, value)) : 0

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
          {label}
        </div>
        <span className="text-sm font-semibold tabular">
          {value !== null ? `${value.toFixed(1)}%` : "—"}
        </span>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            safeValue >= 90
              ? "bg-danger"
              : safeValue >= 75
                ? "bg-warning"
                : "bg-foreground/70"
          )}
          style={{ width: `${safeValue}%` }}
        />
      </div>

      {details && (
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          {details}
        </p>
      )}
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-medium">{value}</p>
    </div>
  )
}

function formatBytes(bytes: number | null) {
  if (bytes === null || !Number.isFinite(bytes)) {
    return "—"
  }

  if (bytes === 0) {
    return "0 B"
  }

  const units = ["B", "KB", "MB", "GB", "TB"]
  const index = Math.floor(Math.log(bytes) / Math.log(1024))
  const safeIndex = Math.min(index, units.length - 1)

  return `${(bytes / Math.pow(1024, safeIndex)).toFixed(2)} ${units[safeIndex]}`
}

function formatUptime(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) {
    return "—"
  }

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) {
    return `${days}j ${hours}h`
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  return `${minutes}m`
}

function formatLastSeen(date: string | null) {
  if (!date) {
    return "Jamais"
  }

  const timestamp = new Date(date).getTime()

  if (Number.isNaN(timestamp)) {
    return "Inconnu"
  }

  const diff = Math.floor((Date.now() - timestamp) / 1000)

  if (diff < 10) {
    return "À l'instant"
  }

  if (diff < 60) {
    return `Il y a ${diff}s`
  }

  const minutes = Math.floor(diff / 60)

  if (minutes < 60) {
    return `Il y a ${minutes} min`
  }

  const hours = Math.floor(minutes / 60)

  return `Il y a ${hours}h`
}
