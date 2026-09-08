"use client"

import {
  Activity,
  ArrowLeft,
  Clock,
  Cpu,
  Globe,
  HardDrive,
  KeyRound,
  MemoryStick,
  RefreshCw,
  Server,
  ShieldCheck,
} from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  useCallback,
  useEffect,
  useState,
} from "react"

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

function formatBytes(bytes: number | null) {
  if (bytes === null || bytes === 0) {
    return "—"
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB",
  ]

  const index = Math.floor(
    Math.log(bytes) / Math.log(1024),
  )

  const value =
    bytes / Math.pow(1024, index)

  return `${value.toFixed(2)} ${units[index]}`
}

function formatUptime(
  seconds: number | null,
) {
  if (seconds === null) {
    return "—"
  }

  const days = Math.floor(
    seconds / 86400,
  )

  const hours = Math.floor(
    (seconds % 86400) / 3600,
  )

  const minutes = Math.floor(
    (seconds % 3600) / 60,
  )

  if (days > 0) {
    return `${days}j ${hours}h`
  }

  if (hours > 0) {
    return `${hours}h ${minutes}min`
  }

  return `${minutes} min`
}

function formatLastSeen(
  date: string | null,
) {
  if (!date) {
    return "Jamais"
  }

  const diff =
    Date.now() -
    new Date(date).getTime()

  const seconds = Math.floor(
    diff / 1000,
  )

  if (seconds < 10) {
    return "À l'instant"
  }

  if (seconds < 60) {
    return `Il y a ${seconds}s`
  }

  const minutes = Math.floor(
    seconds / 60,
  )

  if (minutes < 60) {
    return `Il y a ${minutes}min`
  }

  const hours = Math.floor(
    minutes / 60,
  )

  return `Il y a ${hours}h`
}

function getUsageClass(
  value: number | null,
) {
  if (value === null) {
    return "text-slate-400"
  }

  if (value >= 90) {
    return "text-red-400"
  }

  if (value >= 75) {
    return "text-amber-400"
  }

  return "text-emerald-400"
}

function getProgressClass(
  value: number | null,
) {
  if (value === null) {
    return "bg-slate-700"
  }

  if (value >= 90) {
    return "bg-red-500"
  }

  if (value >= 75) {
    return "bg-amber-500"
  }

  return "bg-emerald-500"
}

