"use client"

import Link from "next/link"
import { FormEvent, useState } from "react"
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Loader2,
  Server,
} from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

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
  const [name, setName] =
    useState("")

  const [hostname, setHostname] =
    useState("")

  const [ipAddress, setIpAddress] =
    useState("")

  const [loading, setLoading] =
    useState(false)

  const [error, setError] =
    useState<string | null>(null)

  const [server, setServer] =
    useState<CreatedServer | null>(null)

  const [enrollment, setEnrollment] =
    useState<EnrollmentData | null>(null)

  const [copied, setCopied] =
    useState(false)

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    setLoading(true)
    setError(null)

    try {
      /*
       * 1. Création du serveur
       */
      const serverResponse =
        await fetch(
          "/api/servers",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              name,
              hostname,
              ipAddress,
            }),
          },
        )

      const serverData =
        await serverResponse.json()

      if (
        !serverResponse.ok ||
        serverData.status !== "ok"
      ) {
        throw new Error(
          serverData.message ??
            "Impossible de créer le serveur.",
        )
      }

      const createdServer =
        serverData.server as CreatedServer

      setServer(createdServer)

      /*
       * 2. Génération du token d'enrôlement
       */
      const enrollmentResponse =
        await fetch(
          `/api/servers/${createdServer.id}/enrollment`,
          {
            method: "POST",
          },
        )

      const enrollmentData =
        await enrollmentResponse.json()

      if (
        !enrollmentResponse.ok ||
        enrollmentData.status !== "ok"
      ) {
        throw new Error(
          enrollmentData.message ??
            "Impossible de générer le token d'enrôlement.",
        )
      }

      setEnrollment(
        enrollmentData.enrollment,
      )
    } catch (error) {
      console.error(
        "Erreur lors de l'ajout du serveur :",
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

  async function copyToken() {
    if (!enrollment?.token) {
      return
    }

    await navigator.clipboard.writeText(
      enrollment.token,
    )

    setCopied(true)

    setTimeout(
      () => setCopied(false),
      2000,
    )
  }

  if (server && enrollment) {
    const expiresAt =
      new Date(
        enrollment.expiresAt,
      )

    return (
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-4xl space-y-6 p-6">
          <Link
            href="/servers"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Retour aux serveurs
          </Link>

          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Serveur créé
            </h1>

            <p className="mt-2 text-muted-foreground">
              Le serveur a été enregistré.
              Il reste maintenant à enrôler
              son Agent.
            </p>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-500/10">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                </div>

                <div>
                  <CardTitle>
                    {server.name}
                  </CardTitle>

                  <CardDescription>
                    {server.hostname}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              <div className="grid gap-4 rounded-xl border bg-muted/20 p-5 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">
                    Hostname
                  </p>

                  <p className="mt-1 font-medium">
                    {server.hostname}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground">
                    Adresse IP
                  </p>

                  <p className="mt-1 font-medium">
                    {server.ip_address ??
                      "Non renseignée"}
                  </p>
                </div>
              </div>

              <Separator />

              <div>
                <h2 className="text-lg font-semibold">
                  Enrôler l'Agent
                </h2>

                <p className="mt-1 text-sm text-muted-foreground">
                  Exécute cette commande sur le
                  VPS. Le token expire à{" "}
                  {expiresAt.toLocaleTimeString(
                    "fr-FR",
                    {
                      hour: "2-digit",
                      minute: "2-digit",
                    },
                  )}.
                </p>
              </div>

              <div className="rounded-xl border bg-muted/30 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Token d'enrôlement
                  </span>

                  <button
                    type="button"
                    onClick={copyToken}
                    className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    {copied ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Copié
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copier
                      </>
                    )}
                  </button>
                </div>

                <code className="block break-all rounded-lg bg-background p-3 text-xs">
                  {enrollment.token}
                </code>
              </div>

              <div className="rounded-xl border bg-muted/20 p-5">
                <p className="mb-3 text-sm font-medium">
                  Sur le VPS
                </p>

                <pre className="overflow-x-auto rounded-lg bg-background p-4 text-xs">
                  <code>
{`cd /opt/hosting-platform/apps/agent

PANEL_URL="https://fill-laden-inform-dog.trycloudflare.com" \\
ENROLLMENT_TOKEN="TON_TOKEN" \\
AGENT_HOSTNAME="${server.hostname}" \\
pnpm enroll`}
                  </code>
                </pre>
              </div>

              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 text-sm">
                <p className="font-medium">
                  ⚠️ Important
                </p>

                <p className="mt-1 text-muted-foreground">
                  Ce token est temporaire et ne
                  doit pas être partagé. Une fois
                  l'Agent enrôlé, il recevra
                  automatiquement son token
                  permanent.
                </p>
              </div>

              <Link
                href={`/servers/${server.id}`}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Voir le serveur
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <Link
          href="/servers"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour aux serveurs
        </Link>

        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Ajouter un serveur
          </h1>

          <p className="mt-2 text-muted-foreground">
            Enregistre un nouveau VPS ou serveur
            Docker dans ton infrastructure.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Server className="h-5 w-5 text-primary" />
              </div>

              <div>
                <CardTitle>
                  Informations du serveur
                </CardTitle>

                <CardDescription>
                  Ces informations seront utilisées
                  pour identifier ton serveur.
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <form
              onSubmit={handleSubmit}
              className="space-y-5"
            >
              <div className="space-y-2">
                <label
                  htmlFor="name"
                  className="text-sm font-medium"
                >
                  Nom du serveur
                </label>

                <input
                  id="name"
                  value={name}
                  onChange={(event) =>
                    setName(event.target.value)
                  }
                  placeholder="VPS OVH"
                  required
                  maxLength={100}
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-primary"
                />

                <p className="text-xs text-muted-foreground">
                  Exemple : VPS OVH Production
                </p>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="hostname"
                  className="text-sm font-medium"
                >
                  Hostname
                </label>

                <input
                  id="hostname"
                  value={hostname}
                  onChange={(event) =>
                    setHostname(event.target.value)
                  }
                  placeholder="vps-0d470bf2.vps.ovh.net"
                  required
                  maxLength={255}
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="ipAddress"
                  className="text-sm font-medium"
                >
                  Adresse IP
                </label>

                <input
                  id="ipAddress"
                  value={ipAddress}
                  onChange={(event) =>
                    setIpAddress(event.target.value)
                  }
                  placeholder="51.83.78.56"
                  maxLength={45}
                  className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-primary"
                />
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Création en cours...
                  </>
                ) : (
                  <>
                    <Server className="h-4 w-4" />
                    Créer et générer le token
                  </>
                )}
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}