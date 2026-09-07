"use client"

import Link from "next/link"
import { FormEvent, useEffect, useState } from "react"
import {
  ArrowLeft,
  ArrowUpRight,
  Box,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Server,
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
}

type SitesResponse = {
  status: "ok" | "error"
  sites?: Site[]
  message?: string
}

type CreateSiteResponse = {
  status: "ok" | "error"
  site?: {
    id: string
    name: string
  }
  message?: string
}

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [showCreateForm, setShowCreateForm] =
    useState(false)

  const [siteName, setSiteName] = useState("")

  const [creating, setCreating] = useState(false)

  const [error, setError] = useState<string | null>(
    null,
  )

  const [success, setSuccess] = useState<string | null>(
    null,
  )

  const loadSites = async (
    showRefreshLoader = false,
  ) => {
    if (showRefreshLoader) {
      setRefreshing(true)
    }

    try {
      const response = await fetch(
        "/api/sites",
        {
          cache: "no-store",
        },
      )

      const data =
        (await response.json()) as SitesResponse

      if (
        !response.ok ||
        data.status !== "ok"
      ) {
        throw new Error(
          data.message ??
            "Impossible de récupérer les sites.",
        )
      }

      setSites(data.sites ?? [])
      setError(null)
    } catch (error) {
      console.error(
        "Erreur lors du chargement des sites :",
        error,
      )

      setError(
        error instanceof Error
          ? error.message
          : "Impossible de récupérer les sites.",
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadSites()

    const interval = setInterval(() => {
      loadSites()
    }, 30000)

    return () => {
      clearInterval(interval)
    }
  }, [])

  const handleCreateSite = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    const name = siteName
      .trim()
      .toLowerCase()

    if (!name) {
      setError(
        "Veuillez saisir un nom de site.",
      )
      return
    }

    setCreating(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(
        "/api/sites",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            name,
          }),
        },
      )

      const data =
        (await response.json()) as CreateSiteResponse

      if (
        !response.ok ||
        data.status !== "ok" ||
        !data.site
      ) {
        throw new Error(
          data.message ??
            "Impossible de créer le site.",
        )
      }

      setSuccess(
        `Le site "${data.site.name}" a été créé.`,
      )

      setSiteName("")
      setShowCreateForm(false)

      await loadSites()

      /*
       * On redirige vers la page du site
       * après une création réussie.
       */
      window.location.href =
        `/sites/${data.site.id}`
    } catch (error) {
      console.error(
        "Erreur lors de la création du site :",
        error,
      )

      setError(
        error instanceof Error
          ? error.message
          : "Impossible de créer le site.",
      )
    } finally {
      setCreating(false)
    }
  }

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
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Sites
              </h1>

              <p className="mt-1 text-sm text-muted-foreground">
                Gérez tous les sites hébergés sur votre
                infrastructure.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  loadSites(true)
                }
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-4 w-4 ${
                    refreshing
                      ? "animate-spin"
                      : ""
                  }`}
                />

                Actualiser
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(
                    !showCreateForm,
                  )
                  setError(null)
                  setSuccess(null)
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />

                Créer un site
              </button>
            </div>
          </div>
        </div>

        {/* MESSAGES */}
        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-xl border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-700">
            {success}
          </div>
        )}

        {/* CREATE FORM */}
        {showCreateForm && (
          <Card>
            <CardHeader>
              <CardTitle>
                Créer un site
              </CardTitle>

              <CardDescription>
                Un container Docker sera automatiquement
                créé et connecté à Traefik.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form
                onSubmit={handleCreateSite}
                className="space-y-5"
              >
                <div className="space-y-2">
                  <label
                    htmlFor="site-name"
                    className="text-sm font-medium"
                  >
                    Nom du site
                  </label>

                  <input
                    id="site-name"
                    type="text"
                    value={siteName}
                    onChange={(event) =>
                      setSiteName(
                        event.target.value,
                      )
                    }
                    placeholder="mon-site"
                    disabled={creating}
                    autoComplete="off"
                    className="flex h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                  />

                  <p className="text-xs text-muted-foreground">
                    3 à 40 caractères. Lettres minuscules,
                    chiffres et tirets uniquement.
                  </p>
                </div>

                <div className="rounded-xl border bg-muted/30 p-4">
                  <div className="flex items-center gap-3">
                    <Server className="h-5 w-5 text-primary" />

                    <div>
                      <p className="text-sm font-medium">
                        Serveur
                      </p>

                      <p className="text-xs text-muted-foreground">
                        Local Docker
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateForm(false)
                      setError(null)
                    }}
                    disabled={creating}
                    className="rounded-lg border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                  >
                    Annuler
                  </button>

                  <button
                    type="submit"
                    disabled={
                      creating ||
                      !siteName.trim()
                    }
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {creating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}

                    {creating
                      ? "Création..."
                      : "Créer le site"}
                  </button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* SITES */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>
                  Tous les sites
                </CardTitle>

                <CardDescription>
                  {sites.length} site
                  {sites.length !== 1
                    ? "s"
                    : ""}{" "}
                  hébergé
                  {sites.length !== 1
                    ? "s"
                    : ""}
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {loading ? (
              <div className="flex min-h-48 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : sites.length === 0 ? (
              <div className="flex min-h-56 items-center justify-center rounded-xl border border-dashed">
                <div className="text-center">
                  <Globe className="mx-auto h-10 w-10 text-muted-foreground" />

                  <p className="mt-4 font-medium">
                    Aucun site
                  </p>

                  <p className="mt-1 text-sm text-muted-foreground">
                    Créez votre premier site pour
                    commencer.
                  </p>

                  <button
                    type="button"
                    onClick={() =>
                      setShowCreateForm(true)
                    }
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Plus className="h-4 w-4" />

                    Créer un site
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {sites.map((site) => {
                  const online =
                    site.status === "online" ||
                    site.status === "running"

                  return (
                    <div
                      key={site.id}
                      className="flex flex-col gap-4 rounded-xl border p-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                            online
                              ? "bg-green-500/10"
                              : "bg-red-500/10"
                          }`}
                        >
                          <Globe
                            className={`h-5 w-5 ${
                              online
                                ? "text-green-500"
                                : "text-red-500"
                            }`}
                          />
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">
                              {site.name}
                            </p>

                            <Badge
                              variant={
                                online
                                  ? "default"
                                  : "secondary"
                              }
                              className="gap-2"
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
                                : site.status}
                            </Badge>
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Globe className="h-3 w-3" />

                              {site.name}
                              .localhost
                            </span>

                            <span className="inline-flex items-center gap-1">
                              <Box className="h-3 w-3" />

                              {site.image}
                            </span>

                            <span className="inline-flex items-center gap-1">
                              <Server className="h-3 w-3" />

                              Local Docker
                            </span>
                          </div>
                        </div>
                      </div>

                      <Link
                        href={`/sites/${site.id}`}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
                      >
                        Gérer

                        <ArrowUpRight className="h-4 w-4" />
                      </Link>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}