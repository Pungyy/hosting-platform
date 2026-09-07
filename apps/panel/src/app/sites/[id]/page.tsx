"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import {
  ArrowLeft,
  Box,
  Calendar,
  CheckCircle2,
  Clock,
  Container,
  ExternalLink,
  Globe,
  Globe2,
  HardDrive,
  Loader2,
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

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

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

type Action =
  | "start"
  | "stop"
  | "restart"

export default function SitePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [site, setSite] =
    useState<Site | null>(null)

  const [loading, setLoading] =
    useState(true)

  const [error, setError] =
    useState<string | null>(null)

  const [actionLoading, setActionLoading] =
    useState<Action | null>(null)

  const [deleteLoading, setDeleteLoading] =
    useState(false)

  const [deploying, setDeploying] =
    useState(false)

  const [logs, setLogs] =
    useState("")

  const [logsLoading, setLogsLoading] =
    useState(true)

  const [deployments, setDeployments] =
    useState<Deployment[]>([])

  const [deploymentsLoading, setDeploymentsLoading] =
    useState(true)

  const [domains, setDomains] =
    useState<Domain[]>([])

  const [domainsLoading, setDomainsLoading] =
    useState(true)

  const [domainInput, setDomainInput] =
    useState("")

  const [addingDomain, setAddingDomain] =
    useState(false)

  const [domainActionLoading, setDomainActionLoading] =
    useState<string | null>(null)

  const [siteId, setSiteId] =
    useState<string | null>(null)

  /*
   * Récupération du site.
   */
  const loadSite = async () => {
    try {
      const { id } = await params

      setSiteId(id)

      const response = await fetch(
        `/api/sites/${id}`,
        {
          cache: "no-store",
        },
      )

      const data =
        (await response.json()) as SiteResponse

      if (
        !response.ok ||
        data.status !== "ok"
      ) {
        throw new Error(
          data.message ??
            "Impossible de récupérer le site.",
        )
      }

      setSite(data.site ?? null)
      setError(null)
    } catch (error) {
      console.error(
        "Erreur lors du chargement du site :",
        error,
      )

      setError(
        error instanceof Error
          ? error.message
          : "Une erreur est survenue.",
      )
    } finally {
      setLoading(false)
    }
  }

  /*
   * Récupération des logs.
   */
  const loadLogs = async () => {
    try {
      const { id } = await params

      const response = await fetch(
        `/api/sites/${id}/logs`,
        {
          cache: "no-store",
        },
      )

      const data =
        await response.json()

      if (
        response.ok &&
        data.status === "ok"
      ) {
        setLogs(
          data.logs ?? "",
        )
      }
    } catch (error) {
      console.error(
        "Erreur lors du chargement des logs :",
        error,
      )
    } finally {
      setLogsLoading(false)
    }
  }

  /*
   * Récupération de l'historique
   * des déploiements.
   */
  const loadDeployments = async () => {
    try {
      const { id } = await params

      const response = await fetch(
        `/api/sites/${id}/deployments`,
        {
          cache: "no-store",
        },
      )

      const data =
        (await response.json()) as DeploymentsResponse

      if (
        !response.ok ||
        data.status !== "ok"
      ) {
        throw new Error(
          data.message ??
            "Impossible de récupérer les déploiements.",
        )
      }

      setDeployments(
        data.deployments ?? [],
      )
    } catch (error) {
      console.error(
        "Erreur lors du chargement des déploiements :",
        error,
      )
    } finally {
      setDeploymentsLoading(false)
    }
  }

  /*
   * Récupération des domaines.
   */
  const loadDomains = async () => {
    try {
      const { id } = await params

      const response = await fetch(
        `/api/sites/${id}/domains`,
        {
          cache: "no-store",
        },
      )

      const data =
        (await response.json()) as DomainsResponse

      if (
        !response.ok ||
        data.status !== "ok"
      ) {
        throw new Error(
          data.message ??
            "Impossible de récupérer les domaines.",
        )
      }

      setDomains(
        data.domains ?? [],
      )
    } catch (error) {
      console.error(
        "Erreur lors du chargement des domaines :",
        error,
      )
    } finally {
      setDomainsLoading(false)
    }
  }

  /*
   * Ajout d'un domaine.
   */
  const addDomain = async () => {
    if (
      !siteId ||
      addingDomain
    ) {
      return
    }

    const domain =
      domainInput
        .trim()
        .toLowerCase()

    if (!domain) {
      return
    }

    setAddingDomain(true)

    try {
      const response =
        await fetch(
          `/api/sites/${siteId}/domains`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              domain,
            }),
          },
        )

      const data =
        await response.json()

      if (
        !response.ok ||
        data.status !== "ok"
      ) {
        throw new Error(
          data.message ??
            "Impossible d'ajouter le domaine.",
        )
      }

      setDomainInput("")

      await loadDomains()
    } catch (error) {
      console.error(
        "Erreur lors de l'ajout du domaine :",
        error,
      )

      alert(
        error instanceof Error
          ? error.message
          : "Impossible d'ajouter le domaine.",
      )
    } finally {
      setAddingDomain(false)
    }
  }

  /*
   * Définir un domaine comme principal.
   */
  const setPrimaryDomain = async (
    domainId: string,
  ) => {
    if (
      !siteId ||
      domainActionLoading
    ) {
      return
    }

    setDomainActionLoading(
      domainId,
    )

    try {
      const response =
        await fetch(
          `/api/sites/${siteId}/domains/${domainId}`,
          {
            method: "PATCH",
          },
        )

      const data =
        await response.json()

      if (
        !response.ok ||
        data.status !== "ok"
      ) {
        throw new Error(
          data.message ??
            "Impossible de modifier le domaine principal.",
        )
      }

      await loadDomains()
    } catch (error) {
      console.error(
        "Erreur lors de la modification du domaine principal :",
        error,
      )

      alert(
        error instanceof Error
          ? error.message
          : "Impossible de modifier le domaine.",
      )
    } finally {
      setDomainActionLoading(null)
    }
  }

  /*
   * Activer / désactiver le SSL d'un domaine.
   */
  const toggleDomainSsl = async (
    domainId: string,
    sslEnabled: boolean,
  ) => {
    if (
      !siteId ||
      domainActionLoading
    ) {
      return
    }

    setDomainActionLoading(domainId)

    try {
      const response =
        await fetch(
          `/api/sites/${siteId}/domains/${domainId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              sslEnabled,
            }),
          },
        )

      const data =
        await response.json()

      if (
        !response.ok ||
        data.status !== "ok"
      ) {
        throw new Error(
          data.message ??
            "Impossible de modifier le SSL du domaine.",
        )
      }

      await loadDomains()
    } catch (error) {
      console.error(
        "Erreur lors de la modification du SSL :",
        error,
      )

      alert(
        error instanceof Error
          ? error.message
          : "Impossible de modifier le SSL du domaine.",
      )
    } finally {
      setDomainActionLoading(null)
    }
  }

  /*
   * Suppression d'un domaine.
   */
  const deleteDomain = async (
    domainId: string,
    domain: string,
  ) => {
    if (
      !siteId ||
      domainActionLoading
    ) {
      return
    }

    const confirmed =
      window.confirm(
        `Supprimer le domaine "${domain}" ?`,
      )

    if (!confirmed) {
      return
    }

    setDomainActionLoading(
      domainId,
    )

    try {
      const response =
        await fetch(
          `/api/sites/${siteId}/domains/${domainId}`,
          {
            method: "DELETE",
          },
        )

      const data =
        await response.json()

      if (
        !response.ok ||
        data.status !== "ok"
      ) {
        throw new Error(
          data.message ??
            "Impossible de supprimer le domaine.",
        )
      }

      await loadDomains()
    } catch (error) {
      console.error(
        "Erreur lors de la suppression du domaine :",
        error,
      )

      alert(
        error instanceof Error
          ? error.message
          : "Impossible de supprimer le domaine.",
      )
    } finally {
      setDomainActionLoading(null)
    }
  }

  /*
   * Chargement initial du site.
   */
  useEffect(() => {
    loadSite()

    const interval =
      setInterval(
        loadSite,
        5000,
      )

    return () => {
      clearInterval(
        interval,
      )
    }
  }, [])

  /*
   * Chargement des logs.
   */
  useEffect(() => {
    loadLogs()

    const interval =
      setInterval(
        loadLogs,
        2000,
      )

    return () => {
      clearInterval(
        interval,
      )
    }
  }, [])

  /*
   * Chargement des déploiements.
   */
  useEffect(() => {
    loadDeployments()

    const interval =
      setInterval(
        loadDeployments,
        5000,
      )

    return () => {
      clearInterval(
        interval,
      )
    }
  }, [])

  /*
   * Chargement des domaines.
   */
  useEffect(() => {
    loadDomains()

    const interval =
      setInterval(
        loadDomains,
        5000,
      )

    return () => {
      clearInterval(
        interval,
      )
    }
  }, [])

  /*
   * Déploiement GitHub.
   */
  const executeDeploy = async () => {
    if (
      !siteId ||
      deploying
    ) {
      return
    }

    setDeploying(true)
    setError(null)

    try {
      const response =
        await fetch(
          `/api/sites/${siteId}/deploy`,
          {
            method: "POST",
          },
        )

      const data =
        await response.json()

      if (
        !response.ok ||
        data.status !== "ok"
      ) {
        throw new Error(
          data.message ??
            "Le déploiement a échoué.",
        )
      }

      await Promise.all([
        loadSite(),
        loadDeployments(),
        loadLogs(),
      ])
    } catch (error) {
      console.error(
        "Erreur lors du déploiement :",
        error,
      )

      setError(
        error instanceof Error
          ? error.message
          : "Le déploiement a échoué.",
      )

      await loadDeployments()
      await loadSite()
    } finally {
      setDeploying(false)
    }
  }

  /*
   * Start / Stop / Restart.
   */
  const executeAction = async (
    action: Action,
  ) => {
    if (!siteId) {
      return
    }

    setActionLoading(action)

    try {
      const response =
        await fetch(
          `/api/sites/${siteId}/action`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              action,
            }),
          },
        )

      const data =
        await response.json()

      if (!response.ok) {
        throw new Error(
          data.message ??
            "Impossible d'exécuter l'action.",
        )
      }

      await loadSite()
      await loadLogs()
    } catch (error) {
      console.error(
        "Erreur lors de l'action :",
        error,
      )

      alert(
        error instanceof Error
          ? error.message
          : "Une erreur est survenue.",
      )
    } finally {
      setActionLoading(null)
    }
  }

  /*
   * Suppression du site.
   */
  const handleDelete = async () => {
    if (
      !siteId ||
      !site
    ) {
      return
    }

    const confirmed =
      window.confirm(
        `Voulez-vous vraiment supprimer le site "${site.name}" ?\n\nCette action supprimera le container Docker et le site de la base de données.`,
      )

    if (!confirmed) {
      return
    }

    setDeleteLoading(true)

    try {
      const response =
        await fetch(
          `/api/sites/${siteId}`,
          {
            method: "DELETE",
          },
        )

      const data =
        await response.json()

      if (!response.ok) {
        throw new Error(
          data.message ??
            "Impossible de supprimer le site.",
        )
      }

      window.location.href = "/"
    } catch (error) {
      console.error(
        "Erreur lors de la suppression :",
        error,
      )

      alert(
        error instanceof Error
          ? error.message
          : "Une erreur est survenue.",
      )

      setDeleteLoading(false)
    }
  }

  /*
   * Chargement.
   */
  if (loading) {
    return (
      <main className="min-h-screen bg-muted/30 p-6">
        <div className="mx-auto max-w-6xl">
          <div className="flex min-h-[400px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </div>
      </main>
    )
  }

  /*
   * Erreur.
   */
  if (
    error ||
    !site
  ) {
    return (
      <main className="min-h-screen bg-muted/30 p-6">
        <div className="mx-auto max-w-6xl">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Retour au dashboard
          </Link>

          <Card>
            <CardContent className="flex min-h-48 items-center justify-center">
              <div className="text-center">
                <p className="font-medium">
                  Site introuvable
                </p>

                <p className="mt-1 text-sm text-muted-foreground">
                  {error ??
                    "Ce site n'existe pas."}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  const online =
    site.status === "online" ||
    site.status === "running"

  const isDeploying =
    site.status === "deploying" ||
    deploying

  /*
   * Domaine affiché en priorité :
   * domaine principal > premier domaine >
   * fallback localhost.
   */
  const primaryDomain =
    domains.find(
      (domain) =>
        domain.is_primary,
    ) ??
    domains[0] ??
    null

  const hostname =
    primaryDomain?.domain ??
    `${site.name}.localhost`

  const createdAt =
    new Date(
      site.created_at,
    ).toLocaleString(
      "fr-FR",
    )

  const latestDeployment =
    deployments[0] ?? null

  return (
    <main className="min-h-screen bg-muted/30">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        {/* HEADER */}

        <div>
          <Link
            href="/"
            className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Retour au dashboard
          </Link>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Globe className="h-6 w-6" />
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-semibold tracking-tight">
                    {site.name}
                  </h1>

                  <Badge
                    variant={
                      isDeploying
                        ? "secondary"
                        : online
                          ? "default"
                          : "secondary"
                    }
                    className="gap-2"
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        isDeploying
                          ? "animate-pulse bg-yellow-500"
                          : online
                            ? "bg-green-500"
                            : "bg-red-500"
                      }`}
                    />

                    {isDeploying
                      ? "Déploiement..."
                      : online
                        ? "Online"
                        : site.status}
                  </Badge>
                </div>

                <p className="mt-1 text-sm text-muted-foreground">
                  {site.container_name}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={executeDeploy}
                disabled={
                  deploying ||
                  deleteLoading
                }
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
              >
                {deploying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Rocket className="h-4 w-4" />
                )}

                {deploying
                  ? "Déploiement..."
                  : "Déployer"}
              </button>

              <a
                href={`http://${hostname}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
              >
                Ouvrir le site
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>

        {/* INFORMATIONS */}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <InfoCard
            icon={
              <Globe className="h-4 w-4" />
            }
            label="Domaine"
            value={hostname}
          />

          <InfoCard
            icon={
              <Box className="h-4 w-4" />
            }
            label="Image Docker"
            value={site.image}
          />

          <InfoCard
            icon={
              <Server className="h-4 w-4" />
            }
            label="Serveur"
            value={
              site.server_name ??
              site.server_hostname ??
              "Inconnu"
            }
          />

          <InfoCard
            icon={
              <Calendar className="h-4 w-4" />
            }
            label="Créé le"
            value={createdAt}
          />
        </div>

        {/* DOMAINES */}

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>
                  Domaines
                </CardTitle>

                <CardDescription>
                  Gérez les domaines associés à ce site.
                </CardDescription>
              </div>

              <button
                type="button"
                onClick={loadDomains}
                className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors hover:bg-muted"
              >
                <RefreshCw className="h-4 w-4" />
                Actualiser
              </button>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* AJOUT D'UN DOMAINE */}

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={domainInput}
                onChange={(event) =>
                  setDomainInput(
                    event.target.value,
                  )
                }
                onKeyDown={(event) => {
                  if (
                    event.key ===
                    "Enter"
                  ) {
                    addDomain()
                  }
                }}
                placeholder="example.com"
                disabled={
                  addingDomain
                }
                className="h-10 flex-1 rounded-lg border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary disabled:opacity-50"
              />

              <button
                type="button"
                onClick={addDomain}
                disabled={
                  addingDomain ||
                  !domainInput.trim()
                }
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
              >
                {addingDomain ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}

                Ajouter
              </button>
            </div>

            {/* LISTE DES DOMAINES */}

            {domainsLoading ? (
              <div className="flex min-h-24 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : domains.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center">
                <Globe2 className="mx-auto h-8 w-8 text-muted-foreground" />

                <p className="mt-3 font-medium">
                  Aucun domaine
                </p>

                <p className="mt-1 text-sm text-muted-foreground">
                  Ajoutez un domaine pour commencer.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {domains.map(
                  (domain) => {
                    const actionLoading =
                      domainActionLoading ===
                      domain.id

                    return (
                      <div
                        key={domain.id}
                        className="flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <Globe2 className="h-5 w-5" />
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-medium">
                                {domain.domain}
                              </p>

                              {domain.is_primary && (
                                <Badge className="gap-1">
                                  <Star className="h-3 w-3 fill-current" />
                                  Principal
                                </Badge>
                              )}
                            </div>

                            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                              <ShieldCheck
                                className={`h-3.5 w-3.5 ${
                                  domain.ssl_enabled
                                    ? "text-green-600"
                                    : ""
                                }`}
                              />

                              {domain.ssl_enabled
                                ? "SSL activé"
                                : "SSL désactivé"}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {!domain.is_primary && (
                            <button
                              type="button"
                              onClick={() =>
                                setPrimaryDomain(
                                  domain.id,
                                )
                              }
                              disabled={
                                actionLoading
                              }
                              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                            >
                              {actionLoading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Star className="h-3.5 w-3.5" />
                              )}

                              Principal
                            </button>
                          )}

                                                      <button
                              type="button"
                              onClick={() =>
                                toggleDomainSsl(
                                  domain.id,
                                  !domain.ssl_enabled,
                                )
                              }
                              disabled={
                                actionLoading
                              }
                              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                            >
                              {actionLoading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <ShieldCheck
                                  className={`h-3.5 w-3.5 ${
                                    domain.ssl_enabled
                                      ? "text-green-600"
                                      : ""
                                  }`}
                                />
                              )}

                              {domain.ssl_enabled
                                ? "Désactiver SSL"
                                : "Activer SSL"}
                            </button>

<button
                            type="button"
                            onClick={() =>
                              deleteDomain(
                                domain.id,
                                domain.domain,
                              )
                            }
                            disabled={
                              actionLoading
                            }
                            className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
                          >
                            {actionLoading ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}

                            Supprimer
                          </button>
                        </div>
                      </div>
                    )
                  },
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* DERNIER DEPLOIEMENT */}

        <Card>
          <CardHeader>
            <CardTitle>
              Dernier déploiement
            </CardTitle>

            <CardDescription>
              État du dernier déploiement GitHub.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {deploymentsLoading ? (
              <div className="flex min-h-24 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !latestDeployment ? (
              <div className="rounded-xl border border-dashed p-6 text-center">
                <Rocket className="mx-auto h-8 w-8 text-muted-foreground" />

                <p className="mt-3 font-medium">
                  Aucun déploiement
                </p>

                <p className="mt-1 text-sm text-muted-foreground">
                  Ce site n'a encore jamais été déployé.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <DeploymentInfo
                  icon={
                    <StatusIcon
                      status={
                        latestDeployment.status
                      }
                    />
                  }
                  label="Statut"
                  value={formatDeploymentStatus(
                    latestDeployment.status,
                  )}
                />

                <DeploymentInfo
                  icon={
                    <GitBranchIcon />
                  }
                  label="Branche"
                  value={
                    latestDeployment.branch ??
                    "Inconnue"
                  }
                />

                <DeploymentInfo
                  icon={
                    <Box className="h-4 w-4" />
                  }
                  label="Commit"
                  value={
                    latestDeployment.commit_sha
                      ? latestDeployment.commit_sha.slice(
                          0,
                          8,
                        )
                      : "Non disponible"
                  }
                />

                <DeploymentInfo
                  icon={
                    <Clock className="h-4 w-4" />
                  }
                  label="Date"
                  value={formatDate(
                    latestDeployment.created_at,
                  )}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* GESTION */}

        <Card>
          <CardHeader>
            <CardTitle>
              Gestion du site
            </CardTitle>

            <CardDescription>
              Contrôlez directement le container Docker.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div className="flex flex-wrap gap-3">
              <ActionButton
                icon={
                  <Play className="h-4 w-4" />
                }
                label="Démarrer"
                loading={
                  actionLoading === "start"
                }
                disabled={
                  online ||
                  isDeploying ||
                  actionLoading !== null ||
                  deleteLoading
                }
                onClick={() =>
                  executeAction("start")
                }
              />

              <ActionButton
                icon={
                  <Square className="h-4 w-4" />
                }
                label="Arrêter"
                loading={
                  actionLoading === "stop"
                }
                disabled={
                  !online ||
                  isDeploying ||
                  actionLoading !== null ||
                  deleteLoading
                }
                onClick={() =>
                  executeAction("stop")
                }
              />

              <ActionButton
                icon={
                  <RefreshCw className="h-4 w-4" />
                }
                label="Redémarrer"
                loading={
                  actionLoading === "restart"
                }
                disabled={
                  isDeploying ||
                  actionLoading !== null ||
                  deleteLoading
                }
                onClick={() =>
                  executeAction("restart")
                }
              />

              <button
                type="button"
                onClick={handleDelete}
                disabled={
                  deleteLoading ||
                  actionLoading !== null ||
                  isDeploying
                }
                className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
              >
                {deleteLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}

                Supprimer
              </button>
            </div>
          </CardContent>
        </Card>

        {/* CONTAINER */}

        <Card>
          <CardHeader>
            <CardTitle>
              Container Docker
            </CardTitle>

            <CardDescription>
              Informations techniques du container.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div className="space-y-4">
              <DetailRow
                icon={
                  <Container className="h-4 w-4" />
                }
                label="Nom du container"
                value={
                  site.container_name
                }
              />

              <DetailRow
                icon={
                  <HardDrive className="h-4 w-4" />
                }
                label="Container ID"
                value={
                  site.container_id ??
                  "Non disponible"
                }
              />

              <DetailRow
                icon={
                  <Box className="h-4 w-4" />
                }
                label="Image"
                value={site.image}
              />

              <DetailRow
                icon={
                  <Server className="h-4 w-4" />
                }
                label="Serveur"
                value={
                  site.server_name ??
                  site.server_hostname ??
                  "Inconnu"
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* HISTORIQUE DES DEPLOIEMENTS */}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>
                  Historique des déploiements
                </CardTitle>

                <CardDescription>
                  Tous les déploiements effectués sur ce site.
                </CardDescription>
              </div>

              <button
                type="button"
                onClick={loadDeployments}
                className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors hover:bg-muted"
              >
                <RefreshCw className="h-4 w-4" />
                Actualiser
              </button>
            </div>
          </CardHeader>

          <CardContent>
            {deploymentsLoading ? (
              <div className="flex min-h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : deployments.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center">
                <Rocket className="mx-auto h-8 w-8 text-muted-foreground" />

                <p className="mt-3 font-medium">
                  Aucun historique
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {deployments.map(
                  (deployment) => (
                    <DeploymentRow
                      key={deployment.id}
                      deployment={
                        deployment
                      }
                    />
                  ),
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* LOGS */}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>
                  Logs
                </CardTitle>

                <CardDescription>
                  Les 200 dernières lignes du container.
                </CardDescription>
              </div>

              <button
                type="button"
                onClick={loadLogs}
                className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition-colors hover:bg-muted"
              >
                <RefreshCw className="h-4 w-4" />
                Actualiser
              </button>
            </div>
          </CardHeader>

          <CardContent>
            <div className="overflow-auto rounded-xl bg-black p-4">
              <pre className="min-h-64 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-white">
                {logsLoading
                  ? "Chargement des logs..."
                  : logs ||
                    "Aucun log disponible."}
              </pre>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

/*
 * Bouton d'action.
 */
function ActionButton({
  icon,
  label,
  loading,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  loading: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        icon
      )}

      {label}
    </button>
  )
}

/*
 * Carte d'information.
 */
function InfoCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}

          <span className="text-xs font-medium">
            {label}
          </span>
        </div>

        <p
          className="mt-3 truncate text-sm font-medium"
          title={value}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

/*
 * Ligne de détail.
 */
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
    <div className="flex flex-col gap-2 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
          {icon}
        </div>

        <span className="text-sm font-medium">
          {label}
        </span>
      </div>

      <span
        className="break-all text-sm text-muted-foreground sm:max-w-[60%] sm:text-right"
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

/*
 * Information d'un deployment.
 */
function DeploymentInfo({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}

        <span className="text-xs font-medium">
          {label}
        </span>
      </div>

      <p
        className="mt-2 truncate text-sm font-medium"
        title={value}
      >
        {value}
      </p>
    </div>
  )
}

/*
 * Ligne d'un deployment.
 */
function DeploymentRow({
  deployment,
}: {
  deployment: Deployment
}) {
  const status =
    deployment.status

  const commit =
    deployment.commit_sha
      ? deployment.commit_sha.slice(
          0,
          8,
        )
      : "--------"

  return (
    <div className="flex flex-col gap-4 rounded-xl border p-4 transition-colors hover:bg-muted/30 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            status === "success"
              ? "bg-green-500/10 text-green-600"
              : status === "failed"
                ? "bg-red-500/10 text-red-600"
                : status === "running"
                  ? "bg-yellow-500/10 text-yellow-600"
                  : "bg-muted text-muted-foreground"
          }`}
        >
          <StatusIcon
            status={status}
          />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">
              {formatDeploymentStatus(
                status,
              )}
            </p>

            <Badge
              variant="secondary"
              className="font-mono text-xs"
            >
              {commit}
            </Badge>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              Branche :{" "}
              {deployment.branch ??
                "inconnue"}
            </span>

            <span>
              {formatDate(
                deployment.created_at,
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground lg:justify-end">
        {deployment.image_name && (
          <span
            className="max-w-xs truncate"
            title={
              deployment.image_name
            }
          >
            {deployment.image_name}
          </span>
        )}

        {deployment.finished_at &&
          deployment.started_at && (
            <span>
              {formatDuration(
                deployment.started_at,
                deployment.finished_at,
              )}
            </span>
          )}
      </div>
    </div>
  )
}

/*
 * Icône du statut.
 */
function StatusIcon({
  status,
}: {
  status: string
}) {
  if (
    status === "success"
  ) {
    return (
      <CheckCircle2 className="h-5 w-5" />
    )
  }

  if (
    status === "failed"
  ) {
    return (
      <XCircle className="h-5 w-5" />
    )
  }

  if (
    status === "running"
  ) {
    return (
      <Loader2 className="h-5 w-5 animate-spin" />
    )
  }

  return (
    <Clock className="h-5 w-5" />
  )
}

/*
 * Petite icône branche.
 */
function GitBranchIcon() {
  return (
    <span className="font-mono text-sm">
      ⎇
    </span>
  )
}

/*
 * Statut lisible.
 */
function formatDeploymentStatus(
  status: string,
) {
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

/*
 * Date lisible.
 */
function formatDate(
  value: string,
) {
  return new Date(
    value,
  ).toLocaleString(
    "fr-FR",
  )
}

/*
 * Durée d'un deployment.
 */
function formatDuration(
  startedAt: string,
  finishedAt: string,
) {
  const start =
    new Date(
      startedAt,
    ).getTime()

  const end =
    new Date(
      finishedAt,
    ).getTime()

  const seconds =
    Math.max(
      0,
      Math.round(
        (end - start) / 1000,
      ),
    )

  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes =
    Math.floor(
      seconds / 60,
    )

  const remaining =
    seconds % 60

  return `${minutes}m ${remaining}s`
}