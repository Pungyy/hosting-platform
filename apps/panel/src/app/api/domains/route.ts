import { NextResponse } from "next/server"

import { requireSession } from "@/lib/auth/guard"
import { query } from "@/lib/database"

/*
 * GET /api/domains
 *
 * Vue globale de tous les domaines, tous sites confondus.
 * Les mutations (ajout, principal, SSL, suppression) restent sur
 * /api/sites/[id]/domains — cette route est en lecture seule.
 */
export async function GET() {
  try {
    const { response: authError } = await requireSession()
    if (authError) return authError

    const result = await query<{
      id: string
      site_id: string
      domain: string
      is_primary: boolean
      ssl_enabled: boolean
      created_at: string
      updated_at: string
      site_name: string
      site_status: string
    }>(`
      SELECT
        d.id,
        d.site_id,
        d.domain,
        d.is_primary,
        d.ssl_enabled,
        d.created_at,
        d.updated_at,
        s.name AS site_name,
        s.status AS site_status
      FROM domains d
      INNER JOIN sites s
        ON s.id = d.site_id
      ORDER BY d.created_at DESC
    `)

    return NextResponse.json({
      status: "ok",
      domains: result.rows,
    })
  } catch (error) {
    console.error("GET /api/domains error:", error)

    return NextResponse.json(
      {
        status: "error",
        message: "Impossible de récupérer les domaines.",
      },
      { status: 500 },
    )
  }
}
