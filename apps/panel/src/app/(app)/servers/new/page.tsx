"use client"

import Link from "next/link"
import { FormEvent, useState } from "react"
import { Check, CheckCircle2, Copy, Server, TriangleAlert } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { PageHeader } from "@/components/page-header"
import { cn } from "cn"

type CreatedServer = {
  id: string
  name: string
  hostname: string
  ip_address: string | null
}

type EnrollmentData = {
  token: string
  expiresAt: string
}

export default function NewServerPage() {
  const [name, setName] = useState("")
  const [hostname, setHostname] = useState("")
  const [ipAddress, setIpAddress] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [server, setServer] = useState<CreatedServer | null>(null)
  const [enrollment, setEnrollment] = useState<EnrollmentData | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setLoading(true)
    setError(null)

    try {
      const serverResponse = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, hostname, ipAddress }),
      })

      const serverData = await serverResponse.json()

      if (!serverResponse.ok || serverData.status !== "ok") {
        throw new Error(
          serverData.message ?? "Impossible de créer le serveur."
        )
      }

      const createdServer = serverData.server as CreatedServer
      setServer(createdServer)

      const enrollmentResponse = await fetch(
        `/api/servers/${createdServer.id}/enrollment`,
        { method: "POST" }
      )

      const enrollmentData = await enrollmentResponse.json()

      if (!enrollmentResponse.ok || enrollmentData.status !== "ok") {
        throw new Error(
          enrollmentData.message ??
            "Impossible de générer le token d'enrôlement."
        )
      }

      setEnrollment(enrollmentData.enrollment)
    } catch (error) {
      console.error("Erreur lors de l'ajout du serveur :", error)
      setError(
        error instanceof Error ? error.message : "Une erreur est survenue."
      )
    } finally {
      setLoading(false)
    }
  }

  async function copyToken() {
    if (!enrollment?.token) {
      return
    }

    await navigator.clipboard.writeText(enrollment.token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (server && enrollment) {
    const expiresAt = new Date(enrollment.expiresAt)

    return (
      <div className="mx-auto max-w-3xl space-y-8">
        <PageHeader
          back={{ href: "/servers", label: "Retour aux serveurs" }}
          title="Serveur créé"
          description="Le serveur a été enregistré. Il reste à enrôler son Agent."
        />

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-success/10 text-success [&_svg]:size-5">
                <CheckCircle2 />
              </span>
              <div>
                <CardTitle>{server.name}</CardTitle>
                <CardDescription className="font-mono text-xs">
                  {server.hostname}
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="grid gap-4 rounded-lg border border-border bg-muted/30 p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Hostname</p>
                <p className="mt-0.5 font-mono text-sm font-medium">
                  {server.hostname}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Adresse IP</p>
                <p className="mt-0.5 font-mono text-sm font-medium">
                  {server.ip_address ?? "Non renseignée"}
                </p>
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold">Enrôler l'Agent</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Exécutez cette commande sur le VPS. Le token expire à{" "}
                {expiresAt.toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                .
              </p>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Token d'enrôlement
                </span>
                <Button variant="secondary" size="sm" onClick={copyToken}>
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Copié" : "Copier"}
                </Button>
              </div>
              <code className="block break-all rounded-md bg-card p-3 font-mono text-xs">
                {enrollment.token}
              </code>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Sur le VPS</p>
              <pre className="overflow-x-auto rounded-lg border border-border bg-zinc-950 p-4 font-mono text-xs leading-5 text-zinc-300">
                <code>
                  {`cd /opt/hosting-platform/apps/agent

PANEL_URL="https://fill-laden-inform-dog.trycloudflare.com" \\
ENROLLMENT_TOKEN="TON_TOKEN" \\
AGENT_HOSTNAME="${server.hostname}" \\
pnpm enroll`}
                </code>
              </pre>
            </div>

            <div className="flex gap-3 rounded-lg border border-warning/25 bg-warning/5 p-4 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
              <p className="text-muted-foreground">
                Ce token est temporaire et ne doit pas être partagé. Une fois
                l'Agent enrôlé, il recevra automatiquement son token permanent.
              </p>
            </div>

            <Link
              href={`/servers/${server.id}`}
              className={cn(
                buttonVariants({ variant: "primary" }),
                "w-full"
              )}
            >
              Voir le serveur
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader
        back={{ href: "/servers", label: "Retour aux serveurs" }}
        title="Ajouter un serveur"
        description="Enregistrez un nouveau VPS ou serveur Docker dans votre infrastructure."
      />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-5">
              <Server />
            </span>
            <div>
              <CardTitle>Informations du serveur</CardTitle>
              <CardDescription>
                Ces informations seront utilisées pour identifier votre serveur.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                Nom du serveur
              </label>
              <Input
                id="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="VPS OVH Production"
                required
                maxLength={100}
              />
              <p className="text-xs text-muted-foreground">
                Exemple : VPS OVH Production
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="hostname" className="text-sm font-medium">
                Hostname
              </label>
              <Input
                id="hostname"
                value={hostname}
                onChange={(event) => setHostname(event.target.value)}
                placeholder="vps-0d470bf2.vps.ovh.net"
                required
                maxLength={255}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="ipAddress" className="text-sm font-medium">
                Adresse IP
              </label>
              <Input
                id="ipAddress"
                value={ipAddress}
                onChange={(event) => setIpAddress(event.target.value)}
                placeholder="51.83.78.56"
                maxLength={45}
              />
            </div>

            {error && (
              <div className="rounded-lg border border-danger/25 bg-danger/5 p-4 text-sm text-danger">
                {error}
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? <Spinner className="text-current" /> : <Server />}
              {loading ? "Création en cours…" : "Créer et générer le token"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
