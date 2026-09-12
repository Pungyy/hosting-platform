"use client"

import { FormEvent, useEffect, useState } from "react"
import {
  Archive,
  Check,
  ChevronDown,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Play,
  Plus,
  RefreshCw,
  Server,
  Square,
  Terminal,
  Trash2,
} from "lucide-react"

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
import { StatCard } from "@/components/ui/stat-card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/page-header"
import { siteStatus } from "@/lib/status"
import { cn } from "cn"

type DatabaseItem = {
  id: string
  name: string
  engine: string
  container_name: string
  container_id: string | null
  image: string
  status: string
  database_name: string
  username: string
  internal_host: string
  internal_port: number
  created_at: string
  server_id: string
}

type DatabasesResponse = {
  status: "ok" | "error"
  databases?: DatabaseItem[]
  message?: string
}

type CreateDatabaseResponse = {
  status: "ok" | "error"
  database?: DatabaseItem
  message?: string
}

type DatabaseDetail = DatabaseItem & { password: string }

type Action = "start" | "stop" | "restart"

type Backup = {
  id: string
  database_id: string
  filename: string
  size_bytes: string | null
  status: string
  error_message: string | null
  created_at: string
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

function backupStatus(status: string): {
  label: string
  tone: "success" | "warning" | "danger"
} {
  switch (status) {
    case "completed":
      return { label: "Terminée", tone: "success" }
    case "failed":
      return { label: "Échec", tone: "danger" }
    default:
      return { label: "En cours…", tone: "warning" }
  }
}

export default function DatabasesPage() {
  const [databases, setDatabases] = useState<DatabaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const loadDatabases = async (showRefreshLoader = false) => {
    if (showRefreshLoader) {
      setRefreshing(true)
    }

    try {
      const response = await fetch("/api/databases", { cache: "no-store" })
      const data = (await response.json()) as DatabasesResponse

      if (!response.ok || data.status !== "ok") {
        throw new Error(
          data.message ?? "Impossible de récupérer les bases de données."
        )
      }

      setDatabases(data.databases ?? [])
      setError(null)
    } catch (err) {
      console.error("Erreur lors du chargement des bases de données :", err)
      setError(
        err instanceof Error
          ? err.message
          : "Impossible de récupérer les bases de données."
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadDatabases()

    const interval = setInterval(() => {
      loadDatabases()
    }, 30000)

    return () => clearInterval(interval)
  }, [])

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmed = name.trim().toLowerCase()

    if (!trimmed) {
      setError("Veuillez saisir un nom de base de données.")
      return
    }

    setCreating(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch("/api/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, engine: "postgres" }),
      })

      const data = (await response.json()) as CreateDatabaseResponse

      if (!response.ok || data.status !== "ok" || !data.database) {
        throw new Error(
          data.message ?? "Impossible de créer la base de données."
        )
      }

      setSuccess(`La base de données « ${data.database.name} » a été créée.`)
      setName("")
      setShowCreateForm(false)

      await loadDatabases()
    } catch (err) {
      console.error("Erreur lors de la création de la base de données :", err)
      setError(
        err instanceof Error
          ? err.message
          : "Impossible de créer la base de données."
      )
    } finally {
      setCreating(false)
    }
  }

  const onlineCount = databases.filter((db) => db.status === "online").length

  return (
    <div className="space-y-8">
      <PageHeader
        title="Bases de données"
        description="Provisionnez des bases de données isolées pour vos applications."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => loadDatabases(true)}
              disabled={refreshing}
            >
              <RefreshCw className={cn(refreshing && "animate-spin")} />
              Actualiser
            </Button>

            <Button
              onClick={() => {
                setShowCreateForm(!showCreateForm)
                setError(null)
                setSuccess(null)
              }}
            >
              <Plus />
              Créer une base
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Bases de données"
          value={loading ? "—" : databases.length}
          hint="Toutes bases confondues"
          icon={<Database />}
        />
        <StatCard
          label="En ligne"
          value={loading ? "—" : onlineCount}
          hint="Containers actifs"
          icon={<Play />}
        />
        <StatCard
          label="Moteur"
          value="PostgreSQL"
          hint="Seul moteur disponible pour l'instant"
          icon={<Server />}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-success/25 bg-success/5 px-4 py-3 text-sm text-success">
          {success}
        </div>
      )}

      {showCreateForm && (
        <Card>
          <CardHeader>
            <CardTitle>Créer une base de données</CardTitle>
            <CardDescription>
              Un container PostgreSQL isolé sera créé, accessible uniquement
              depuis le réseau interne des sites.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleCreate} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="database-name" className="text-sm font-medium">
                  Nom de la base
                </label>

                <Input
                  id="database-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="ma-base"
                  disabled={creating}
                  autoComplete="off"
                />

                <p className="text-xs text-muted-foreground">
                  3 à 40 caractères. Lettres minuscules, chiffres et tirets
                  uniquement.
                </p>
              </div>

              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3.5">
                <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
                  <Database />
                </span>
                <div>
                  <p className="text-sm font-medium">Moteur</p>
                  <p className="text-xs text-muted-foreground">
                    PostgreSQL 16
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowCreateForm(false)
                    setError(null)
                  }}
                  disabled={creating}
                >
                  Annuler
                </Button>

                <Button type="submit" disabled={creating || !name.trim()}>
                  {creating ? <Spinner className="text-current" /> : <Plus />}
                  {creating ? "Création…" : "Créer la base"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Toutes les bases de données</CardTitle>
          <CardDescription>
            {databases.length} base{databases.length !== 1 ? "s" : ""} de
            données provisionnée{databases.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="space-y-2.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-[74px] animate-pulse rounded-lg border border-border bg-muted/50"
                />
              ))}
            </div>
          ) : databases.length === 0 ? (
            <EmptyState
              icon={<Database />}
              title="Aucune base de données"
              description="Créez votre première base pour la connecter à une application."
              action={
                <Button size="sm" onClick={() => setShowCreateForm(true)}>
                  <Plus />
                  Créer une base
                </Button>
              }
            />
          ) : (
            <div className="space-y-2.5">
              {databases.map((database) => (
                <DatabaseRow
                  key={database.id}
                  database={database}
                  onChanged={loadDatabases}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function DatabaseRow({
  database,
  onChanged,
}: {
  database: DatabaseItem
  onChanged: () => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<DatabaseDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const [showLogs, setShowLogs] = useState(false)
  const [logs, setLogs] = useState("")
  const [logsLoading, setLogsLoading] = useState(false)

  const [actionLoading, setActionLoading] = useState<Action | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [backups, setBackups] = useState<Backup[]>([])
  const [backupsLoading, setBackupsLoading] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [backupDeletingId, setBackupDeletingId] = useState<string | null>(
    null
  )

  const status = siteStatus(database.status)
  const online = database.status === "online"

  const loadDetail = async () => {
    setDetailLoading(true)
    setDetailError(null)

    try {
      const response = await fetch(`/api/databases/${database.id}`, {
        cache: "no-store",
      })
      const data = await response.json()

      if (!response.ok || data.status !== "ok") {
        throw new Error(
          data.message ?? "Impossible de récupérer les identifiants."
        )
      }

      setDetail(data.database)
    } catch (err) {
      setDetailError(
        err instanceof Error
          ? err.message
          : "Impossible de récupérer les identifiants."
      )
    } finally {
      setDetailLoading(false)
    }
  }

  const loadBackups = async () => {
    setBackupsLoading(true)

    try {
      const response = await fetch(`/api/databases/${database.id}/backups`, {
        cache: "no-store",
      })
      const data = await response.json()

      if (response.ok && data.status === "ok") {
        setBackups(data.backups ?? [])
      }
    } catch (err) {
      console.error("Erreur lors du chargement des sauvegardes :", err)
    } finally {
      setBackupsLoading(false)
    }
  }

  const toggleExpanded = () => {
    const next = !expanded
    setExpanded(next)

    if (next && !detail && !detailLoading) {
      loadDetail()
    }

    if (next && backups.length === 0 && !backupsLoading) {
      loadBackups()
    }
  }

  const createBackup = async () => {
    setBackingUp(true)
    setBackupError(null)

    try {
      const response = await fetch(`/api/databases/${database.id}/backups`, {
        method: "POST",
      })

      const data = await response.json()

      if (!response.ok || data.status !== "ok") {
        throw new Error(data.message ?? "Impossible de créer la sauvegarde.")
      }

      await loadBackups()
    } catch (err) {
      setBackupError(
        err instanceof Error
          ? err.message
          : "Impossible de créer la sauvegarde."
      )
    } finally {
      setBackingUp(false)
    }
  }

  const deleteBackup = async (backup: Backup) => {
    const confirmed = window.confirm(
      `Supprimer la sauvegarde du ${new Date(
        backup.created_at
      ).toLocaleString("fr-FR")} ?`
    )

    if (!confirmed) {
      return
    }

    setBackupDeletingId(backup.id)

    try {
      const response = await fetch(
        `/api/databases/${database.id}/backups/${backup.id}`,
        { method: "DELETE" }
      )

      const data = await response.json()

      if (!response.ok || data.status !== "ok") {
        throw new Error(
          data.message ?? "Impossible de supprimer la sauvegarde."
        )
      }

      await loadBackups()
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Impossible de supprimer la sauvegarde."
      )
    } finally {
      setBackupDeletingId(null)
    }
  }

  const copyValue = async (value: string, field: string) => {
    await navigator.clipboard.writeText(value)
    setCopied(field)
    setTimeout(() => setCopied((current) => (current === field ? null : current)), 2000)
  }

  const loadLogs = async () => {
    setLogsLoading(true)

    try {
      const response = await fetch(`/api/databases/${database.id}/logs`, {
        cache: "no-store",
      })
      const data = await response.json()

      if (response.ok && data.status === "ok") {
        setLogs(data.logs ?? "")
      }
    } catch (err) {
      console.error("Erreur lors du chargement des logs :", err)
    } finally {
      setLogsLoading(false)
    }
  }

  const toggleLogs = () => {
    const next = !showLogs
    setShowLogs(next)

    if (next) {
      loadLogs()
    }
  }

  const executeAction = async (action: Action) => {
    setActionLoading(action)

    try {
      const response = await fetch(`/api/databases/${database.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })

      const data = await response.json()

      if (!response.ok || data.status !== "ok") {
        throw new Error(data.message ?? "Impossible d'exécuter l'action.")
      }

      await onChanged()

      if (showLogs) {
        await loadLogs()
      }
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "Une erreur est survenue."
      )
    } finally {
      setActionLoading(null)
    }
  }

  const handleDelete = async () => {
    const confirmed = window.confirm(
      `Voulez-vous vraiment supprimer la base « ${database.name} » ?\n\nCette action supprimera définitivement le container et son volume de données.`
    )

    if (!confirmed) {
      return
    }

    setDeleting(true)

    try {
      const response = await fetch(`/api/databases/${database.id}`, {
        method: "DELETE",
      })

      const data = await response.json()

      if (!response.ok || data.status !== "ok") {
        throw new Error(
          data.message ?? "Impossible de supprimer la base de données."
        )
      }

      await onChanged()
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "Une erreur est survenue."
      )
      setDeleting(false)
    }
  }

  return (
    <div className="rounded-lg border border-border transition-colors hover:bg-muted/20">
      <button
        type="button"
        onClick={toggleExpanded}
        className="flex w-full flex-col gap-4 p-4 text-left sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-4">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg]:size-5",
              status.tone === "success"
                ? "bg-success/10 text-success"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Database />
          </span>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{database.name}</p>
              <StatusPill tone={status.tone}>{status.label}</StatusPill>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 font-mono">
                {database.internal_host}:{database.internal_port}
              </span>
              <span>PostgreSQL</span>
            </div>
          </div>
        </div>

        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>

      {expanded && (
        <div className="space-y-5 border-t border-border p-4">
          <div>
            <p className="mb-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              Connexion
            </p>

            {detailLoading ? (
              <div className="flex min-h-16 items-center justify-center">
                <Spinner className="size-5" />
              </div>
            ) : detailError ? (
              <p className="text-sm text-danger">{detailError}</p>
            ) : detail ? (
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                <ConnectionRow label="Hôte interne" value={detail.internal_host} />
                <ConnectionRow
                  label="Port"
                  value={String(detail.internal_port)}
                />
                <ConnectionRow label="Base" value={detail.database_name} />
                <ConnectionRow label="Utilisateur" value={detail.username} />
                <div className="flex flex-col gap-1.5 bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
                      <KeyRound />
                    </span>
                    <span className="text-sm font-medium">Mot de passe</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <code className="break-all font-mono text-xs text-muted-foreground">
                      {showPassword
                        ? detail.password
                        : "•".repeat(Math.min(detail.password.length, 24))}
                    </code>

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setShowPassword(!showPassword)}
                      title={showPassword ? "Masquer" : "Afficher"}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => copyValue(detail.password, "password")}
                      title="Copier"
                    >
                      {copied === "password" ? <Check /> : <Copy />}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div>
            <p className="mb-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              Gestion
            </p>

            <div className="flex flex-wrap gap-2.5">
              <Button
                onClick={() => executeAction("start")}
                disabled={online || actionLoading !== null || deleting}
              >
                {actionLoading === "start" ? (
                  <Spinner className="text-current" />
                ) : (
                  <Play />
                )}
                Démarrer
              </Button>

              <Button
                variant="secondary"
                onClick={() => executeAction("stop")}
                disabled={!online || actionLoading !== null || deleting}
              >
                {actionLoading === "stop" ? (
                  <Spinner className="text-current" />
                ) : (
                  <Square />
                )}
                Arrêter
              </Button>

              <Button
                variant="secondary"
                onClick={() => executeAction("restart")}
                disabled={actionLoading !== null || deleting}
              >
                {actionLoading === "restart" ? (
                  <Spinner className="text-current" />
                ) : (
                  <RefreshCw />
                )}
                Redémarrer
              </Button>

              <Button variant="secondary" onClick={toggleLogs}>
                <Terminal />
                {showLogs ? "Masquer les logs" : "Voir les logs"}
              </Button>

              <Button
                variant="secondary"
                onClick={createBackup}
                disabled={!online || backingUp || deleting}
                title={
                  online
                    ? undefined
                    : "La base doit être en ligne pour être sauvegardée."
                }
              >
                {backingUp ? (
                  <Spinner className="text-current" />
                ) : (
                  <Archive />
                )}
                {backingUp ? "Sauvegarde…" : "Sauvegarder"}
              </Button>

              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting || actionLoading !== null}
              >
                {deleting ? <Spinner className="text-current" /> : <Trash2 />}
                Supprimer
              </Button>
            </div>
          </div>

          {showLogs && (
            <div className="overflow-auto rounded-lg border border-border bg-zinc-950 p-4">
              <pre className="min-h-32 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-300">
                {logsLoading
                  ? "Chargement des logs…"
                  : logs || "Aucun log disponible."}
              </pre>
            </div>
          )}

          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                Sauvegardes
              </p>

              <Button variant="ghost" size="icon-sm" onClick={loadBackups}>
                <RefreshCw className={cn(backupsLoading && "animate-spin")} />
              </Button>
            </div>

            {backupError && (
              <p className="mb-2.5 text-sm text-danger">{backupError}</p>
            )}

            {backupsLoading && backups.length === 0 ? (
              <div className="flex min-h-16 items-center justify-center">
                <Spinner className="size-5" />
              </div>
            ) : backups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucune sauvegarde pour l&apos;instant.
              </p>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {backups.map((backup) => {
                  const backupStatusInfo = backupStatus(backup.status)
                  const busy = backupDeletingId === backup.id

                  return (
                    <div
                      key={backup.id}
                      className="flex flex-col gap-2 bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
                          <Archive />
                        </span>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium">
                              {new Date(backup.created_at).toLocaleString(
                                "fr-FR"
                              )}
                            </p>
                            <StatusPill tone={backupStatusInfo.tone}>
                              {backupStatusInfo.label}
                            </StatusPill>
                          </div>

                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatBytes(
                              backup.size_bytes !== null
                                ? Number(backup.size_bytes)
                                : null
                            )}
                            {backup.error_message
                              ? ` · ${backup.error_message}`
                              : ""}
                          </p>
                        </div>
                      </div>

                      {backup.status === "completed" && (
                        <div className="flex gap-2">
                          <a
                            href={`/api/databases/${database.id}/backups/${backup.id}/download`}
                            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[0.8125rem] font-medium shadow-xs transition-colors hover:bg-muted [&_svg]:size-3.5"
                          >
                            <Download />
                            Télécharger
                          </a>

                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => deleteBackup(backup)}
                            disabled={busy}
                          >
                            {busy ? (
                              <Spinner className="text-current" />
                            ) : (
                              <Trash2 />
                            )}
                            Supprimer
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ConnectionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm font-medium">{label}</span>
      <span className="break-all font-mono text-xs text-muted-foreground">
        {value}
      </span>
    </div>
  )
}
