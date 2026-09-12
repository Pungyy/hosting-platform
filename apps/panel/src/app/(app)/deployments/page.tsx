"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import {
  CheckCircle2,
  Clock,
  Rocket,
  XCircle,
} from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { StatCard } from "@/components/ui/stat-card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/page-header"
import { cn } from "cn"

type Deployment = {
  id: string
  site_id: string
  commit_sha: string | null
  branch: string | null
  status: string
  started_at: string | null
  finished_at: string | null
  created_at: string
  image_name: string | null
  container_name: string | null
  site_name: string
}

export default function DeploymentsPage() {
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadDeployments = async () => {
    try {
      const response = await fetch("/api/deployments", {
        cache: "no-store",
      })
      const data = await response.json()

      if (!response.ok || data.status !== "ok") {
        throw new Error(
          data.message ?? "Impossible de récupérer les déploiements.",
        )
      }

      setDeployments(data.deployments ?? [])
      setError(null)
    } catch (err) {
      console.error("Erreur lors du chargement des déploiements :", err)
      setError(
        err instanceof Error ? err.message : "Une erreur est survenue.",
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDeployments()
    const interval = setInterval(loadDeployments, 10000)
    return () => clearInterval(interval)
  }, [])

  const successCount = deployments.filter(
    (d) => d.status === "success",
  ).length

  const failedCount = deployments.filter(
    (d) => d.status === "failed",
  ).length

  const runningCount = deployments.filter(
    (d) => d.status === "running" || d.status === "pending",
  ).length

  return (
    <div className="space-y-8">
      <PageHeader
        title="Déploiements"
        description="Historique de tous les déploiements, tous sites confondus."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Réussis"
          value={loading ? "—" : successCount}
          hint="Déploiements réussis"
          icon={<CheckCircle2 />}
        />
        <StatCard
          label="Échoués"
          value={loading ? "—" : failedCount}
          hint="Déploiements en échec"
          icon={<XCircle />}
        />
        <StatCard
          label="En cours"
          value={loading ? "—" : runningCount}
          hint="Déploiements actifs"
          icon={<Clock />}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Historique</CardTitle>
          <CardDescription>
            Les {deployments.length > 0 ? deployments.length : ""} derniers
            déploiements. Pour en déclencher un nouveau, ouvrez un site puis
            « Déployer ».
          </CardDescription>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="space-y-2.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-[86px] animate-pulse rounded-lg border border-border bg-muted/50"
                />
              ))}
            </div>
          ) : deployments.length === 0 ? (
            <EmptyState
              icon={<Rocket />}
              title="Aucun déploiement"
              description="Les déploiements effectués depuis vos sites apparaîtront ici."
            />
          ) : (
            <div className="space-y-2.5">
              {deployments.map((deployment) => (
                <DeploymentRow
                  key={deployment.id}
                  deployment={deployment}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function DeploymentRow({ deployment }: { deployment: Deployment }) {
  const status = deployment.status
  const commit = deployment.commit_sha
    ? deployment.commit_sha.slice(0, 8)
    : "--------"

  return (
    <Link
      href={`/sites/${deployment.site_id}`}
      className="flex flex-col gap-4 rounded-lg border border-border p-4 transition-colors hover:bg-muted/40 lg:flex-row lg:items-center lg:justify-between"
    >
      <div className="flex min-w-0 items-center gap-4">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg]:size-5",
            status === "success"
              ? "bg-success/10 text-success"
              : status === "failed"
                ? "bg-danger/10 text-danger"
                : status === "running"
                  ? "bg-warning/10 text-warning-foreground"
                  : "bg-muted text-muted-foreground",
          )}
        >
          <StatusIcon status={status} />
        </span>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{deployment.site_name}</p>
            <span className="rounded-full border border-border px-1.5 py-px font-mono text-xs text-muted-foreground">
              {commit}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{formatDeploymentStatus(status)}</span>
            <span>Branche : {deployment.branch ?? "inconnue"}</span>
            <span>{formatDate(deployment.created_at)}</span>
          </div>
        </div>
      </div>

      {deployment.image_name && (
        <span
          className="max-w-xs truncate font-mono text-xs text-muted-foreground"
          title={deployment.image_name}
        >
          {deployment.image_name}
        </span>
      )}
    </Link>
  )
}

function StatusIcon({ status }: { status: string }) {
  if (status === "success") {
    return <CheckCircle2 className="size-5" />
  }

  if (status === "failed") {
    return <XCircle className="size-5" />
  }

  if (status === "running") {
    return <Spinner className="size-5 text-current" />
  }

  return <Clock className="size-5" />
}

function formatDeploymentStatus(status: string) {
  switch (status) {
    case "success":
      return "Succès"
    case "failed":
      return "Échec"
    case "running":
      return "En cours"
    case "pending":
      return "En attente"
    case "cancelled":
      return "Annulé"
    default:
      return status
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("fr-FR")
}
