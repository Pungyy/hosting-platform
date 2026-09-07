import { NextResponse } from "next/server"

import { query } from "@/lib/database"

type RouteContext = {
  params: Promise<{
    id: string
    domainId: string
  }>
}

type DomainRow = {
  id: string
  site_id: string
  domain: string
  is_primary: boolean
  ssl_enabled: boolean
  created_at: string
  updated_at: string
}

type SiteRow = {
  id: string
  name: string
}

type UpdateDomainBody = {
  isPrimary?: unknown
  sslEnabled?: unknown
}

const AGENT_URL =
  process.env.AGENT_URL

const AGENT_TOKEN =
  process.env.AGENT_TOKEN

async function syncDomainsWithAgent(
  siteName: string,
  domains: Array<{
    domain: string
    sslEnabled: boolean
  }>,
) {
  if (
    !AGENT_URL ||
    !AGENT_TOKEN
  ) {
    throw new Error(
      "Configuration Agent manquante.",
    )
  }

  const response =
    await fetch(
      `${AGENT_URL}/sites/${encodeURIComponent(
        siteName,
      )}/domains`,
      {
        method: "PUT",
        headers: {
          Authorization:
            `Bearer ${AGENT_TOKEN}`,
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          domains,
        }),
        cache: "no-store",
      },
    )

  const data =
    await response
      .json()
      .catch(() => null)

  if (!response.ok) {
    throw new Error(
      data?.message ??
        "Impossible de synchroniser les domaines avec Traefik.",
    )
  }

  return data
}

async function getSite(
  siteId: string,
) {
  const result =
    await query<SiteRow>(
      `
        SELECT
          id,
          name
        FROM sites
        WHERE id = $1
        LIMIT 1
      `,
      [siteId],
    )

  return result.rows[0] ?? null
}

async function getSiteDomains(
  siteId: string,
) {
  const result =
    await query<{
      domain: string
      ssl_enabled: boolean
    }>(
      `
        SELECT
          domain,
          ssl_enabled
        FROM domains
        WHERE site_id = $1
        ORDER BY
          is_primary DESC,
          created_at ASC
      `,
      [siteId],
    )

  return result.rows.map(
    (row) => ({
      domain:
        row.domain,

      sslEnabled:
        row.ssl_enabled,
    }),
  )
}

/*
 * ============================================================
 * PATCH
 * ============================================================
 *
 * Modifie un domaine.
 *
 * Body accepté :
 *
 * {
 *   "isPrimary": true
 * }
 *
 * ou :
 *
 * {
 *   "sslEnabled": true
 * }
 *
 * ou les deux.
 */

function isLocalhostDomain(domain: string) {
  const normalized = domain.trim().toLowerCase()

  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost")
  )
}

