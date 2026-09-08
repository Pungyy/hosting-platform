"use client"

import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Rocket,
  Server,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { FormEvent, useState } from "react"

export default function LoginPage() {
  const router = useRouter()

  const [email, setEmail] =
    useState("")

  const [password, setPassword] =
    useState("")

  const [showPassword, setShowPassword] =
    useState(false)

  const [loading, setLoading] =
    useState(false)

  const [error, setError] =
    useState<string | null>(null)

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    setError(null)
    setLoading(true)

    try {
      const response =
        await fetch(
          "/api/auth/login",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              email,
              password,
            }),
          },
        )

      const data =
        await response.json()

      if (!response.ok) {
        throw new Error(
          data.message ||
            "Adresse email ou mot de passe incorrect.",
        )
      }

      router.push("/")
      router.refresh()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Une erreur est survenue lors de la connexion.",
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen bg-muted/30">
      {/* LEFT SIDE */}
      <section className="relative hidden overflow-hidden bg-background lg:flex lg:w-1/2">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-background" />

        <div className="relative z-10 flex w-full flex-col justify-between p-10 xl:p-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
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

          {/* Content */}
          <div className="max-w-lg">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Server className="h-7 w-7" />
            </div>

            <h1 className="text-4xl font-semibold tracking-tight xl:text-5xl">
              Gérez votre infrastructure
              <span className="text-primary">
                {" "}
                simplement.
              </span>
            </h1>

            <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">
              Déployez vos applications, surveillez
              vos serveurs et gérez votre infrastructure
              depuis une seule plateforme.
            </p>

            <div className="mt-8 grid gap-3">
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

          {/* Footer */}
          <p className="text-xs text-muted-foreground">
            Hosting Platform · Infrastructure
          </p>
        </div>
      </section>

      {/* RIGHT SIDE */}
      <section className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
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

          {/* Header */}
          <div className="mb-8">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <LockKeyhole className="h-6 w-6" />
            </div>

            <h2 className="text-3xl font-semibold tracking-tight">
              Bon retour
            </h2>

            <p className="mt-2 text-sm text-muted-foreground">
              Connectez-vous à votre espace
              d'administration.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-5 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
              <p className="text-sm text-destructive">
                {error}
              </p>
            </div>
          )}

          {/* Form */}
          <form
            onSubmit={handleSubmit}
            className="space-y-5"
          >
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="text-sm font-medium"
              >
                Adresse email
              </label>

              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(
                    event.target.value,
                  )
                }
                placeholder="admin@hosting.local"
                autoComplete="email"
                required
                disabled={loading}
                className="h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="password"
                className="text-sm font-medium"
              >
                Mot de passe
              </label>

              <div className="relative">
                <input
                  id="password"
                  type={
                    showPassword
                      ? "text"
                      : "password"
                  }
                  value={password}
                  onChange={(event) =>
                    setPassword(
                      event.target.value,
                    )
                  }
                  placeholder="Votre mot de passe"
                  autoComplete="current-password"
                  required
                  disabled={loading}
                  className="h-11 w-full rounded-lg border bg-background px-3 pr-11 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowPassword(
                      (value) => !value,
                    )
                  }
                  disabled={loading}
                  aria-label={
                    showPassword
                      ? "Masquer le mot de passe"
                      : "Afficher le mot de passe"
                  }
                  className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={
                loading ||
                !email ||
                !password
              }
              className="group flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />

                  Connexion...
                </>
              ) : (
                <>
                  Se connecter

                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          {/* Footer */}
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
    <div className="flex gap-3 rounded-xl border bg-background/70 p-4">
      <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />

      <div>
        <p className="text-sm font-medium">
          {title}
        </p>

        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  )
}