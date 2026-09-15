"use client"

import {
  ArrowRight,
  Boxes,
  Eye,
  EyeOff,
  LockKeyhole,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { FormEvent, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

export default function LoginPage() {
  const router = useRouter()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    setError(null)
    setLoading(true)

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(
          data.message || "Adresse email ou mot de passe incorrect."
        )
      }

      router.push("/")
      router.refresh()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Une erreur est survenue lors de la connexion."
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen">
      {/* LEFT */}
      <section className="relative hidden w-1/2 overflow-hidden border-r border-border bg-card lg:flex">
        <div className="absolute inset-0 bg-gradient-to-br from-brand/8 via-transparent to-transparent" />

        <div className="relative z-10 flex w-full flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Boxes className="size-5" />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold">Hosting Platform</p>
              <p className="text-xs text-muted-foreground">Infrastructure</p>
            </div>
          </div>

          <div className="max-w-md">
            <h1 className="font-heading text-4xl font-semibold tracking-tight xl:text-[2.75rem] xl:leading-[1.1]">
              Gérez votre infrastructure,{" "}
              <span className="text-muted-foreground">simplement.</span>
            </h1>

            <p className="mt-5 text-base leading-7 text-muted-foreground">
              Déployez vos applications, surveillez vos serveurs et gérez votre
              infrastructure depuis une seule plateforme.
            </p>

            <div className="mt-8 space-y-3">
              <Feature
                title="Déploiements simplifiés"
                description="Déployez vos projets directement depuis Git."
              />
              <Feature
                title="Surveillance en temps réel"
                description="CPU, mémoire, stockage et état de vos serveurs."
              />
              <Feature
                title="Infrastructure centralisée"
                description="Gérez plusieurs serveurs depuis un seul Panel."
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Hosting Platform · Infrastructure
          </p>
        </div>
      </section>

      {/* RIGHT */}
      <section className="flex flex-1 items-center justify-center bg-background p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Boxes className="size-5" />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold">Hosting Platform</p>
              <p className="text-xs text-muted-foreground">Infrastructure</p>
            </div>
          </div>

          <div className="mb-8">
            <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-5">
              <LockKeyhole />
            </span>
            <h2 className="mt-5 font-heading text-2xl font-semibold tracking-tight">
              Bon retour
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Connectez-vous à votre espace d&apos;administration.
            </p>
          </div>

          {error && (
            <div className="mb-5 rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Adresse email
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@hosting.local"
                autoComplete="email"
                required
                disabled={loading}
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Mot de passe
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Votre mot de passe"
                  autoComplete="current-password"
                  required
                  disabled={loading}
                  className="h-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  disabled={loading}
                  aria-label={
                    showPassword
                      ? "Masquer le mot de passe"
                      : "Afficher le mot de passe"
                  }
                  className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              size="lg"
              disabled={loading || !email || !password}
              className="group w-full"
            >
              {loading ? (
                <>
                  <Spinner className="text-current" />
                  Connexion…
                </>
              ) : (
                <>
                  Se connecter
                  <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </Button>
          </form>

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Accès réservé aux utilisateurs autorisés.
          </p>
        </div>
      </section>
    </main>
  )
}

function Feature({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex gap-3 rounded-lg border border-border bg-background/60 p-3.5">
      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  )
}
