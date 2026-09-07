"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import {
  Activity,
  ArrowUpRight,
  Bell,
  CircleHelp,
  Database,
  Globe,
  HardDrive,
  LayoutDashboard,
  Plus,
  Rocket,
  Server,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

type AgentStatus =
  | "checking"
  | "online"
  | "offline"

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
  const [agentStatus, setAgentStatus] =
    useState<AgentStatus>("checking")

  const [sites, setSites] = useState<Site[]>([])
  const [sitesLoading, setSitesLoading] =
    useState(true)

  /*
   * Vérification de l'état de l'Agent.
   */
  useEffect(() => {
    const checkAgent = async () => {
      try {
        const response = await fetch(
          "/api/agent/health",
          {
            cache: "no-store",
          },
        )

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

    const interval = setInterval(
      checkAgent,
      30000,
    )

    return () => clearInterval(interval)
  }, [])

  /*
   * Récupération des sites.
   */
  useEffect(() => {
    const loadSites = async () => {
      try {
        const response = await fetch(
          "/api/sites",
          {
            cache: "no-store",
          },
        )

        if (!response.ok) {
          throw new Error(
            "Impossible de récupérer les sites.",
          )
        }

        const data = await response.json()

        if (data.status === "ok") {
          setSites(data.sites ?? [])
        }
      } catch (error) {
        console.error(
          "Erreur lors du chargement des sites :",
          error,
        )
      } finally {
        setSitesLoading(false)
      }
    }

    loadSites()

    const interval = setInterval(
      loadSites,
      30000,
    )

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="flex min-h-screen">

        {/* SIDEBAR */}
        <aside className="hidden w-64 border-r bg-background lg:flex lg:flex-col">
          <div className="flex h-16 items-center px-6">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Rocket className="h-5 w-5" />
              </div>

              <div>
                <p className="font-semibold">
                  Hosting Platform
                </p>

                <p className="text-xs text-muted-foreground">
                  Infrastructure
                </p>
              </div>
            </div>
          </div>

          <Separator />

          <nav className="flex-1 space-y-1 p-4">

            <NavItem
              href="/"
              icon={
                <LayoutDashboard className="h-4 w-4" />
              }
              label="Dashboard"
              active
            />

            <NavItem
              href="/sites"
              icon={
                <Globe className="h-4 w-4" />
              }
              label="Sites"
            />

            <NavItem
              href="/domains"
              icon={
                <Globe className="h-4 w-4" />
              }
              label="Domaines"
            />

            <NavItem
              href="/servers"
              icon={
                <Server className="h-4 w-4" />
              }
              label="Serveurs"
            />

            <NavItem
              href="/deployments"
              icon={
                <Rocket className="h-4 w-4" />
              }
              label="Deployments"
            />

            <NavItem
              href="/databases"
              icon={
                <Database className="h-4 w-4" />
              }
              label="Bases de données"
            />

            <NavItem
              href="/backups"
              icon={
                <HardDrive className="h-4 w-4" />
              }
              label="Backups"
            />

            <Separator className="my-4" />

            <NavItem
              href="/clients"
              icon={
                <Users className="h-4 w-4" />
              }
              label="Clients"
            />

            <NavItem
              href="/settings"
              icon={
                <Settings className="h-4 w-4" />
              }
              label="Paramètres"
            />

            <NavItem
              href="/support"
              icon={
                <CircleHelp className="h-4 w-4" />
              }
              label="Support"
            />
          </nav>

          {/* USER */}
          <div className="border-t p-4">
            <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                IA
              </div>

              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  Ibrahim
                </p>

                <p className="truncate text-xs text-muted-foreground">
                  Administrateur
                </p>
              </div>
            </div>
          </div>
        </aside>

        {/* MAIN */}
        <main className="flex-1">

          {/* HEADER */}
          <header className="flex h-16 items-center justify-between border-b bg-background px-6">
            <div>
              <h1 className="text-lg font-semibold">
                Dashboard
              </h1>

              <p className="text-sm text-muted-foreground">
                Vue d'ensemble de votre infrastructure
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-lg border bg-background hover:bg-muted"
              >
                <CircleHelp className="h-4 w-4" />
              </button>

              <button
                type="button"
                className="relative flex h-9 w-9 items-center justify-center rounded-lg border bg-background hover:bg-muted"
              >
                <Bell className="h-4 w-4" />

                <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" />
              </button>

              <div className="ml-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">
                IA
              </div>
            </div>
          </header>

          <div className="space-y-6 p-6">

            {/* WELCOME */}
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Bonjour Ibrahim 👋
              </h2>

              <p className="mt-1 text-sm text-muted-foreground">
                Voici l'état actuel de votre plateforme.
              </p>
            </div>

            {/* STATS */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                title="Sites"
                value={
                  sitesLoading
                    ? "..."
                    : String(sites.length)
                }
                description="Sites hébergés"
                icon={
                  <Globe className="h-4 w-4" />
                }
              />

              <StatCard
                title="Serveurs"
                value="1"
                description="Serveurs connectés"
                icon={
                  <Server className="h-4 w-4" />
                }
              />

              <StatCard
                title="Clients"
                value="0"
                description="Clients actifs"
                icon={
                  <Users className="h-4 w-4" />
                }
              />

              <StatCard
                title="Deployments"
                value="0"
                description="Déploiements effectués"
                icon={
                  <Rocket className="h-4 w-4" />
                }
              />
            </div>

            {/* INFRASTRUCTURE */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>
                      Infrastructure
                    </CardTitle>

                    <CardDescription>
                      État de vos serveurs et agents
                    </CardDescription>
                  </div>

                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Plus className="h-4 w-4" />
                    Ajouter un serveur
                  </button>
                </div>
              </CardHeader>

              <CardContent>
                <div className="rounded-xl border bg-muted/20 p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                          agentStatus === "online"
                            ? "bg-green-500/10"
                            : agentStatus === "offline"
                              ? "bg-red-500/10"
                              : "bg-muted"
                        }`}
                      >
                        <Server
                          className={`h-6 w-6 ${
                            agentStatus === "online"
                              ? "text-green-500"
                              : agentStatus === "offline"
                                ? "text-red-500"
                                : "text-muted-foreground"
                          }`}
                        />
                      </div>

                      <div>
                        <p className="font-medium">
                          Agent local
                        </p>

                        <p className="text-sm text-muted-foreground">
                          {agentStatus === "online"
                            ? "Hosting Agent"
                            : agentStatus === "offline"
                              ? "Agent hors ligne"
                              : "Vérification en cours..."}
                        </p>

                        {agentStatus === "online" && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            localhost:4000 · v0.1.0
                          </p>
                        )}
                      </div>
                    </div>

                    <Badge
                      variant={
                        agentStatus === "online"
                          ? "default"
                          : "secondary"
                      }
                      className="gap-2"
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          agentStatus === "online"
                            ? "bg-green-500"
                            : agentStatus === "offline"
                              ? "bg-red-500"
                              : "bg-yellow-500"
                        }`}
                      />

                      {agentStatus === "online"
                        ? "Online"
                        : agentStatus === "offline"
                          ? "Offline"
                          : "Checking"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* SITES */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>
                      Sites
                    </CardTitle>

                    <CardDescription>
                      Sites actuellement hébergés sur votre
                      infrastructure
                    </CardDescription>
                  </div>

                  <Link
                    href="/sites"
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Plus className="h-4 w-4" />
                    Créer un site
                  </Link>
                </div>
              </CardHeader>

              <CardContent>
                {sitesLoading ? (
                  <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed">
                    <p className="text-sm text-muted-foreground">
                      Chargement des sites...
                    </p>
                  </div>
                ) : sites.length === 0 ? (
                  <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed">
                    <div className="text-center">
                      <Globe className="mx-auto h-8 w-8 text-muted-foreground" />

                      <p className="mt-3 text-sm font-medium">
                        Aucun site
                      </p>

                      <p className="mt-1 text-xs text-muted-foreground">
                        Créez votre premier site pour
                        commencer.
                      </p>
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
                          className="flex items-center justify-between rounded-xl border p-4 transition-colors hover:bg-muted/30"
                        >
                          <div className="flex items-center gap-4">
                            <div
                              className={`flex h-10 w-10 items-center justify-center rounded-lg ${
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

                            <div>
                              <p className="font-medium">
                                {site.name}
                              </p>

                              <p className="text-xs text-muted-foreground">
                                {site.container_name}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
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

                            <Link
                              href={`/sites/${site.id}`}
                              className="hidden text-sm text-muted-foreground hover:text-foreground sm:block"
                            >
                              Gérer
                            </Link>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* BOTTOM GRID */}
            <div className="grid gap-6 lg:grid-cols-2">

              {/* QUICK ACTIONS */}
              <Card>
                <CardHeader>
                  <CardTitle>
                    Actions rapides
                  </CardTitle>

                  <CardDescription>
                    Gérez rapidement votre infrastructure
                  </CardDescription>
                </CardHeader>

                <CardContent className="grid gap-3 sm:grid-cols-2">
                  <QuickAction
                    href="/servers"
                    icon={
                      <Server className="h-5 w-5" />
                    }
                    title="Ajouter un serveur"
                    description="Connecter un nouvel Agent"
                  />

                  <QuickAction
                    href="/sites"
                    icon={
                      <Globe className="h-5 w-5" />
                    }
                    title="Créer un site"
                    description="Déployer un nouveau site"
                  />

                  <QuickAction
                    href="/deployments"
                    icon={
                      <Rocket className="h-5 w-5" />
                    }
                    title="Nouveau deployment"
                    description="Déployer depuis Git"
                  />

                  <QuickAction
                    href="/databases"
                    icon={
                      <Database className="h-5 w-5" />
                    }
                    title="Créer une base"
                    description="Nouvelle base de données"
                  />
                </CardContent>
              </Card>

              {/* SYSTEM STATUS */}
              <Card>
                <CardHeader>
                  <CardTitle>
                    État du système
                  </CardTitle>

                  <CardDescription>
                    Informations générales de la plateforme
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                  <StatusRow
                    icon={
                      <Activity className="h-4 w-4" />
                    }
                    label="Panel"
                    status="Opérationnel"
                    online
                  />

                  <StatusRow
                    icon={
                      <Server className="h-4 w-4" />
                    }
                    label="Hosting Agent"
                    status={
                      agentStatus === "online"
                        ? "Connecté"
                        : agentStatus === "offline"
                          ? "Hors ligne"
                          : "Vérification..."
                    }
                    online={
                      agentStatus === "online"
                    }
                  />

                  <StatusRow
                    icon={
                      <ShieldCheck className="h-4 w-4" />
                    }
                    label="Sécurité"
                    status="Configuration locale"
                    online
                  />

                  <StatusRow
                    icon={
                      <Database className="h-4 w-4" />
                    }
                    label="Base de données"
                    status="Connectée"
                    online
                  />
                </CardContent>
              </Card>
            </div>

            {/* ACTIVITY */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>
                      Activité récente
                    </CardTitle>

                    <CardDescription>
                      Les dernières actions effectuées sur
                      votre plateforme
                    </CardDescription>
                  </div>

                  <button
                    type="button"
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    Voir tout
                    <ArrowUpRight className="h-4 w-4" />
                  </button>
                </div>
              </CardHeader>

              <CardContent>
                <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed">
                  <div className="text-center">
                    <Activity className="mx-auto h-8 w-8 text-muted-foreground" />

                    <p className="mt-3 text-sm font-medium">
                      Aucune activité
                    </p>

                    <p className="mt-1 text-xs text-muted-foreground">
                      Les actions effectuées apparaîtront ici.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  )
}

/* -------------------------------- */
/* COMPONENTS                       */
/* -------------------------------- */

function NavItem({
  href,
  icon,
  label,
  active = false,
}: {
  href: string
  icon: React.ReactNode
  label: string
  active?: boolean
}) {
  return (
    <Link
      href={href}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </Link>
  )
}

function StatCard({
  title,
  value,
  description,
  icon,
}: {
  title: string
  value: string
  description: string
  icon: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">
            {title}
          </p>

          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </div>
        </div>

        <div className="mt-4">
          <p className="text-3xl font-semibold">
            {value}
          </p>

          <p className="mt-1 text-xs text-muted-foreground">
            {description}
          </p>
        </div>
      </CardContent>
    </Card>
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
      className="group flex items-center gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-muted/50"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>

      <div className="min-w-0">
        <p className="text-sm font-medium group-hover:text-primary">
          {title}
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          {description}
        </p>
      </div>

      <ArrowUpRight className="ml-auto h-4 w-4 text-muted-foreground" />
    </Link>
  )
}

function StatusRow({
  icon,
  label,
  status,
  online,
}: {
  icon: React.ReactNode
  label: string
  status: string
  online: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
          {icon}
        </div>

        <span className="text-sm font-medium">
          {label}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${
            online
              ? "bg-green-500"
              : "bg-yellow-500"
          }`}
        />

        <span className="text-sm text-muted-foreground">
          {status}
        </span>
      </div>
    </div>
  )
}