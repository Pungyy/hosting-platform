import { NextResponse } from "next/server"
import { z } from "zod"

import { requireSession } from "@/lib/auth/guard"
import { query } from "@/lib/database"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

/*
 * Doit rester aligné sur la contrainte SQL `sites_repository_url_check`
 * (migration 002) et sur `GITHUB_REPOSITORY_REGEX` de l'Agent.
 */
const GITHUB_URL_REGEX =
  /^https:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?$/

const BRANCH_REGEX = /^[A-Za-z0-9._/-]+$/

const updateSiteSchema = z
  .object({
    repositoryUrl: z
      .union([
        z.literal(""),
        z
          .string()
          .trim()
          .max(500)
          .regex(
            GITHUB_URL_REGEX,
            "URL GitHub invalide. Format attendu : https://github.com/utilisateur/depot",
          ),
      ])
      .optional(),

    repositoryBranch: z
      .string()
      .trim()
      .max(255)
      .regex(BRANCH_REGEX, "Nom de branche invalide.")
      .optional(),
  })
  .refine(
    (data) =>
      data.repositoryUrl !== undefined ||
      data.repositoryBranch !== undefined,
    { message: "Aucune donnée à modifier." },
  )

const AGENT_URL =
  process.env.AGENT_URL

const AGENT_TOKEN =
  process.env.AGENT_TOKEN

export async function GET(
  _request: Request,
  { params }: RouteContext,
) {
  try {
    const { response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const result = await query(
      `
        SELECT
          s.id,
          s.name,
          s.container_name,
          s.container_id,
          s.image,
          s.status,
          s.created_at,
          s.server_id,
          s.repository_url,
          s.repository_branch,
          srv.name AS server_name,
          srv.hostname AS server_hostname
        FROM sites s
        LEFT JOIN servers srv
          ON srv.id = s.server_id
        WHERE s.id = $1
        LIMIT 1
      `,
      [id],
    )

    if (result.rows.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          message: "Site introuvable.",
        },
        {
          status: 404,
        },
      )
    }

    return NextResponse.json({
      status: "ok",
      site: result.rows[0],
    })
  } catch (error) {
    console.error(
      "GET /api/sites/[id] error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          "Impossible de récupérer le site.",
      },
      {
        status: 500,
      },
    )
  }
}

/*
 * PATCH /api/sites/[id]
 *
 * Met à jour la configuration GitHub du site
 * (URL du repository + branche à déployer).
 */
export async function PATCH(
  request: Request,
  { params }: RouteContext,
) {
  try {
    const { response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const body = await request.json().catch(() => null)

    const parsed = updateSiteSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          status: "error",
          message:
            parsed.error.issues[0]?.message ??
            "Données invalides.",
          errors: parsed.error.flatten(),
        },
        { status: 400 },
      )
    }

    const currentResult = await query<{
      repository_url: string | null
      repository_branch: string | null
    }>(
      `
        SELECT
          repository_url,
          repository_branch
        FROM sites
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    )

    if (currentResult.rows.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          message: "Site introuvable.",
        },
        { status: 404 },
      )
    }

    const current = currentResult.rows[0]

    const nextUrl =
      parsed.data.repositoryUrl === undefined
        ? current.repository_url
        : parsed.data.repositoryUrl.trim() === ""
          ? null
          : parsed.data.repositoryUrl.trim()

    const nextBranch =
      parsed.data.repositoryBranch === undefined
        ? current.repository_branch
        : parsed.data.repositoryBranch === ""
          ? "main"
          : parsed.data.repositoryBranch

    const updateResult = await query(
      `
        UPDATE sites
        SET
          repository_url = $1,
          repository_branch = $2,
          updated_at = NOW()
        WHERE id = $3
        RETURNING
          id,
          name,
          container_name,
          container_id,
          image,
          status,
          created_at,
          server_id,
          repository_url,
          repository_branch
      `,
      [nextUrl, nextBranch ?? "main", id],
    )

    return NextResponse.json({
      status: "ok",
      site: updateResult.rows[0],
    })
  } catch (error) {
    console.error(
      "PATCH /api/sites/[id] error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de modifier le site.",
      },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _request: Request,
  { params }: RouteContext,
) {
  try {
    const { response: authError } = await requireSession()
    if (authError) return authError

    if (
      !AGENT_URL ||
      !AGENT_TOKEN
    ) {
      return NextResponse.json(
        {
          status: "error",
          message:
            "Configuration Agent manquante.",
        },
        {
          status: 500,
        },
      )
    }

    const { id } = await params

    const result = await query<{
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

    if (result.rows.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          message: "Site introuvable.",
        },
        {
          status: 404,
        },
      )
    }

    const site =
      result.rows[0]

    const response =
      await fetch(
        `${AGENT_URL}/sites/${encodeURIComponent(
          site.name,
        )}`,
        {
          method: "DELETE",
          headers: {
            Authorization:
              `Bearer ${AGENT_TOKEN}`,
          },
          cache: "no-store",
        },
      )

    const data =
      await response
        .json()
        .catch(() => null)

    if (!response.ok) {
      return NextResponse.json(
        {
          status: "error",
          message:
            data?.message ??
            "Impossible de supprimer le site.",
        },
        {
          status: response.status,
        },
      )
    }

    await query(
      `
        DELETE FROM sites
        WHERE id = $1
      `,
      [id],
    )

    return NextResponse.json({
      status: "ok",
      message: "Site supprimé.",
      site,
    })
  } catch (error) {
    console.error(
      "DELETE /api/sites/[id] error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de supprimer le site.",
      },
      {
        status: 500,
      },
    )
  }
}