export async function PATCH(
  request: Request,
  { params }: RouteContext,
) {
  try {
    const {
      id,
      domainId,
    } = await params

    const site =
      await getSite(id)

    if (!site) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Site introuvable.",
        },
        {
          status: 404,
        },
      )
    }

    const domainResult =
      await query<DomainRow>(
        `
          SELECT
            id,
            site_id,
            domain,
            is_primary,
            ssl_enabled,
            created_at,
            updated_at
          FROM domains
          WHERE id = $1
            AND site_id = $2
          LIMIT 1
        `,
        [
          domainId,
          id,
        ],
      )

    if (
      domainResult.rows.length === 0
    ) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Domaine introuvable.",
        },
        {
          status: 404,
        },
      )
    }

    const currentDomain =
      domainResult.rows[0]

    const body =
      await request
        .json()
        .catch(() => ({}))

    const parsedBody =
      body as UpdateDomainBody

    /*
     * Vérification du body.
     */
    if (
      parsedBody.isPrimary !==
        undefined &&
      typeof parsedBody.isPrimary !==
        "boolean"
    ) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "isPrimary doit être un booléen.",
        },
        {
          status: 400,
        },
      )
    }

    if (
      parsedBody.sslEnabled !==
        undefined &&
      typeof parsedBody.sslEnabled !==
        "boolean"
    ) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "sslEnabled doit être un booléen.",
        },
        {
          status: 400,
        },
      )
    }

    const wantsPrimary =
      parsedBody.isPrimary === true

    const wantsSsl =
      parsedBody.sslEnabled !==
      undefined
        ? parsedBody.sslEnabled
        : currentDomain.ssl_enabled

    /*
     * Les domaines .localhost sont réservés
     * au développement local et ne peuvent pas
     * recevoir de certificat Let's Encrypt.
     */
    if (
      wantsSsl &&
      isLocalhostDomain(
        currentDomain.domain,
      )
    ) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Le SSL ne peut pas être activé sur un domaine .localhost. Utilisez un domaine public.",
        },
        {
          status: 400,
        },
      )
    }

    /*
     * On ne permet pas de retirer
     * le statut principal directement.
     *
     * Pour changer de principal,
     * on choisit simplement un autre domaine.
     */
    if (
      parsedBody.isPrimary === false &&
      currentDomain.is_primary
    ) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Impossible de retirer le statut principal sans définir un autre domaine principal.",
        },
        {
          status: 409,
        },
      )
    }

    /*
     * Sauvegarde de l'état précédent
     * pour pouvoir restaurer la BDD
     * si Traefik échoue.
     */
    const previousDomainsResult =
      await query<DomainRow>(
        `
          SELECT
            id,
            site_id,
            domain,
            is_primary,
            ssl_enabled,
            created_at,
            updated_at
          FROM domains
          WHERE site_id = $1
          ORDER BY
            is_primary DESC,
            created_at ASC
        `,
        [id],
      )

    const previousDomains =
      previousDomainsResult.rows

    /*
     * Changement de domaine principal.
     */
    if (wantsPrimary) {
      await query(
        `
          UPDATE domains
          SET
            is_primary = FALSE,
            updated_at = NOW()
          WHERE site_id = $1
        `,
        [id],
      )

      await query(
        `
          UPDATE domains
          SET
            is_primary = TRUE,
            updated_at = NOW()
          WHERE id = $1
            AND site_id = $2
        `,
        [
          domainId,
          id,
        ],
      )
    }

    /*
     * Modification du SSL.
     */
    if (
      parsedBody.sslEnabled !==
      undefined
    ) {
      await query(
        `
          UPDATE domains
          SET
            ssl_enabled = $1,
            updated_at = NOW()
          WHERE id = $2
            AND site_id = $3
        `,
        [
          wantsSsl,
          domainId,
          id,
        ],
      )
    }

    /*
     * Récupération du nouvel état.
     */
    const updatedResult =
      await query<DomainRow>(
        `
          SELECT
            id,
            site_id,
            domain,
            is_primary,
            ssl_enabled,
            created_at,
            updated_at
          FROM domains
          WHERE id = $1
            AND site_id = $2
          LIMIT 1
        `,
        [
          domainId,
          id,
        ],
      )

    const updatedDomain =
      updatedResult.rows[0]

    /*
     * Synchronisation Traefik.
     */
    try {
      const domains =
        await getSiteDomains(id)

      await syncDomainsWithAgent(
        site.name,
        domains,
      )
    } catch (syncError) {
      /*
       * Restauration de l'état précédent.
       */
      await query(
        `
          DELETE FROM domains
          WHERE site_id = $1
        `,
        [id],
      )

      for (
        const previousDomain
        of previousDomains
      ) {
        await query(
          `
            INSERT INTO domains (
              id,
              site_id,
              domain,
              is_primary,
              ssl_enabled,
              created_at,
              updated_at
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7
            )
          `,
          [
            previousDomain.id,
            previousDomain.site_id,
            previousDomain.domain,
            previousDomain.is_primary,
            previousDomain.ssl_enabled,
            previousDomain.created_at,
            previousDomain.updated_at,
          ],
        )
      }

      throw syncError
    }

    return NextResponse.json({
      status: "ok",
      domain:
        updatedDomain,
    })
  } catch (error) {
    console.error(
      "PATCH /api/sites/[id]/domains/[domainId] error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de modifier le domaine.",
      },
      {
        status: 500,
      },
    )
  }
}

