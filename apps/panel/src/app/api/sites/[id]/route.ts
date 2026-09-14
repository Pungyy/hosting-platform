import { NextResponse } from "next/server"
import { z } from "zod"

import { requireSession } from "@/lib/auth/guard"
import { deleteAgentSite } from "@/lib/agent/client"
import { query } from "@/lib/database"
import { apiErrorResponse } from "@/lib/http/api-error"
import { getOwnedSite } from "@/lib/resources/sites"

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

export async function GET(
  _request: Request,
  { params }: RouteContext,
) {
  try {
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const { site, response: ownedError } = await getOwnedSite(id, session)
    if (ownedError) return ownedError

    return NextResponse.json({
      status: "ok",
      site,
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
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const { site: current, response: ownedError } = await getOwnedSite(
      id,
      session,
    )
    if (ownedError) return ownedError

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
    return apiErrorResponse(
      error,
      "PATCH /api/sites/[id] error:",
      "Impossible de modifier le site.",
    )
  }
}

export async function DELETE(
  _request: Request,
  { params }: RouteContext,
) {
  try {
    const { session, response: authError } = await requireSession()
    if (authError) return authError

    const { id } = await params

    const { site, response: ownedError } = await getOwnedSite(id, session)
    if (ownedError) return ownedError

    try {
      await deleteAgentSite(site.server_id, site.name)
    } catch (agentError) {
      return apiErrorResponse(
        agentError,
        "DELETE /api/sites/[id] (agent) error:",
        "Impossible de supprimer le site.",
        502,
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
    return apiErrorResponse(
      error,
      "DELETE /api/sites/[id] error:",
      "Impossible de supprimer le site.",
    )
  }
}
