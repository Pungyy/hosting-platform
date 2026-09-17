import { redirect } from "next/navigation"

import { AppShell } from "@/components/app-shell"
import { getCurrentSession } from "@/lib/auth/session"

/*
 * proxy.ts ne vérifie que la PRÉSENCE du cookie (contrôle optimiste) —
 * un cookie présent mais invalide/expiré (session révoquée, ex. juste
 * après un logout côté serveur qui aurait échoué à effacer le cookie
 * client) laisserait sinon passer un AppShell affichant de fausses
 * informations utilisateur avec un bouton "Se déconnecter" inutile.
 * Ce layout fait la validation réelle une seule fois, en amont de
 * toutes les pages protégées.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getCurrentSession()

  if (!session) {
    redirect("/login")
  }

  return (
    <AppShell
      user={{
        name: session.name,
        email: session.email,
        role: session.role,
      }}
    >
      {children}
    </AppShell>
  )
}
