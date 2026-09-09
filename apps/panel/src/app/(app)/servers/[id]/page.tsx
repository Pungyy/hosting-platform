"use client"

import {
  Activity,
  Clock,
  Cpu,
  Globe,
  HardDrive,
  KeyRound,
  MemoryStick,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Square,
  Terminal,
  TriangleAlert,
  X,
} from "lucide-react"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { StatusPill } from "@/components/ui/status-pill"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/page-header"
import { siteStatus } from "@/lib/status"
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
}

type SiteStatus = {
  name: string | null
  containerId: string
  containerName: string | null
  status: string
  running: boolean
}

type DockerInfo = {
  version: string
  containers: { total: number; running: number }
}

function formatBytes(bytes: number | null) {
  if (bytes === null || bytes === 0) {
    return "—"
  }

  const units = ["B", "KB", "MB", "GB", "TB"]
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  )
  const value = bytes / Math.pow(1024, index)

  return `${value.toFixed(2)} ${units[index]}`
}

function formatUptime(seconds: number | null) {
  if (seconds === null) {
    return "—"
  }

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) {
    return `${days}j ${hours}h`
  }

  if (hours > 0) {
    return `${hours}h ${minutes}min`
  }

  return `${minutes} min`
}

function formatLastSeen(date: string | null) {
  if (!date) {
    return "Jamais"
  }

  const diff = Date.now() - new Date(date).getTime()
  const seconds = Math.floor(diff / 1000)

  if (seconds < 10) {
    return "À l'instant"
  }

  if (seconds < 60) {
    return `Il y a ${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) {
    return `Il y a ${minutes}min`
  }

  const hours = Math.floor(minutes / 60)

  return `Il y a ${hours}h`
}

function usageColor(value: number | null) {
  if (value === null) {
    return "text-muted-foreground"
  }

  if (value >= 90) {
    return "text-danger"
  }

  if (value >= 75) {
    return "text-warning-foreground"
  }

  return "text-foreground"
}

function progressColor(value: number | null) {
  if (value === null) {
    return "bg-border"
  }

  if (value >= 90) {
    return "bg-danger"
  }

  if (value >= 75) {
    return "bg-warning"
  }

  return "bg-foreground/70"
}

function MetricCard({
  title,
  value,
  icon,
  subtitle,
}: {
  title: string
  value: number | null
  icon: React.ReactNode
  subtitle: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
            {icon}
          </span>
          <span className="text-sm font-medium text-muted-foreground">
            {title}
          </span>
        </div>

        <span className={cn("text-2xl font-semibold tabular", usageColor(value))}>
          {value !== null ? `${value.toFixed(1)}%` : "—"}
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            progressColor(value)
          )}
          style={{
            width: `${Math.min(Math.max(value ?? 0, 0), 100)}%`,
          }}
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="max-w-[60%] truncate text-right text-sm font-medium">
        {value}
      </span>
    </div>
  )
}

function StatusCard({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone?: "success" | "neutral"
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-9 items-center justify-center rounded-lg [&_svg]:size-4",
            tone === "success"
              ? "bg-success/10 text-success"
              : "bg-muted text-muted-foreground"
          )}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p
            className={cn(
              "truncate text-sm font-medium",
              tone === "success" && "text-success"
            )}
          >
            {value}
          </p>
        </div>
      </div>
    </div>
  )
}

export default function ServerDetailPage() {
  const params = useParams()
  const id = params.id as string

  const [server, setServer] = useState<ServerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [dockerInfo, setDockerInfo] = useState<DockerInfo | null>(null)
  const [sites, setSites] = useState<SiteStatus[]>([])
  const [dockerLoading, setDockerLoading] = useState(true)
  const [dockerError, setDockerError] = useState<string | null>(null)
  const [siteActionLoading, setSiteActionLoading] = useState<string | null>(null)
  const [logs, setLogs] = useState<{ site: string; content: string } | null>(
    null
  )
  const [logsLoading, setLogsLoading] = useState<string | null>(null)
  const [showCreateSite, setShowCreateSite] = useState(false)
  const [newSiteName, setNewSiteName] = useState("")
  const [creatingSite, setCreatingSite] = useState(false)
  const [createSiteError, setCreateSiteError] = useState<string | null>(null)
  const [generatingEnrollment, setGeneratingEnrollment] = useState(false)
  const [enrollmentToken, setEnrollmentToken] = useState<string | null>(null)
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null)

  const loadServer = useCallback(
    async (manual = false) => {
      try {
        if (manual) {
          setRefreshing(true)
        }

        const response = await fetch(`/api/servers/${id}`, {
          cache: "no-store",
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(
            data.message || "Impossible de récupérer le serveur."
          )
        }

        setServer(data.server)
        setError(null)
      } catch (err) {
        console.error(err)
        setError(
          err instanceof Error ? err.message : "Une erreur est survenue."
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [id]
  )

  const loadDocker = useCallback(async () => {
    try {
      setDockerLoading(true)
      setDockerError(null)

      const [dockerResponse, sitesResponse] = await Promise.all([
        fetch(`/api/servers/${id}/docker`, { cache: "no-store" }),
        fetch(`/api/servers/${id}/sites`, { cache: "no-store" }),
      ])

      const dockerData = await dockerResponse.json()
      const sitesData = await sitesResponse.json()

      if (!dockerResponse.ok) {
        throw new Error(
          dockerData.message || "Impossible de récupérer Docker."
        )
      }

      if (!sitesResponse.ok) {
        throw new Error(
          sitesData.message || "Impossible de récupérer les sites."
        )
      }

      setDockerInfo(dockerData.docker)
      setSites(sitesData.sites ?? [])
    } catch (err) {
      console.error(err)
      setDockerError(
        err instanceof Error
          ? err.message
          : "Impossible de récupérer les informations Docker."
      )
    } finally {
      setDockerLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadServer()
    const interval = setInterval(() => loadServer(), 10_000)
    return () => clearInterval(interval)
  }, [loadServer])

  useEffect(() => {
    loadDocker()
    const interval = setInterval(() => loadDocker(), 10_000)
    return () => clearInterval(interval)
  }, [loadDocker])

  const executeSiteAction = async (
    siteName: string,
    action: "start" | "stop" | "restart"
  ) => {
    try {
      setSiteActionLoading(`${siteName}:${action}`)
      setDockerError(null)

      const response = await fetch(
        `/api/servers/${id}/sites/${encodeURIComponent(siteName)}/action`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || "Impossible d'exécuter l'action.")
      }

      await loadDocker()
    } catch (err) {
      console.error(err)
      setDockerError(
        err instanceof Error
          ? err.message
          : "Impossible d'exécuter l'action."
      )
    } finally {
      setSiteActionLoading(null)
    }
  }

  const loadSiteLogs = async (siteName: string) => {
    try {
      setLogsLoading(siteName)
      setDockerError(null)

      const response = await fetch(
        `/api/servers/${id}/sites/${encodeURIComponent(siteName)}/logs`,
        { cache: "no-store" }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || "Impossible de récupérer les logs.")
      }

      setLogs({ site: siteName, content: data.logs ?? "" })
    } catch (err) {
      console.error(err)
      setDockerError(
        err instanceof Error
          ? err.message
          : "Impossible de récupérer les logs."
      )
    } finally {
      setLogsLoading(null)
    }
  }

  const createSite = async () => {
    const name = newSiteName.trim().toLowerCase()

    if (!name) {
      setCreateSiteError("Entrez un nom de site.")
      return
    }

    try {
      setCreatingSite(true)
      setCreateSiteError(null)

      const response = await fetch(`/api/servers/${id}/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || "Impossible de créer le site.")
      }

      setNewSiteName("")
      setShowCreateSite(false)
      await loadDocker()
    } catch (err) {
      console.error(err)
      setCreateSiteError(
        err instanceof Error ? err.message : "Impossible de créer le site."
      )
    } finally {
      setCreatingSite(false)
    }
  }

  const generateEnrollmentToken = async () => {
    try {
      setGeneratingEnrollment(true)
      setEnrollmentError(null)
      setEnrollmentToken(null)

      const response = await fetch(`/api/servers/${id}/enrollment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(
          data.message || "Impossible de générer le token d'enrôlement."
        )
      }

      const token = data.enrollment?.token

      if (!token) {
        throw new Error("Le serveur n'a pas retourné de token.")
      }

      setEnrollmentToken(token)
    } catch (err) {
      console.error(err)
      setEnrollmentError(
        err instanceof Error ? err.message : "Une erreur est survenue."
      )
    } finally {
      setGeneratingEnrollment(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-56 animate-pulse rounded-lg bg-muted" />
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl border border-border bg-muted/50"
            />
          ))}
        </div>
      </div>
    )
  }

  if (error || !server) {
    return (
      <PageHeader
        back={{ href: "/servers", label: "Retour aux serveurs" }}
        title="Serveur introuvable"
        description={error || "Ce serveur n'existe pas."}
      />
    )
  }

  const {
    cpuUsage,
    memoryUsage,
    diskUsage,
    memoryTotal,
    memoryUsed,
    diskTotal,
    diskUsed,
    uptimeSeconds,
  } = server.metrics

  const isOnline = server.status === "online"

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ href: "/servers", label: "Retour aux serveurs" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {server.name}
            <StatusPill tone={isOnline ? "success" : "neutral"}>
              {isOnline ? "En ligne" : "Hors ligne"}
            </StatusPill>
          </span>
        }
        description={
          <span className="font-mono text-xs">{server.hostname}</span>
        }
        actions={
          <>
            <Button
              variant="brand"
              onClick={generateEnrollmentToken}
              disabled={generatingEnrollment}
            >
              <KeyRound />
              {generatingEnrollment ? "Génération…" : "Générer un token"}
            </Button>

            <Button
              variant="secondary"
              onClick={() => loadServer(true)}
              disabled={refreshing}
            >
              <RefreshCw className={cn(refreshing && "animate-spin")} />
              Actualiser
            </Button>
          </>
        }
      />

      {enrollmentError && (
        <div className="rounded-lg border border-danger/25 bg-danger/5 p-4 text-sm text-danger">
          {enrollmentError}
        </div>
      )}

      {enrollmentToken && (
        <Card className="border-brand/30 bg-brand/5">
          <CardContent className="flex items-start gap-4 py-6">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand [&_svg]:size-4">
              <KeyRound />
            </span>

            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">
                Token d'enrôlement généré
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Ce token est temporaire et doit être utilisé depuis l'Agent du
                VPS.
              </p>

              <code className="mt-4 block break-all rounded-lg border border-border bg-card p-3 font-mono text-xs text-brand">
                {enrollmentToken}
              </code>

              <div className="mt-4 flex gap-3 rounded-lg border border-warning/25 bg-warning/5 p-3 text-xs text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
                Ne partagez pas ce token. Il est destiné uniquement à
                l'enrôlement de cet Agent.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* RESOURCES */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Ressources</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard
            title="CPU"
            value={cpuUsage}
            icon={<Cpu />}
            subtitle="Utilisation actuelle du processeur"
          />
          <MetricCard
            title="Mémoire"
            value={memoryUsage}
            icon={<MemoryStick />}
            subtitle={
              memoryTotal !== null && memoryUsed !== null
                ? `${formatBytes(memoryUsed)} / ${formatBytes(memoryTotal)}`
                : "Données indisponibles"
            }
          />
          <MetricCard
            title="Stockage"
            value={diskUsage}
            icon={<HardDrive />}
            subtitle={
              diskTotal !== null && diskUsed !== null
                ? `${formatBytes(diskUsed)} / ${formatBytes(diskTotal)}`
                : "Données indisponibles"
            }
          />
        </div>
      </section>

      {/* SYSTEM + STORAGE */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Informations système</CardTitle>
            <CardDescription>
              Configuration et état de l'Agent.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <InfoRow label="Hostname" value={server.hostname} />
            <InfoRow
              label="Adresse IP"
              value={server.ipAddress || "Non renseignée"}
            />
            <InfoRow
              label="Version Agent"
              value={server.agentVersion || "Inconnue"}
            />
            <InfoRow label="Uptime" value={formatUptime(uptimeSeconds)} />
            <InfoRow
              label="Dernier signal"
              value={formatLastSeen(server.lastSeenAt)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stockage</CardTitle>
            <CardDescription>Espace disponible sur le serveur.</CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Disque</span>
                <span
                  className={cn("font-medium tabular", usageColor(diskUsage))}
                >
                  {diskUsage !== null ? `${diskUsage.toFixed(1)}%` : "—"}
                </span>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-border">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    progressColor(diskUsage)
                  )}
                  style={{
                    width: `${Math.min(Math.max(diskUsage ?? 0, 0), 100)}%`,
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground">Utilisé</p>
                <p className="mt-1 text-lg font-semibold tabular">
                  {formatBytes(diskUsed)}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="mt-1 text-lg font-semibold tabular">
                  {formatBytes(diskTotal)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* STATUS */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatusCard
          icon={<ShieldCheck />}
          label="Agent"
          value="Authentifié"
          tone="success"
        />
        <StatusCard
          icon={<Clock />}
          label="Dernier heartbeat"
          value={formatLastSeen(server.lastSeenAt)}
        />
        <StatusCard
          icon={<Globe />}
          label="Réseau"
          value={server.ipAddress || "Non configuré"}
        />
      </div>

      {/* DOCKER */}
      <Card>
        <CardHeader className="flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1.5">
            <CardTitle>Docker</CardTitle>
            <CardDescription>
              Gestion des conteneurs du serveur.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {dockerInfo && (
              <>
                <span className="rounded-md border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  Docker {dockerInfo.version}
                </span>
                <span className="rounded-md border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  {dockerInfo.containers.running} actifs
                </span>
                <span className="rounded-md border border-border bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                  {dockerInfo.containers.total} conteneurs
                </span>
              </>
            )}

            <Button
              variant="brand"
              size="sm"
              onClick={() => setShowCreateSite(true)}
              disabled={!isOnline}
            >
              <Plus />
              Créer un site
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {dockerError && (
            <div className="rounded-lg border border-danger/25 bg-danger/5 p-4 text-sm text-danger">
              {dockerError}
            </div>
          )}

          {showCreateSite && (
            <div className="rounded-lg border border-brand/25 bg-brand/5 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-medium">Créer un site</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Un container Docker sera créé automatiquement sur ce VPS.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowCreateSite(false)
                    setCreateSiteError(null)
                  }}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="mt-4 space-y-2">
                <label
                  htmlFor="site-name"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Nom du site
                </label>
                <Input
                  id="site-name"
                  value={newSiteName}
                  onChange={(event) => setNewSiteName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      createSite()
                    }
                  }}
                  placeholder="mon-site"
                  disabled={creatingSite}
                />
                <p className="text-xs text-muted-foreground">
                  Lettres minuscules, chiffres et tirets uniquement.
                </p>
              </div>

              {createSiteError && (
                <div className="mt-4 rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-xs text-danger">
                  {createSiteError}
                </div>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setShowCreateSite(false)
                    setCreateSiteError(null)
                  }}
                  disabled={creatingSite}
                >
                  Annuler
                </Button>

                <Button
                  variant="brand"
                  size="sm"
                  onClick={createSite}
                  disabled={creatingSite || !newSiteName.trim()}
                >
                  {creatingSite ? (
                    <Spinner className="text-current" />
                  ) : (
                    <Plus />
                  )}
                  {creatingSite ? "Création…" : "Créer le site"}
                </Button>
              </div>
            </div>
          )}

          {dockerLoading ? (
            <div className="flex min-h-32 items-center justify-center rounded-lg border border-border bg-muted/30">
              <div className="text-center">
                <Spinner className="mx-auto size-5" />
                <p className="mt-3 text-sm text-muted-foreground">
                  Récupération des conteneurs…
                </p>
              </div>
            </div>
          ) : sites.length === 0 ? (
            <EmptyState
              icon={<Server />}
              title="Aucun site géré par la plateforme"
              description="Créez votre premier site avec le bouton ci-dessus."
            />
          ) : (
            <div className="space-y-2.5">
              {sites.map((site) => {
                const siteName =
                  site.name || site.containerName || "Site sans nom"

                const startLoading =
                  siteActionLoading === `${siteName}:start`
                const stopLoading = siteActionLoading === `${siteName}:stop`
                const restartLoading =
                  siteActionLoading === `${siteName}:restart`
                const currentLogsLoading = logsLoading === siteName

                return (
                  <div
                    key={site.containerId || siteName}
                    className="rounded-lg border border-border p-4"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-medium">
                            {siteName}
                          </h3>
                          <StatusPill
                            tone={
                              site.running
                                ? "success"
                                : siteStatus(site.status).tone
                            }
                          >
                            {site.running
                              ? "En ligne"
                              : siteStatus(site.status).label}
                          </StatusPill>
                        </div>

                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
                          {site.containerName && (
                            <span>Container : {site.containerName}</span>
                          )}
                          <span>ID : {site.containerId.slice(0, 12)}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {!site.running && (
                          <Button
                            size="sm"
                            onClick={() =>
                              executeSiteAction(siteName, "start")
                            }
                            disabled={siteActionLoading !== null}
                          >
                            {startLoading ? (
                              <Spinner className="text-current" />
                            ) : (
                              <Play />
                            )}
                            Démarrer
                          </Button>
                        )}

                        {site.running && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() =>
                              executeSiteAction(siteName, "stop")
                            }
                            disabled={siteActionLoading !== null}
                          >
                            {stopLoading ? (
                              <Spinner className="text-current" />
                            ) : (
                              <Square />
                            )}
                            Arrêter
                          </Button>
                        )}

                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            executeSiteAction(siteName, "restart")
                          }
                          disabled={siteActionLoading !== null}
                        >
                          {restartLoading ? (
                            <Spinner className="text-current" />
                          ) : (
                            <RotateCcw />
                          )}
                          Redémarrer
                        </Button>

                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => loadSiteLogs(siteName)}
                          disabled={logsLoading !== null}
                        >
                          {currentLogsLoading ? (
                            <Spinner className="text-current" />
                          ) : (
                            <Terminal />
                          )}
                          Logs
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {logs && (
            <div className="overflow-hidden rounded-lg border border-border bg-zinc-950">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Terminal className="size-4 text-zinc-400" />
                  <span className="text-sm font-medium text-zinc-200">
                    Logs — {logs.site}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setLogs(null)}
                  className="inline-flex items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-white"
                >
                  <X className="size-3.5" />
                  Fermer
                </button>
              </div>

              <pre className="max-h-[400px] overflow-auto p-4 font-mono text-xs leading-5 text-zinc-300">
                {logs.content || "Aucun log disponible."}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