function MetricCard({
  title,
  value,
  icon: Icon,
  subtitle,
}: {
  title: string
  value: number | null
  icon: typeof Cpu
  subtitle: string
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800">
            <Icon
              size={19}
              className="text-slate-300"
            />
          </div>

          <span className="text-sm font-medium text-slate-400">
            {title}
          </span>
        </div>

        <span
          className={`text-2xl font-semibold ${getUsageClass(value)}`}
        >
          {value !== null
            ? `${value.toFixed(1)}%`
            : "—"}
        </span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-all ${getProgressClass(value)}`}
          style={{
            width: `${Math.min(
              Math.max(
                value ?? 0,
                0,
              ),
              100,
            )}%`,
          }}
        />
      </div>

      <p className="mt-3 text-xs text-slate-500">
        {subtitle}
      </p>
    </div>
  )
}

function InfoRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800/70 py-3 last:border-0">
      <span className="text-sm text-slate-500">
        {label}
      </span>

      <span className="max-w-[60%] truncate text-right text-sm font-medium text-slate-200">
        {value}
      </span>
    </div>
  )
}

export default function ServerDetailPage() {
  const params = useParams()
  const id = params.id as string

  const [server, setServer] =
    useState<ServerData | null>(null)

  const [loading, setLoading] =
    useState(true)

  const [error, setError] =
    useState<string | null>(null)

  const [refreshing, setRefreshing] =
    useState(false)

  const [
    generatingEnrollment,
    setGeneratingEnrollment,
  ] = useState(false)

  const [
    enrollmentToken,
    setEnrollmentToken,
  ] = useState<string | null>(null)

  const [
    enrollmentError,
    setEnrollmentError,
  ] = useState<string | null>(null)

  const loadServer = useCallback(
    async (manual = false) => {
      try {
        if (manual) {
          setRefreshing(true)
        }

        const response =
          await fetch(
            `/api/servers/${id}`,
            {
              cache: "no-store",
            },
          )

        const data =
          await response.json()

        if (!response.ok) {
          throw new Error(
            data.message ||
              "Impossible de récupérer le serveur.",
          )
        }

        setServer(data.server)
        setError(null)
      } catch (err) {
        console.error(err)

        setError(
          err instanceof Error
            ? err.message
            : "Une erreur est survenue.",
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [id],
  )

  useEffect(() => {
    loadServer()

    const interval =
      setInterval(
        () => {
          loadServer()
        },
        10_000,
      )

    return () =>
      clearInterval(interval)
  }, [loadServer])

  const generateEnrollmentToken =
    async () => {
      try {
        setGeneratingEnrollment(true)
        setEnrollmentError(null)
        setEnrollmentToken(null)

        const response =
          await fetch(
            `/api/servers/${id}/enrollment`,
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },
            },
          )

        const data =
          await response.json()

        if (!response.ok) {
          throw new Error(
            data.message ||
              "Impossible de générer le token d'enrôlement.",
          )
        }

        const token = data.enrollment?.token

        if (!token) {
          throw new Error(
            "Le serveur n'a pas retourné de token.",
          )
        }

        setEnrollmentToken(token)
      } catch (err) {
        console.error(err)

        setEnrollmentError(
          err instanceof Error
            ? err.message
            : "Une erreur est survenue.",
        )
      } finally {
        setGeneratingEnrollment(false)
      }
    }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 p-8 text-white">
        <div className="mx-auto max-w-7xl">
          <div className="h-8 w-64 animate-pulse rounded bg-slate-800" />

          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {[1, 2, 3].map(
              (item) => (
                <div
                  key={item}
                  className="h-36 animate-pulse rounded-2xl bg-slate-900"
                />
              ),
            )}
          </div>
        </div>
      </div>
    )
  }

  if (error || !server) {
    return (
      <div className="min-h-screen bg-slate-950 p-8 text-white">
        <div className="mx-auto max-w-7xl">
          <Link
            href="/servers"
            className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
          >
            <ArrowLeft size={16} />
            Retour aux serveurs
          </Link>

          <div className="rounded-2xl border border-red-900/50 bg-red-950/20 p-6">
            <p className="text-sm text-red-400">
              {error ||
                "Serveur introuvable."}
            </p>
          </div>
        </div>
      </div>
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

  const isOnline =
    server.status === "online"

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-7xl p-6 lg:p-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/servers"
            className="mb-5 inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
          >
            <ArrowLeft size={16} />
            Retour aux serveurs
          </Link>

          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-800">
                  <Server
                    size={21}
                    className="text-slate-300"
                  />
                </div>

                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-semibold">
                      {server.name}
                    </h1>

                    <span
                      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
                        isOnline
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isOnline
                            ? "bg-emerald-400"
                            : "bg-slate-500"
                        }`}
                      />

                      {isOnline
                        ? "En ligne"
                        : "Hors ligne"}
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-slate-500">
                    {server.hostname}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={
                  generateEnrollmentToken
                }
                disabled={
                  generatingEnrollment
                }
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <KeyRound
                  size={16}
                  className={
                    generatingEnrollment
                      ? "animate-pulse"
                      : ""
                  }
                />

                {generatingEnrollment
                  ? "Génération..."
                  : "Générer un token"}
              </button>

              <button
                type="button"
                onClick={() =>
                  loadServer(true)
                }
                disabled={refreshing}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
              >
                <RefreshCw
                  size={16}
                  className={
                    refreshing
                      ? "animate-spin"
                      : ""
                  }
                />

                Actualiser
              </button>
            </div>
          </div>
        </div>

        {/* Enrollment */}
        {enrollmentError && (
          <div className="mb-6 rounded-2xl border border-red-900/50 bg-red-950/20 p-4">
            <p className="text-sm text-red-400">
              {enrollmentError}
            </p>
          </div>
        )}

        {enrollmentToken && (
          <section className="mb-8 rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10">
                <KeyRound
                  size={18}
                  className="text-indigo-400"
                />
              </div>

              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-white">
                  Token d'enrôlement généré
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Ce token est temporaire et
                  doit être utilisé depuis
                  l'Agent du VPS.
                </p>

                <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4">
                  <p className="mb-2 text-xs font-medium text-slate-500">
                    Token
                  </p>

                  <code className="block break-all text-sm text-indigo-300">
                    {enrollmentToken}
                  </code>
                </div>

                <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <p className="text-xs text-amber-400">
                    ⚠️ Ne partage pas ce token.
                    Il est destiné uniquement à
                    l'enrôlement de cet Agent.
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Metrics */}
        <section>
          <div className="mb-4 flex items-center gap-2">
            <Activity
              size={18}
              className="text-slate-400"
            />

            <h2 className="text-lg font-semibold">
              Ressources
            </h2>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            <MetricCard
              title="CPU"
              value={cpuUsage}
              icon={Cpu}
              subtitle="Utilisation actuelle du processeur"
            />

            <MetricCard
              title="Mémoire"
              value={memoryUsage}
              icon={MemoryStick}
              subtitle={
                memoryTotal !== null &&
                memoryUsed !== null
                  ? `${formatBytes(memoryUsed)} / ${formatBytes(memoryTotal)}`
                  : "Données indisponibles"
              }
            />

            <MetricCard
              title="Stockage E:"
              value={diskUsage}
              icon={HardDrive}
              subtitle={
                diskTotal !== null &&
                diskUsed !== null
                  ? `${formatBytes(diskUsed)} / ${formatBytes(diskTotal)}`
                  : "Données indisponibles"
              }
            />
          </div>
        </section>

        {/* Details */}
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {/* System information */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800">
                <Server
                  size={18}
                  className="text-slate-300"
                />
              </div>

              <div>
                <h2 className="font-semibold">
                  Informations système
                </h2>

                <p className="text-xs text-slate-500">
                  Configuration et état de l'Agent
                </p>
              </div>
            </div>

            <div>
              <InfoRow
                label="Hostname"
                value={server.hostname}
              />

              <InfoRow
                label="Adresse IP"
                value={
                  server.ipAddress ||
                  "Non renseignée"
                }
              />

              <InfoRow
                label="Version Agent"
                value={
                  server.agentVersion ||
                  "Inconnue"
                }
              />

              <InfoRow
                label="Uptime"
                value={formatUptime(
                  uptimeSeconds,
                )}
              />

              <InfoRow
                label="Dernier signal"
                value={formatLastSeen(
                  server.lastSeenAt,
                )}
              />
            </div>
          </section>

          {/* Storage */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800">
                <HardDrive
                  size={18}
                  className="text-slate-300"
                />
              </div>

              <div>
                <h2 className="font-semibold">
                  Stockage
                </h2>

                <p className="text-xs text-slate-500">
                  Espace disponible sur le serveur
                </p>
              </div>
            </div>

            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-slate-400">
                  E:
                </span>

                <span
                  className={`font-medium ${getUsageClass(
                    diskUsage,
                  )}`}
                >
                  {diskUsage !== null
                    ? `${diskUsage.toFixed(1)}%`
                    : "—"}
                </span>
              </div>

              <div className="h-3 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full transition-all ${getProgressClass(
                    diskUsage,
                  )}`}
                  style={{
                    width: `${Math.min(
                      Math.max(
                        diskUsage ?? 0,
                        0,
                      ),
                      100,
                    )}%`,
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-slate-950/60 p-4">
                <p className="text-xs text-slate-500">
                  Utilisé
                </p>

                <p className="mt-1 text-lg font-semibold">
                  {formatBytes(
                    diskUsed,
                  )}
                </p>
              </div>

              <div className="rounded-xl bg-slate-950/60 p-4">
                <p className="text-xs text-slate-500">
                  Total
                </p>

                <p className="mt-1 text-lg font-semibold">
                  {formatBytes(
                    diskTotal,
                  )}
                </p>
              </div>
            </div>
          </section>
        </div>

        {/* Status cards */}
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                <ShieldCheck
                  size={18}
                  className="text-emerald-400"
                />
              </div>

              <div>
                <p className="text-xs text-slate-500">
                  Agent
                </p>

                <p className="text-sm font-medium text-emerald-400">
                  Authentifié
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800">
                <Clock
                  size={18}
                  className="text-slate-300"
                />
              </div>

              <div>
                <p className="text-xs text-slate-500">
                  Dernier heartbeat
                </p>

                <p className="text-sm font-medium text-slate-200">
                  {formatLastSeen(
                    server.lastSeenAt,
                  )}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800">
                <Globe
                  size={18}
                  className="text-slate-300"
                />
              </div>

              <div>
                <p className="text-xs text-slate-500">
                  Réseau
                </p>

                <p className="text-sm font-medium text-slate-200">
                  {server.ipAddress ||
                    "Non configuré"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Docker */}
        <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800">
                <Server
                  size={18}
                  className="text-slate-300"
                />
              </div>

              <div>
                <h2 className="font-semibold">
                  Docker
                </h2>

                <p className="text-xs text-slate-500">
                  Gestion des conteneurs du serveur
                </p>
              </div>
            </div>

            <span className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-500">
              Bientôt disponible
            </span>
          </div>

          <div className="mt-5 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-8 text-center">
            <Server
              size={28}
              className="mx-auto text-slate-700"
            />

            <p className="mt-3 text-sm text-slate-500">
              La gestion des conteneurs Docker sera
              disponible ici.
            </p>

            <p className="mt-1 text-xs text-slate-600">
              Démarrer · Arrêter · Redémarrer · Logs
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}