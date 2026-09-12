"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import {
  Activity,
  ArrowUpRight,
  Database,
  Globe,
  Plus,
  Rocket,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill } from "@/components/ui/status-pill"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/page-header"
import { siteStatus } from "@/lib/status"
import { cn } from "cn"

type AgentStatus = "checking" | "online" | "offline"

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

export default function Home() {
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("checking")
  const [sites, setSites] = useState<Site[]>([])
  const [sitesLoading, setSitesLoading] = useState(true)

  /*
   * Vérification de l'état de l'Agent.
   */
  useEffect(() => {
    const checkAgent = async () => {
      try {
        const response = await fetch("/api/agent/health", {
          cache: "no-store",
        })

        if (!response.ok) {
          setAgentStatus("offline")
          return
        }

        const data = await response.json()

        if (data.status === "online") {
          setAgentStatus("online")
        } else {
          setAgentStatus("offline")
        }
      } catch {
        setAgentStatus("offline")
      }
    }

    checkAgent()

    const interval = setInterval(checkAgent, 30000)

    return () => clearInterval(interval)
  }, [])

  /*
   * Récupération des sites.
   */
  useEffect(() => {
    const loadSites = async () => {
      try {
        const response = await fetch("/api/sites", {
          cache: "no-store",
        })

        if (!response.ok) {
          throw new Error("Impossible de récupérer les sites.")
        }

        const data = await response.json()

        if (data.status === "ok") {
          setSites(data.sites ?? [])
        }
      } catch (error) {
        console.error("Erreur lors du chargement des sites :", error)
      } finally {
        setSitesLoading(false)
      }
    }

    loadSites()

    const interval = setInterval(loadSites, 30000)

    return () => clearInterval(interval)
  }, [])

  const agentTone =
    agentStatus === "online"
      ? "success"
      : agentStatus === "offline"
        ? "danger"
        : "neutral"

  const agentLabel =
    agentStatus === "online"
      ? "En ligne"
      : agentStatus === "offline"
        ? "Hors ligne"
        : "Vérification…"

  return (
    <div className="space-y-8">
      <PageHeader
        title="Bonjour Ibrahim 👋"
        description="Vue d'ensemble de votre infrastructure et de vos sites hébergés."
        actions={
          <Link
            href="/sites"
            className={cn(buttonVariants({ variant: "primary" }))}
          >
            <Plus />
            Créer un site
          </Link>
        }
      />

      {/* STATS */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Sites"
          value={sitesLoading ? "—" : sites.length}
          hint="Sites hébergés"
          icon={<Globe />}
        />
        <StatCard
          label="Serveurs"
          value="1"
          hint="Serveurs connectés"
          icon={<Server />}
        />
        <StatCard
          label="Clients"
          value="0"
          hint="Clients actifs"
          icon={<Users />}
        />
        <StatCard
          label="Déploiements"
          value="0"
          hint="Déploiements effectués"
          icon={<Rocket />}
        />
      </div>

      {/* INFRASTRUCTURE */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Infrastructure</CardTitle>
            <CardDescription>État de vos serveurs et agents.</CardDescription>
          </div>

          <Link
            href="/servers/new"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            <Plus />
            Ajouter un serveur
          </Link>
        </CardHeader>

        <CardContent>
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span
                className={cn(
                  "flex size-11 items-center justify-center rounded-lg [&_svg]:size-5",
                  agentStatus === "online"
                    ? "bg-success/10 text-success"
                    : agentStatus === "offline"
                      ? "bg-danger/10 text-danger"
                      : "bg-muted text-muted-foreground"
                )}
              >
                <Server />
              </span>

              <div>
                <p className="text-sm font-medium">Agent local</p>
                <p className="text-sm text-muted-foreground">
                  {agentStatus === "online"
                    ? "localhost:4000 · v0.1.0"
                    : agentStatus === "offline"
                      ? "Agent injoignable"
                      : "Vérification en cours…"}
                </p>
              </div>
            </div>

            <StatusPill tone={agentTone} pulse={agentStatus === "checking"}>
              {agentLabel}
            </StatusPill>
          </div>
        </CardContent>
      </Card>

      {/* SITES */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Sites récents</CardTitle>
            <CardDescription>
              Sites actuellement hébergés sur votre infrastructure.
            </CardDescription>
          </div>

          <Link
            href="/sites"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Voir tout
            <ArrowUpRight className="size-4" />
          </Link>
        </CardHeader>

        <CardContent>
          {sitesLoading ? (
            <div className="space-y-2.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-lg border border-border bg-muted/50"
                />
              ))}
            </div>
          ) : sites.length === 0 ? (
            <EmptyState
              icon={<Globe />}
              title="Aucun site"
              description="Créez votre premier site pour commencer à héberger."
              action={
                <Link
                  href="/sites"
                  className={cn(buttonVariants({ variant: "primary", size: "sm" }))}
                >
                  <Plus />
                  Créer un site
                </Link>
              }
            />
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {sites.slice(0, 5).map((site) => {
                const status = siteStatus(site.status)

                return (
                  <Link
                    key={site.id}
                    href={`/sites/${site.id}`}
                    className="flex items-center justify-between gap-4 bg-card px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={cn(
                          "flex size-9 items-center justify-center rounded-lg [&_svg]:size-4",
                          status.tone === "success"
                            ? "bg-success/10 text-success"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        <Globe />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {site.name}
                        </p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {site.name}.localhost
                        </p>
                      </div>
                    </div>

                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  </Link>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* BOTTOM GRID */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Actions rapides</CardTitle>
            <CardDescription>Gérez rapidement votre infrastructure.</CardDescription>
          </CardHeader>

          <CardContent className="grid gap-2.5 sm:grid-cols-2">
            <QuickAction
              href="/servers/new"
              icon={<Server />}
              title="Ajouter un serveur"
              description="Connecter un nouvel Agent"
            />
            <QuickAction
              href="/sites"
              icon={<Globe />}
              title="Créer un site"
              description="Déployer un nouveau site"
            />
            <QuickAction
              href="/deployments"
              icon={<Rocket />}
              title="Déploiements"
              description="Historique des déploiements"
            />
            <QuickAction
              href="/domains"
              icon={<Globe />}
              title="Domaines"
              description="Gérer vos noms de domaine"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>État du système</CardTitle>
            <CardDescription>Informations générales de la plateforme.</CardDescription>
          </CardHeader>

          <CardContent className="space-y-1">
            <StatusRow icon={<Activity />} label="Panel" status="Opérationnel" tone="success" />
            <StatusRow
              icon={<Server />}
              label="Hosting Agent"
              status={agentLabel}
              tone={agentTone}
            />
            <StatusRow
              icon={<ShieldCheck />}
              label="Sécurité"
              status="Configuration locale"
              tone="success"
            />
            <StatusRow
              icon={<Database />}
              label="Base de données"
              status="Connectée"
              tone="success"
            />
          </CardContent>
        </Card>
      </div>

      {/* ACTIVITY */}
      <Card>
        <CardHeader>
          <CardTitle>Activité récente</CardTitle>
          <CardDescription>
            Les dernières actions effectuées sur votre plateforme.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <EmptyState
            icon={<Activity />}
            title="Aucune activité"
            description="Les actions effectuées apparaîtront ici."
          />
        </CardContent>
      </Card>
    </div>
  )
}

function QuickAction({
  href,
  icon,
  title,
  description,
}: {
  href: string
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-lg border border-border p-3.5 transition-colors hover:bg-muted/50"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:text-foreground [&_svg]:size-4">
        {icon}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{description}</p>
      </div>

      <ArrowUpRight className="size-4 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
    </Link>
  )
}

function StatusRow({
  icon,
  label,
  status,
  tone,
}: {
  icon: React.ReactNode
  label: string
  status: string
  tone: "success" | "danger" | "neutral" | "warning"
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <div className="flex items-center gap-3">
        <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
        <span className="text-sm font-medium">{label}</span>
      </div>

      <StatusPill tone={tone}>{status}</StatusPill>
    </div>
  )
}
