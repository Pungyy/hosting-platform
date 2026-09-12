"use client"

import { useEffect, useState } from "react"
import { Archive, Database, Download, HardDrive, Trash2 } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { StatusPill } from "@/components/ui/status-pill"
import { StatCard } from "@/components/ui/stat-card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/page-header"

type Backup = {
  id: string
  database_id: string
  filename: string
  size_bytes: string | null
  status: string
  error_message: string | null
  created_at: string
  database_name: string
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

export default function BackupsPage() {
  const [backups, setBackups] = useState<Backup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadBackups = async () => {
    try {
      const response = await fetch("/api/backups", { cache: "no-store" })
      const data = await response.json()

      if (!response.ok || data.status !== "ok") {
        throw new Error(
          data.message ?? "Impossible de récupérer les sauvegardes."
        )
      }

      setBackups(data.backups ?? [])
      setError(null)
    } catch (err) {
      console.error("Erreur lors du chargement des sauvegardes :", err)
      setError(
        err instanceof Error
          ? err.message
          : "Impossible de récupérer les sauvegardes."
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBackups()
    const interval = setInterval(loadBackups, 15000)
    return () => clearInterval(interval)
  }, [])

  const deleteBackup = async (backup: Backup) => {
    const confirmed = window.confirm(
      `Supprimer la sauvegarde de « ${backup.database_name} » du ${new Date(
        backup.created_at
      ).toLocaleString("fr-FR")} ?`
    )

    if (!confirmed) {
      return
    }

    setDeletingId(backup.id)

    try {
      const response = await fetch(
        `/api/databases/${backup.database_id}/backups/${backup.id}`,
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
      setDeletingId(null)
    }
  }

  const completedBackups = backups.filter((b) => b.status === "completed")

  const totalBytes = completedBackups.reduce(
    (sum, b) => sum + (b.size_bytes !== null ? Number(b.size_bytes) : 0),
    0
  )

  const databaseCount = new Set(backups.map((b) => b.database_id)).size

  return (
    <div className="space-y-8">
      <PageHeader
        title="Sauvegardes"
        description="Toutes les sauvegardes de bases de données, toutes bases confondues."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Sauvegardes"
          value={loading ? "—" : backups.length}
          hint="Terminées, en cours ou en échec"
          icon={<Archive />}
        />
        <StatCard
          label="Espace utilisé"
          value={loading ? "—" : formatBytes(totalBytes)}
          hint="Sauvegardes terminées"
          icon={<HardDrive />}
        />
        <StatCard
          label="Bases concernées"
          value={loading ? "—" : databaseCount}
          hint="Bases avec au moins une sauvegarde"
          icon={<Database />}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Toutes les sauvegardes</CardTitle>
          <CardDescription>
            Pour créer une nouvelle sauvegarde, passez par la page de la base
            de données concernée.
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
          ) : backups.length === 0 ? (
            <EmptyState
              icon={<Archive />}
              title="Aucune sauvegarde"
              description="Créez une sauvegarde depuis la page d'une base de données pour la voir apparaître ici."
            />
          ) : (
            <div className="space-y-2.5">
              {backups.map((backup) => {
                const status = backupStatus(backup.status)
                const busy = deletingId === backup.id

                return (
                  <div
                    key={backup.id}
                    className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
                        <Archive />
                      </span>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium">
                            {backup.database_name}
                          </p>
                          <StatusPill tone={status.tone}>
                            {status.label}
                          </StatusPill>
                        </div>

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            {new Date(backup.created_at).toLocaleString(
                              "fr-FR"
                            )}
                          </span>
                          <span>
                            {formatBytes(
                              backup.size_bytes !== null
                                ? Number(backup.size_bytes)
                                : null
                            )}
                          </span>
                          {backup.error_message && (
                            <span className="text-danger">
                              {backup.error_message}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {backup.status === "completed" && (
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={`/api/databases/${backup.database_id}/backups/${backup.id}/download`}
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
        </CardContent>
      </Card>
    </div>
  )
}
