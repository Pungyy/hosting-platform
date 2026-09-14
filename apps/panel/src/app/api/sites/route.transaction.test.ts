import { randomUUID } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Queryer } from "@/lib/database"
import { createTestServer, createTestUser } from "@/test/fixtures"
import { testPool } from "@/test/testDatabase"

/*
 * Finding M3-1 (correction) — preuve, avec un VRAI Postgres (pas de
 * mock sur la propriété transactionnelle elle-même), que INSERT sites
 * + INSERT domains sont désormais atomiques : soit les deux lignes
 * existent, soit aucune des deux, et le quota reste toujours cohérent
 * avec le nombre réel de sites.
 *
 * @/lib/database est redirigé vers testPool (base de test dédiée,
 * jamais hosting_platform) — c'est le SEUL moyen de faire tourner le
 * VRAI code de la route (celui qui appelle réellement pool.connect(),
 * BEGIN, COMMIT, ROLLBACK) contre un Postgres réel. pool.connect() est
 * enveloppé pour pouvoir forcer, de façon déterministe et ciblée,
 * l'échec du SEUL INSERT domains (impossible à provoquer via une
 * requête HTTP légitime : ON CONFLICT DO NOTHING absorbe le seul
 * conflit réaliste sur ce statement, l'unicité de `domain`) — tout le
 * reste (BEGIN, INSERT sites, ROLLBACK, la connexion elle-même) passe
 * par un client Postgres RÉEL obtenu via testPool.connect().
 */

const { forceDomainsInsertFailure } = vi.hoisted(() => ({
  forceDomainsInsertFailure: { value: false },
}))

const {
  mockRequireSession,
  mockResolveListScope,
  mockCreateAgentSite,
  mockDeleteAgentSite,
  mockGetAgentSiteStatuses,
} = vi.hoisted(() => ({
  mockRequireSession: vi.fn(),
  mockResolveListScope: vi.fn(),
  mockCreateAgentSite: vi.fn(),
  mockDeleteAgentSite: vi.fn(),
  mockGetAgentSiteStatuses: vi.fn(),
}))

vi.mock("@/lib/auth/guard", () => ({
  requireSession: mockRequireSession,
}))

vi.mock("@/lib/auth/roles", () => ({
  resolveListScope: mockResolveListScope,
}))

vi.mock("@/lib/agent/client", () => ({
  createAgentSite: mockCreateAgentSite,
  deleteAgentSite: mockDeleteAgentSite,
  getAgentSiteStatuses: mockGetAgentSiteStatuses,
}))

vi.mock("@/lib/database", () => ({
  query: (text: string, values?: unknown[]) => testPool.query(text, values),
  pool: {
    connect: async () => {
      const realClient = await testPool.connect()

      return {
        query: (text: string, values?: unknown[]) => {
          if (
            forceDomainsInsertFailure.value &&
            typeof text === "string" &&
            text.includes("INSERT INTO domains")
          ) {
            return Promise.reject(
              new Error(
                "Échec Postgres simulé sur INSERT domains (test M3-1).",
              ),
            )
          }

          return realClient.query(text, values)
        },
        release: (errOrDestroy?: boolean | Error) => {
          realClient.release(errOrDestroy)
        },
      }
    },
  },
}))

import { POST } from "./route"

function sessionFor(userId: string) {
  return {
    session: {
      session_id: "session-1",
      user_id: userId,
      email: "u@example.com",
      name: "Test User",
      role: "user" as const,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    },
    response: null,
  }
}

