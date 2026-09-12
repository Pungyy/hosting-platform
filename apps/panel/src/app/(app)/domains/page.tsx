"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import {
  ArrowUpRight,
  Globe2,
  ShieldCheck,
  Star,
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
import { Spinner } from "@/components/ui/spinner"
import { StatusPill } from "@/components/ui/status-pill"
import { StatCard } from "@/components/ui/stat-card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/page-header"
import { siteStatus } from "@/lib/status"
import { cn } from "cn"

type Domain = {
  id: string
  site_id: string
  domain: string
  is_primary: boolean
  ssl_enabled: boolean
  created_at: string
  updated_at: string
  site_name: string
  site_status: string
}

export default function DomainsPage() {
  const [domains, setDomains] = useState<Domain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const loadDomains = async () => {
    try {
      const response = await fetch("/api/domains", { cache: "no-store" })
      const data = await response.json()

      if (!response.ok || data.status !== "ok") {
        throw new Error(
          data.message ?? "Impossible de récupérer les domaines.",
        )
      }

      setDomains(data.domains ?? [])
      setError(null)
    } catch (err) {
      console.error("Erreur lors du chargement des domaines :", err)
      setError(
        err instanceof Error ? err.message : "Une erreur est survenue.",
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDomains()
    const interval = setInterval(loadDomains, 15000)
    return () => clearInterval(interval)
  }, [])

  const setPrimary = async (domain: Domain) => {
    setActionLoading(domain.id)

    try {
      const response = await fetch(
        `/api/sites/${domain.site_id}/domains/${domain.id}`,
        { method: "PATCH" },
      )
      const data = await response.json()

      if (!response.ok || data.status !== "ok") {
        throw new Error(
          data.message ?? "Impossible de modifier le domaine principal.",
        )
      }

      await loadDomains()
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Impossible de modifier le domaine.",
      )
    } finally {
      setActionLoading(null)
    }
  }

  const toggleSsl = async (domain: Domain) => {
    setActionLoading(domain.id)

    try {
      const response = await fetch(
        `/api/sites/${domain.site_id}/domains/${domain.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sslEnabled: !domain.ssl_enabled }),
        },
      )
      const data = await response.json()

      if (!response.ok || data.status !== "ok") {
        throw new Error(
          data.message ?? "Impossible de modifier le SSL du domaine.",
        )
      }

      await loadDomains()
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Impossible de modifier le SSL du domaine.",
      )
    } finally {
      setActionLoading(null)
    }
  }

  const deleteDomain = async (domain: Domain) => {
    const confirmed = window.confirm(
      `Supprimer le domaine « ${domain.domain} » ?`,
    )

    if (!confirmed) {
      return
    }

    setActionLoading(domain.id)

    try {
      const response = await fetch(
        `/api/sites/${domain.site_id}/domains/${domain.id}`,
        { method: "DELETE" },
      )
      const data = await response.json()

      if (!response.ok || data.status !== "ok") {
        throw new Error(
          data.message ?? "Impossible de supprimer le domaine.",
        )
      }

      await loadDomains()
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Impossible de supprimer le domaine.",
      )
    } finally {
      setActionLoading(null)
    }
  }

  const sslCount = domains.filter((d) => d.ssl_enabled).length
  const siteCount = new Set(domains.map((d) => d.site_id)).size

  return (
    <div className="space-y-8">
      <PageHeader
        title="Domaines"
        description="Tous les domaines connectés à vos sites, tous serveurs confondus."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Domaines"
          value={loading ? "—" : domains.length}
          hint="Domaines connectés"
          icon={<Globe2 />}
        />
        <StatCard
          label="SSL activé"
          value={loading ? "—" : sslCount}
          hint="Domaines en HTTPS"
          icon={<ShieldCheck />}
        />
        <StatCard
          label="Sites concernés"
          value={loading ? "—" : siteCount}
          hint="Sites avec au moins un domaine"
          icon={<Globe2 />}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Tous les domaines</CardTitle>
          <CardDescription>
            Le domaine principal d'affichage, l'état SSL et le site associé.
            Pour ajouter un domaine, passez par la page du site.
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
          ) : domains.length === 0 ? (
            <EmptyState
              icon={<Globe2 />}
              title="Aucun domaine"
              description="Ajoutez un domaine depuis la page d'un site pour le voir apparaître ici."
            />
          ) : (
            <div className="space-y-2.5">
              {domains.map((domain) => {
                const busy = actionLoading === domain.id
                const status = siteStatus(domain.site_status)

                return (
                  <div
                    key={domain.id}
                    className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
                        <Globe2 />
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

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <Link
                            href={`/sites/${domain.site_id}`}
                            className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
                          >
                            {domain.site_name}
                            <ArrowUpRight className="size-3" />
                          </Link>
                          <StatusPill tone={status.tone}>
                            {status.label}
                          </StatusPill>
                          <span className="inline-flex items-center gap-1">
                            <ShieldCheck
                              className={cn(
                                "size-3.5",
                                domain.ssl_enabled && "text-success",
                              )}
                            />
                            {domain.ssl_enabled
                              ? "SSL activé"
                              : "SSL désactivé"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {!domain.is_primary && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setPrimary(domain)}
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
                        onClick={() => toggleSsl(domain)}
                        disabled={busy}
                      >
                        {busy ? (
                          <Spinner className="text-current" />
                        ) : (
                          <ShieldCheck
                            className={cn(
                              domain.ssl_enabled && "text-success",
                            )}
                          />
                        )}
                        {domain.ssl_enabled
                          ? "Désactiver SSL"
                          : "Activer SSL"}
                      </Button>

                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deleteDomain(domain)}
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
    </div>
  )
}
