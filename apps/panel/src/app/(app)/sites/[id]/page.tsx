"use client"

import { useEffect, useState } from "react"
import {
  Box,
  Calendar,
  CheckCircle2,
  Clock,
  Container,
  ExternalLink,
  GitBranch,
  Globe,
  HardDrive,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Server,
  ShieldCheck,
  Square,
  Star,
  Trash2,
  XCircle,
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
import { StatusPill, type Tone } from "@/components/ui/status-pill"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/page-header"
import { siteStatus } from "@/lib/status"
import { cn } from "cn"

type Site = {
  id: string
  name: string
  container_name: string
  container_id: string | null
  image: string
  status: string
  created_at: string
  server_id: string
  server_name: string | null
  server_hostname: string | null
}

type SiteResponse = {
  status: "ok" | "error"
  site?: Site
  message?: string
}

type Deployment = {
  id: string
  site_id: string
  commit_sha: string | null
  branch: string | null
  status: string
  started_at: string | null
  finished_at: string | null
  logs: string | null
  created_at: string
  image_name: string | null
  image_id: string | null
  container_name: string | null
  container_id: string | null
}

type DeploymentsResponse = {
  status: "ok" | "error"
  deployments?: Deployment[]
  message?: string
}

type Domain = {
  id: string
  site_id: string
  domain: string
  is_primary: boolean
  ssl_enabled: boolean
  created_at: string
  updated_at: string
}

type DomainsResponse = {
  status: "ok" | "error"
  domains?: Domain[]
  message?: string
}

type Action = "start" | "stop" | "restart"

export default function SitePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [site, setSite] = useState<Site | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<Action | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [logs, setLogs] = useState("")
  const [logsLoading, setLogsLoading] = useState(true)
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [deploymentsLoading, setDeploymentsLoading] = useState(true)
  const [domains, setDomains] = useState<Domain[]>([])
  const [domainsLoading, setDomainsLoading] = useState(true)
  const [domainInput, setDomainInput] = useState("")
  const [addingDomain, setAddingDomain] = useState(false)
  const [domainActionLoading, setDomainActionLoading] = useState<string | null>(
    null
  )
  const [siteId, setSiteId] = useState<string | null>(null)

  const loadSite = async () => {
    try {
      const { id } = await params
      setSiteId(id)

      const response = await fetch(`/api/sites/${id}`, { cache: "no-store" })
      const data = (await response.json()) as SiteResponse

      if (!response.ok || data.status !== "ok") {
        throw new Error(data.message ?? "Impossible de récupérer le site.")
      }

      setSite(data.site ?? null)
      setError(null)
    } catch (error) {
      console.error("Erreur lors du chargement du site :", error)
      setError(
        error instanceof Error ? error.message : "Une erreur est survenue."
      )
    } finally {
      setLoading(false)
    }
  }

  const loadLogs = async () => {
    try {
      const { id } = await params
      const response = await fetch(`/api/sites/${id}/logs`, {
        cache: "no-store",
      })
      const data = await response.json()

      if (response.ok && data.status === "ok") {
        setLogs(data.logs ?? "")
      }
    } catch (error) {
      console.error("Erreur lors du chargement des logs :", error)
    } finally {
      setLogsLoading(false)
    }
  }

  const loadDeployments = async () => {
    try {
      const { id } = await params
      const response = await fetch(`/api/sites/${id}/deployments`, {
        cache: "no-store",
      })
      const data = (await response.json()) as DeploymentsResponse

      if (!response.ok || data.status !== "ok") {
        throw new Error(
          data.message ?? "Impossible de récupérer les déploiements."
        )
      }

      setDeployments(data.deployments ?? [])
    } catch (error) {
      console.error("Erreur lors du chargement des déploiements :", error)
    } finally {
      setDeploymentsLoading(false)
    }
  }

  const loadDomains = async () => {
    try {
      const { id } = await params
      const response = await fetch(`/api/sites/${id}/domains`, {
        cache: "no-store",
      })
      const data = (await response.json()) as DomainsResponse

      if (!response.ok || data.status !== "ok") {
        throw new Error(data.message ?? "Impossible de récupérer les domaines.")
      }

      setDomains(data.domains ?? [])
    } catch (error) {
      console.error("Erreur lors du chargement des domaines :", error)
    } finally {
      setDomainsLoading(false)
    }
  }

  const addDomain = async () => {
    if (!siteId || addingDomain) {
      return
    }

    const domain = domainInput.trim().toLowerCase()

    if (!domain) {
      return
    }

    setAddingDomain(true)

    try {
      const response = await fetch(`/api/sites/${siteId}/domains`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      })

      const data = await response.json()

      if (!response.ok || data.status !== "ok") {
        throw new Error(data.message ?? "Impossible d'ajouter le domaine.")
      }

      setDomainInput("")
      await loadDomains()
    } catch (error) {
      console.error("Erreur lors de l'ajout du domaine :", error)
      alert(
        error instanceof Error
          ? error.message
          : "Impossible d'ajouter le domaine."
      )
    } finally {
      setAddingDomain(false)
    }
  }

  const setPrimaryDomain = async (domainId: string) => {
    if (!siteId || domainActionLoading) {
      return
    }

    setDomainActionLoading(domainId)

    try {
      const response = await fetch(
        `/api/sites/${siteId}/domains/${domainId}`,
        { method: "PATCH" }
      )

      const data = await response.json()

      if (!response.ok || data.status !== "ok") {
        throw new Error(
          data.message ?? "Impossible de modifier le domaine principal."
        )
      }

      await loadDomains()
    } catch (error) {
      console.error(
        "Erreur lors de la modification du domaine principal :",
        error
      )
      alert(
        error instanceof Error
          ? error.message
          : "Impossible de modifier le domaine."
      )
    } finally {
      setDomainActionLoading(null)
    }
  }

  const toggleDomainSsl = async (domainId: string, sslEnabled: boolean) => {
    if (!siteId || domainActionLoading) {
      return
    }

    setDomainActionLoading(domainId)

    try {
      const response = await fetch(
        `/api/sites/${siteId}/domains/${domainId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sslEnabled }),
        }
      )

      const data = await response.json()

      if (!response.ok || data.status !== "ok") {
        throw new Error(
          data.message ?? "Impossible de modifier le SSL du domaine."
        )
      }

      await loadDomains()
    } catch (error) {
      console.error("Erreur lors de la modification du SSL :", error)
      alert(
        error instanceof Error
          ? error.message
          : "Impossible de modifier le SSL du domaine."
      )
    } finally {
      setDomainActionLoading(null)
    }
  }

  const deleteDomain = async (domainId: string, domain: string) => {
    if (!siteId || domainActionLoading) {
      return
    }

    const confirmed = window.confirm(`Supprimer le domaine « ${domain} » ?`)

    if (!confirmed) {
      return
    }

    setDomainActionLoading(domainId)

    try {
      const response = await fetch(
        `/api/sites/${siteId}/domains/${domainId}`,
        { method: "DELETE" }
      )

      const data = await response.json()

      if (!response.ok || data.status !== "ok") {
        throw new Error(data.message ?? "Impossible de supprimer le domaine.")
      }

      await loadDomains()
    } catch (error) {
      console.error("Erreur lors de la suppression du domaine :", error)
      alert(
        error instanceof Error
          ? error.message
          : "Impossible de supprimer le domaine."
      )
    } finally {
      setDomainActionLoading(null)
    }
  }

  useEffect(() => {
    loadSite()
    const interval = setInterval(loadSite, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    loadLogs()
    const interval = setInterval(loadLogs, 2000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    loadDeployments()
    const interval = setInterval(loadDeployments, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    loadDomains()
    const interval = setInterval(loadDomains, 5000)
    return () => clearInterval(interval)
  }, [])

  const executeDeploy = async () => {
    if (!siteId || deploying) {
      return
    }

    setDeploying(true)
    setError(null)

    try {
      const response = await fetch(`/api/sites/${siteId}/deploy`, {
        method: "POST",
      })

      const data = await response.json()

      if (!response.ok || data.status !== "ok") {
        throw new Error(data.message ?? "Le déploiement a échoué.")
      }

      await Promise.all([loadSite(), loadDeployments(), loadLogs()])
    } catch (error) {
      console.error("Erreur lors du déploiement :", error)
      setError(
        error instanceof Error ? error.message : "Le déploiement a échoué."
      )
      await loadDeployments()
      await loadSite()
    } finally {
      setDeploying(false)
    }
  }

  const executeAction = async (action: Action) => {
    if (!siteId) {
      return
    }

    setActionLoading(action)

    try {
      const response = await fetch(`/api/sites/${siteId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message ?? "Impossible d'exécuter l'action.")
      }

      await loadSite()
      await loadLogs()
    } catch (error) {
      console.error("Erreur lors de l'action :", error)
      alert(
        error instanceof Error ? error.message : "Une erreur est survenue."
      )
    } finally {
      setActionLoading(null)
    }
  }

  const handleDelete = async () => {
    if (!siteId || !site) {
      return
    }

    const confirmed = window.confirm(
      `Voulez-vous vraiment supprimer le site « ${site.name} » ?\n\nCette action supprimera le container Docker et le site de la base de données.`
    )

    if (!confirmed) {
      return
    }

    setDeleteLoading(true)

    try {
      const response = await fetch(`/api/sites/${siteId}`, {
        method: "DELETE",
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message ?? "Impossible de supprimer le site.")
      }

      window.location.href = "/"
    } catch (error) {
      console.error("Erreur lors de la suppression :", error)
      alert(
        error instanceof Error ? error.message : "Une erreur est survenue."
      )
      setDeleteLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl border border-border bg-muted/50"
            />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl border border-border bg-muted/50" />
      </div>
    )
  }

  if (error || !site) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Site introuvable"
          description={error ?? "Ce site n'existe pas."}
          back={{ href: "/sites", label: "Retour aux sites" }}
        />
      </div>
    )
  }

  const online = site.status === "online" || site.status === "running"
  const isDeploying = site.status === "deploying" || deploying

  const primaryDomain =
    domains.find((domain) => domain.is_primary) ?? domains[0] ?? null

  const hostname = primaryDomain?.domain ?? `${site.name}.localhost`
  const createdAt = new Date(site.created_at).toLocaleString("fr-FR")
  const latestDeployment = deployments[0] ?? null

  const resolved = siteStatus(site.status)
  const statusTone: Tone = isDeploying ? "warning" : resolved.tone
  const statusLabel = isDeploying ? "Déploiement…" : resolved.label

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ href: "/sites", label: "Retour aux sites" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {site.name}
            <StatusPill tone={statusTone} pulse={isDeploying}>
              {statusLabel}
            </StatusPill>
          </span>
        }
        description={
          <span className="font-mono text-xs">{site.container_name}</span>
        }
        actions={
          <>
            <Button
              onClick={executeDeploy}
              disabled={deploying || deleteLoading}
            >
              {deploying ? <Spinner className="text-current" /> : <Rocket />}
              {deploying ? "Déploiement…" : "Déployer"}
            </Button>

            <a
              href={`http://${hostname}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium shadow-xs transition-colors hover:bg-muted"
            >
              Ouvrir le site
              <ExternalLink className="size-4" />
            </a>
          </>
        }
      />

      {/* INFO */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <InfoCard icon={<Globe />} label="Domaine" value={hostname} mono />
        <InfoCard icon={<Box />} label="Image Docker" value={site.image} mono />
        <InfoCard
          icon={<Server />}
          label="Serveur"
          value={site.server_name ?? site.server_hostname ?? "Inconnu"}
        />
        <InfoCard icon={<Calendar />} label="Créé le" value={createdAt} />
      </div>

      {/* DOMAINES */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Domaines</CardTitle>
            <CardDescription>
              Gérez les domaines associés à ce site.
            </CardDescription>
          </div>

          <Button variant="secondary" size="sm" onClick={loadDomains}>
            <RefreshCw />
            Actualiser
          </Button>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={domainInput}
              onChange={(event) => setDomainInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  addDomain()
                }
              }}
              placeholder="example.com"
              disabled={addingDomain}
            />

            <Button
              onClick={addDomain}
              disabled={addingDomain || !domainInput.trim()}
              className="sm:w-auto"
            >
              {addingDomain ? <Spinner className="text-current" /> : <Plus />}
              Ajouter
            </Button>
          </div>

          {domainsLoading ? (
            <div className="flex min-h-24 items-center justify-center">
              <Spinner className="size-5" />
            </div>
          ) : domains.length === 0 ? (
            <EmptyState
              icon={<Globe />}
              title="Aucun domaine"
              description="Ajoutez un domaine pour commencer."
            />
          ) : (
            <div className="space-y-2.5">
              {domains.map((domain) => {
                const busy = domainActionLoading === domain.id

                return (
                  <div
                    key={domain.id}
                    className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
                        <Globe />
                      </span>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium">
                            {domain.domain}
                          </p>
                          {domain.is_primary && (
                            <StatusPill tone="brand">
                              <Star className="size-3 fill-current" />
                              Principal
                            </StatusPill>
                          )}
                        </div>

                        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <ShieldCheck
                            className={cn(
                              "size-3.5",
                              domain.ssl_enabled && "text-success"
                            )}
                          />
                          {domain.ssl_enabled ? "SSL activé" : "SSL désactivé"}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {!domain.is_primary && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setPrimaryDomain(domain.id)}
                          disabled={busy}
                        >
                          {busy ? (
                            <Spinner className="text-current" />
                          ) : (
                            <Star />
                          )}
                          Principal
                        </Button>
                      )}

                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          toggleDomainSsl(domain.id, !domain.ssl_enabled)
                        }
                        disabled={busy}
                      >
                        {busy ? (
                          <Spinner className="text-current" />
                        ) : (
                          <ShieldCheck
                            className={cn(domain.ssl_enabled && "text-success")}
                          />
                        )}
                        {domain.ssl_enabled ? "Désactiver SSL" : "Activer SSL"}
                      </Button>

                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deleteDomain(domain.id, domain.domain)}
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
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* DERNIER DEPLOIEMENT */}
      <Card>
        <CardHeader>
          <CardTitle>Dernier déploiement</CardTitle>
          <CardDescription>État du dernier déploiement GitHub.</CardDescription>
        </CardHeader>

        <CardContent>
          {deploymentsLoading ? (
            <div className="flex min-h-24 items-center justify-center">
              <Spinner className="size-5" />
            </div>
          ) : !latestDeployment ? (
            <EmptyState
              icon={<Rocket />}
              title="Aucun déploiement"
              description="Ce site n'a encore jamais été déployé."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <DeploymentInfo
                icon={<StatusIcon status={latestDeployment.status} />}
                label="Statut"
                value={formatDeploymentStatus(latestDeployment.status)}
              />
              <DeploymentInfo
                icon={<GitBranch className="size-4" />}
                label="Branche"
                value={latestDeployment.branch ?? "Inconnue"}
              />
              <DeploymentInfo
                icon={<Box className="size-4" />}
                label="Commit"
                value={
                  latestDeployment.commit_sha
                    ? latestDeployment.commit_sha.slice(0, 8)
                    : "Non disponible"
                }
                mono
              />
              <DeploymentInfo
                icon={<Clock className="size-4" />}
                label="Date"
                value={formatDate(latestDeployment.created_at)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* GESTION */}
      <Card>
        <CardHeader>
          <CardTitle>Gestion du site</CardTitle>
          <CardDescription>
            Contrôlez directement le container Docker.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="flex flex-wrap gap-2.5">
            <Button
              onClick={() => executeAction("start")}
              disabled={
                online ||
                isDeploying ||
                actionLoading !== null ||
                deleteLoading
              }
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
              disabled={
                !online ||
                isDeploying ||
                actionLoading !== null ||
                deleteLoading
              }
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
              disabled={
                isDeploying || actionLoading !== null || deleteLoading
              }
            >
              {actionLoading === "restart" ? (
                <Spinner className="text-current" />
              ) : (
                <RefreshCw />
              )}
              Redémarrer
            </Button>

            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={
                deleteLoading || actionLoading !== null || isDeploying
              }
            >
              {deleteLoading ? (
                <Spinner className="text-current" />
              ) : (
                <Trash2 />
              )}
              Supprimer
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* CONTAINER */}
      <Card>
        <CardHeader>
          <CardTitle>Container Docker</CardTitle>
          <CardDescription>
            Informations techniques du container.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            <DetailRow
              icon={<Container className="size-4" />}
              label="Nom du container"
              value={site.container_name}
            />
            <DetailRow
              icon={<HardDrive className="size-4" />}
              label="Container ID"
              value={site.container_id ?? "Non disponible"}
            />
            <DetailRow
              icon={<Box className="size-4" />}
              label="Image"
              value={site.image}
            />
            <DetailRow
              icon={<Server className="size-4" />}
              label="Serveur"
              value={site.server_name ?? site.server_hostname ?? "Inconnu"}
            />
          </div>
        </CardContent>
      </Card>

      {/* HISTORIQUE */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Historique des déploiements</CardTitle>
            <CardDescription>
              Tous les déploiements effectués sur ce site.
            </CardDescription>
          </div>

          <Button variant="secondary" size="sm" onClick={loadDeployments}>
            <RefreshCw />
            Actualiser
          </Button>
        </CardHeader>

        <CardContent>
          {deploymentsLoading ? (
            <div className="flex min-h-32 items-center justify-center">
              <Spinner className="size-5" />
            </div>
          ) : deployments.length === 0 ? (
            <EmptyState icon={<Rocket />} title="Aucun historique" />
          ) : (
            <div className="space-y-2.5">
              {deployments.map((deployment) => (
                <DeploymentRow key={deployment.id} deployment={deployment} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* LOGS */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Logs</CardTitle>
            <CardDescription>
              Les 200 dernières lignes du container.
            </CardDescription>
          </div>

          <Button variant="secondary" size="sm" onClick={loadLogs}>
            <RefreshCw />
            Actualiser
          </Button>
        </CardHeader>

        <CardContent>
          <div className="overflow-auto rounded-lg border border-border bg-zinc-950 p-4">
            <pre className="min-h-64 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-300">
              {logsLoading
                ? "Chargement des logs…"
                : logs || "Aucun log disponible."}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function InfoCard({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ReactNode
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
      <div className="flex items-center gap-2 text-muted-foreground [&_svg]:size-4">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>

      <p
        className={cn(
          "mt-2.5 truncate text-sm font-medium",
          mono && "font-mono"
        )}
        title={value}
      >
        {value}
      </p>
    </div>
  )
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex flex-col gap-1.5 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
        <span className="text-sm font-medium">{label}</span>
      </div>

      <span
        className="break-all font-mono text-xs text-muted-foreground sm:max-w-[60%] sm:text-right"
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

function DeploymentInfo({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ReactNode
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 text-muted-foreground [&_svg]:size-4">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>

      <p
        className={cn("mt-2 truncate text-sm font-medium", mono && "font-mono")}
        title={value}
      >
        {value}
      </p>
    </div>
  )
}

function DeploymentRow({ deployment }: { deployment: Deployment }) {
  const status = deployment.status
  const commit = deployment.commit_sha
    ? deployment.commit_sha.slice(0, 8)
    : "--------"

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4 transition-colors hover:bg-muted/40 lg:flex-row lg:items-center lg:justify-between">
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
                  : "bg-muted text-muted-foreground"
          )}
        >
          <StatusIcon status={status} />
        </span>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">
              {formatDeploymentStatus(status)}
            </p>
            <span className="rounded-full border border-border px-1.5 py-px font-mono text-xs text-muted-foreground">
              {commit}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Branche : {deployment.branch ?? "inconnue"}</span>
            <span>{formatDate(deployment.created_at)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground lg:justify-end">
        {deployment.image_name && (
          <span
            className="max-w-xs truncate font-mono"
            title={deployment.image_name}
          >
            {deployment.image_name}
          </span>
        )}

        {deployment.finished_at && deployment.started_at && (
          <span>
            {formatDuration(deployment.started_at, deployment.finished_at)}
          </span>
        )}
      </div>
    </div>
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

function formatDuration(startedAt: string, finishedAt: string) {
  const start = new Date(startedAt).getTime()
  const end = new Date(finishedAt).getTime()
  const seconds = Math.max(0, Math.round((end - start) / 1000))

  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60

  return `${minutes}m ${remaining}s`
}