function postRequest(name: string) {
  return new Request("http://panel.local/api/sites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  })
}

async function realSiteCount(userId: string): Promise<number> {
  const result = await testPool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM sites WHERE user_id = $1`,
    [userId],
  )
  return Number(result.rows[0].count)
}

async function quotaCount(userId: string): Promise<number> {
  const result = await testPool.query<{ count: number }>(
    `
      SELECT count FROM user_resource_quotas
      WHERE user_id = $1 AND resource_type = 'site'
    `,
    [userId],
  )
  return result.rows[0]?.count ?? 0
}

async function cleanup(userId: string, serverId: string) {
  await testPool.query(`DELETE FROM sites WHERE user_id = $1`, [userId])
  await testPool.query(
    `DELETE FROM user_resource_quotas WHERE user_id = $1`,
    [userId],
  )
  await testPool.query(`DELETE FROM users WHERE id = $1`, [userId])
  await testPool.query(`DELETE FROM servers WHERE id = $1`, [serverId])
}

describe("POST /api/sites — transaction réelle sites+domains (finding M3-1, correction)", () => {
  const poolDb: Queryer = testPool

  beforeEach(() => {
    vi.clearAllMocks()
    forceDomainsInsertFailure.value = false
  })

  it(
    "succès : INSERT sites + INSERT domains committent ensemble, " +
      "count quota === nombre réel de sites",
    async () => {
      const owner = await createTestUser(poolDb)
      const server = await createTestServer(poolDb)
      const siteName = `tx-ok-${randomUUID().slice(0, 8)}`

      try {
        mockRequireSession.mockResolvedValue(sessionFor(owner.id))
        mockCreateAgentSite.mockResolvedValue({
          site: {
            id: "container-1",
            name: siteName,
            containerName: `hosting-site-${siteName}`,
            image: "nginx",
            state: "running",
            running: true,
          },
        })

        const response = await POST(postRequest(siteName))
        expect(response.status).toBe(201)

        const siteRow = await testPool.query<{ id: string }>(
          `SELECT id FROM sites WHERE user_id = $1 AND name = $2`,
          [owner.id, siteName],
        )
        expect(siteRow.rowCount).toBe(1)

        const domainRow = await testPool.query(
          `SELECT id FROM domains WHERE site_id = $1`,
          [siteRow.rows[0].id],
        )
        expect(domainRow.rowCount).toBe(1)

        expect(await realSiteCount(owner.id)).toBe(1)
        expect(await quotaCount(owner.id)).toBe(1)
      } finally {
        await cleanup(owner.id, server.id)
      }
    },
  )

  it(
    "échec RÉEL de l'INSERT domains après succès de l'INSERT sites -> " +
      "ROLLBACK complet (aucun site résiduel) ET quota restauré à 0 " +
      "(jamais count < lignes réelles)",
    async () => {
      const owner = await createTestUser(poolDb)
      const server = await createTestServer(poolDb)
      const siteName = `tx-fail-${randomUUID().slice(0, 8)}`

      try {
        mockRequireSession.mockResolvedValue(sessionFor(owner.id))
        mockCreateAgentSite.mockResolvedValue({
          site: {
            id: "container-2",
            name: siteName,
            containerName: `hosting-site-${siteName}`,
            image: "nginx",
            state: "running",
            running: true,
          },
        })
        mockDeleteAgentSite.mockResolvedValue({ status: "ok" })

        forceDomainsInsertFailure.value = true

        const response = await POST(postRequest(siteName))
        expect(response.status).toBe(500)

        /*
         * La preuve centrale de la correction : malgré un INSERT
         * sites qui a réellement réussi (committé) au milieu de la
         * transaction, le ROLLBACK déclenché par l'échec du SEUL
         * INSERT domains a bien annulé les DEUX écritures.
         */
        const siteRow = await testPool.query(
          `SELECT id FROM sites WHERE user_id = $1 AND name = $2`,
          [owner.id, siteName],
        )
        expect(siteRow.rowCount).toBe(0)

        const realCount = await realSiteCount(owner.id)
        const quota = await quotaCount(owner.id)

        expect(realCount).toBe(0)
        expect(quota).toBe(0)
        /*
         * L'invariant exact demandé : le compteur de quota ne peut
         * jamais devenir strictement inférieur au nombre réel de
         * sites de cet utilisateur.
         */
        expect(quota).toBeGreaterThanOrEqual(realCount)

        /*
         * Le nettoyage Agent a bien été tenté pour CE site — le
         * premier argument (l'id du serveur choisi) n'est PAS vérifié
         * strictement contre `server.id` : la route sélectionne "le
         * premier serveur joignable" par une requête globale sur toute
         * la table `servers` (logique préexistante, indépendante de
         * M3-1), qui peut légitimement retourner un AUTRE serveur créé
         * par un test s'exécutant en parallèle dans un fichier
         * différent lors d'une exécution complète de la suite — sans
         * jamais affecter les invariants réellement testés ici
         * (absence de site résiduel, cohérence du quota).
         */
        expect(mockDeleteAgentSite).toHaveBeenCalledWith(
          expect.any(String),
          siteName,
        )
      } finally {
        await cleanup(owner.id, server.id)
      }
    },
  )
})
