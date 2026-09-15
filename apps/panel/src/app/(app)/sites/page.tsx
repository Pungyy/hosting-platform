"use client"

import Link from "next/link"
import { FormEvent, useEffect, useState } from "react"
import {
  ArrowUpRight,
  Box,
  Globe,
  Plus,
  RefreshCw,
  Server,
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
}

type SitesResponse = {
  status: "ok" | "error"
  sites?: Site[]
  message?: string
}

type CreateSiteResponse = {
  status: "ok" | "error"
  site?: { id: string; name: string }
  message?: string
}

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [siteName, setSiteName] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const loadSites = async (showRefreshLoader = false) => {
    if (showRefreshLoader) {
      setRefreshing(true)
    }

    try {
      const response = await fetch("/api/sites", { cache: "no-store" })
      const data = (await response.json()) as SitesResponse

      if (!response.ok || data.status !== "ok") {
        throw new Error(data.message ?? "Impossible de récupérer les sites.")
      }

      setSites(data.sites ?? [])
      setError(null)
    } catch (error) {
      console.error("Erreur lors du chargement des sites :", error)
      setError(
        error instanceof Error
          ? error.message
          : "Impossible de récupérer les sites."
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    // Rafraîchissement périodique volontaire (voir chantier lint M3-4bis) :
    // synchronisation avec une ressource externe (l'API), pas un rendu en
    // cascade — setState n'a lieu qu'après l'await du fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSites()

    const interval = setInterval(() => {
      loadSites()
    }, 30000)

    return () => {
      clearInterval(interval)
    }
  }, [])

  const handleCreateSite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const name = siteName.trim().toLowerCase()

    if (!name) {
      setError("Veuillez saisir un nom de site.")
      return
    }

    setCreating(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })

      const data = (await response.json()) as CreateSiteResponse

      if (!response.ok || data.status !== "ok" || !data.site) {
        throw new Error(data.message ?? "Impossible de créer le site.")
      }

      setSuccess(`Le site « ${data.site.name} » a été créé.`)
      setSiteName("")
      setShowCreateForm(false)

      await loadSites()

      window.location.href = `/sites/${data.site.id}`
    } catch (error) {
      console.error("Erreur lors de la création du site :", error)
      setError(
        error instanceof Error ? error.message : "Impossible de créer le site."
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Sites"
        description="Gérez tous les sites hébergés sur votre infrastructure."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => loadSites(true)}
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
              Créer un site
            </Button>
          </>
        }
      />

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
            <CardTitle>Créer un site</CardTitle>
            <CardDescription>
              Un container Docker sera automatiquement créé et connecté à Traefik.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleCreateSite} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="site-name" className="text-sm font-medium">
                  Nom du site
                </label>

                <Input
                  id="site-name"
                  value={siteName}
                  onChange={(event) => setSiteName(event.target.value)}
                  placeholder="mon-site"
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
                  <Server />
                </span>
                <div>
                  <p className="text-sm font-medium">Serveur</p>
                  <p className="text-xs text-muted-foreground">Local Docker</p>
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

                <Button type="submit" disabled={creating || !siteName.trim()}>
                  {creating ? <Spinner className="text-current" /> : <Plus />}
                  {creating ? "Création…" : "Créer le site"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Tous les sites</CardTitle>
          <CardDescription>
            {sites.length} site{sites.length !== 1 ? "s" : ""} hébergé
            {sites.length !== 1 ? "s" : ""}
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
          ) : sites.length === 0 ? (
            <EmptyState
              icon={<Globe />}
              title="Aucun site"
              description="Créez votre premier site pour commencer."
              action={
                <Button size="sm" onClick={() => setShowCreateForm(true)}>
                  <Plus />
                  Créer un site
                </Button>
              }
            />
          ) : (
            <div className="space-y-2.5">
              {sites.map((site) => {
                const status = siteStatus(site.status)

                return (
                  <div
                    key={site.id}
                    className="flex flex-col gap-4 rounded-lg border border-border p-4 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
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
                        <Globe />
                      </span>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{site.name}</p>
                          <StatusPill tone={status.tone}>
                            {status.label}
                          </StatusPill>
                        </div>

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1 font-mono">
                            <Globe className="size-3" />
                            {site.name}.localhost
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Box className="size-3" />
                            {site.image}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Server className="size-3" />
                            Local Docker
                          </span>
                        </div>
                      </div>
                    </div>

                    <Link
                      href={`/sites/${site.id}`}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-muted"
                    >
                      Gérer
                      <ArrowUpRight className="size-4" />
                    </Link>
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