/*
 * ============================================================
 * DELETE
 * ============================================================
 */

export async function DELETE(
  _request: Request,
  { params }: RouteContext,
) {
  try {
    const {
      id,
      domainId,
    } = await params

    const site =
      await getSite(id)

    if (!site) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Site introuvable.",
        },
        {
          status: 404,
        },
      )
    }

    const domainResult =
      await query<DomainRow>(
        `
          SELECT
            id,
            site_id,
            domain,
            is_primary,
            ssl_enabled,
            created_at,
            updated_at
          FROM domains
          WHERE id = $1
            AND site_id = $2
          LIMIT 1
        `,
        [
          domainId,
          id,
        ],
      )

    if (
      domainResult.rows.length === 0
    ) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Domaine introuvable.",
        },
        {
          status: 404,
        },
      )
    }

    const domain =
      domainResult.rows[0]

    /*
     * On ne peut pas supprimer
     * le domaine principal s'il existe
     * d'autres domaines.
     */
    if (
      domain.is_primary
    ) {
      const otherDomains =
        await query<{
          id: string
        }>(
          `
            SELECT
              id
            FROM domains
            WHERE site_id = $1
              AND id <> $2
            LIMIT 1
          `,
          [
            id,
            domainId,
          ],
        )

      if (
        otherDomains.rows.length > 0
      ) {
        return NextResponse.json(
          {
            status: "error",
            message:
              "Impossible de supprimer le domaine principal. Définissez d'abord un autre domaine comme principal.",
          },
          {
            status: 409,
          },
        )
      }
    }

    /*
     * Sauvegarde de l'état précédent.
     */
    const previousDomainsResult =
      await query<DomainRow>(
        `
          SELECT
            id,
            site_id,
            domain,
            is_primary,
            ssl_enabled,
            created_at,
            updated_at
          FROM domains
          WHERE site_id = $1
          ORDER BY
            is_primary DESC,
            created_at ASC
        `,
        [id],
      )

    const previousDomains =
      previousDomainsResult.rows

    /*
     * Suppression BDD.
     */
    await query(
      `
        DELETE FROM domains
        WHERE id = $1
          AND site_id = $2
      `,
      [
        domainId,
        id,
      ],
    )

    try {
      const domains =
        await getSiteDomains(id)

      /*
       * Un site doit conserver
       * au moins un domaine.
       */
      if (
        domains.length === 0
      ) {
        throw new Error(
          "Un site doit conserver au moins un domaine.",
        )
      }

      await syncDomainsWithAgent(
        site.name,
        domains,
      )
    } catch (syncError) {
      /*
       * Restauration de la BDD.
       */
      await query(
        `
          DELETE FROM domains
          WHERE site_id = $1
        `,
        [id],
      )

      for (
        const previousDomain
        of previousDomains
      ) {
        await query(
          `
            INSERT INTO domains (
              id,
              site_id,
              domain,
              is_primary,
              ssl_enabled,
              created_at,
              updated_at
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7
            )
          `,
          [
            previousDomain.id,
            previousDomain.site_id,
            previousDomain.domain,
            previousDomain.is_primary,
            previousDomain.ssl_enabled,
            previousDomain.created_at,
            previousDomain.updated_at,
          ],
        )
      }

      throw syncError
    }

    return NextResponse.json({
      status: "ok",
      message:
        "Domaine supprimé.",
      domain,
    })
  } catch (error) {
    console.error(
      "DELETE /api/sites/[id]/domains/[domainId] error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de supprimer le domaine.",
      },
      {
        status: 500,
      },
    )
  }
}