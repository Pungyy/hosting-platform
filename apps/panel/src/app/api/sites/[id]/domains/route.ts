import { NextResponse } from "next/server"

import { query } from "@/lib/database"

type RouteContext = {
  params: Promise<{
    id: string
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

const AGENT_URL =
  process.env.AGENT_URL

const AGENT_TOKEN =
  process.env.AGENT_TOKEN

function isValidDomain(
  domain: string,
) {
  return /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(
    domain,
  )
}

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
  id: string,
) {
  const result =
    await query<{
      id: string
      name: string
    }>(
      `
        SELECT
          id,
          name
        FROM sites
        WHERE id = $1
        LIMIT 1
      `,
      [id],
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
 * GET
 *
 * Récupère tous les domaines du site.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext,
) {
  try {
    const { id } =
      await params

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

    const domainsResult =
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

    return NextResponse.json({
      status: "ok",
      domains:
        domainsResult.rows,
    })
  } catch (error) {
    console.error(
      "GET /api/sites/[id]/domains error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de récupérer les domaines.",
      },
      {
        status: 500,
      },
    )
  }
}

/*
 * POST
 *
 * Ajoute un domaine au site
 * puis synchronise Traefik.
 */
export async function POST(
  request: Request,
  { params }: RouteContext,
) {
  try {
    const { id } =
      await params

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

    const body =
      await request
        .json()
        .catch(() => null)

    const rawDomain =
      typeof body?.domain === "string"
        ? body.domain
        : ""

    const domain =
      rawDomain
        .trim()
        .toLowerCase()

    if (!domain) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Le domaine est obligatoire.",
        },
        {
          status: 400,
        },
      )
    }

    if (!isValidDomain(domain)) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Le nom de domaine est invalide.",
        },
        {
          status: 400,
        },
      )
    }

    const existingDomain =
      await query<{
        id: string
        site_id: string
      }>(
        `
          SELECT
            id,
            site_id
          FROM domains
          WHERE domain = $1
          LIMIT 1
        `,
        [domain],
      )

    if (
      existingDomain.rows.length > 0
    ) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Ce domaine est déjà utilisé.",
        },
        {
          status: 409,
        },
      )
    }

    const primaryDomain =
      await query<{
        id: string
      }>(
        `
          SELECT id
          FROM domains
          WHERE site_id = $1
            AND is_primary = TRUE
          LIMIT 1
        `,
        [id],
      )

    const isPrimary =
      primaryDomain.rows.length === 0

    const result =
      await query<DomainRow>(
        `
          INSERT INTO domains (
            site_id,
            domain,
            is_primary,
            ssl_enabled
          )
          VALUES (
            $1,
            $2,
            $3,
            FALSE
          )
          RETURNING
            id,
            site_id,
            domain,
            is_primary,
            ssl_enabled,
            created_at,
            updated_at
        `,
        [
          id,
          domain,
          isPrimary,
        ],
      )

    const domains =
      await getSiteDomains(id)

    try {
      await syncDomainsWithAgent(
        site.name,
        domains,
      )
    } catch (syncError) {
      /*
       * Rollback manuel si Traefik
       * n'a pas pu être synchronisé.
       */
      await query(
        `
          DELETE FROM domains
          WHERE id = $1
        `,
        [result.rows[0].id],
      )

      throw syncError
    }

    return NextResponse.json(
      {
        status: "ok",
        domain:
          result.rows[0],
      },
      {
        status: 201,
      },
    )
  } catch (error) {
    console.error(
      "POST /api/sites/[id]/domains error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible d'ajouter le domaine.",
      },
      {
        status: 500,
      },
    )
  }
}