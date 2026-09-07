import { NextResponse } from "next/server"

import { query } from "@/lib/database"

export async function POST() {
  try {
    const result = await query<{
      id: string
      name: string
      last_seen_at: string | null
    }>(
      `
        SELECT
          id,
          name,
          last_seen_at
        FROM servers
      `,
    )

    const now = Date.now()

    for (const server of result.rows) {
      if (!server.last_seen_at) {
        await query(
          `
            UPDATE servers
            SET
              status = 'offline',
              updated_at = NOW()
            WHERE id = $1
          `,
          [server.id],
        )

        continue
      }

      const lastSeen =
        new Date(
          server.last_seen_at,
        ).getTime()

      const elapsed =
        now - lastSeen

      /*
       * Plus de 5 minutes sans heartbeat :
       * le serveur est considéré offline.
       */
      if (
        elapsed >
        5 * 60 * 1000
      ) {
        await query(
          `
            UPDATE servers
            SET
              status = 'offline',
              updated_at = NOW()
            WHERE id = $1
          `,
          [server.id],
        )
      }
    }

    return NextResponse.json({
      status: "ok",
      checked: result.rows.length,
    })
  } catch (error) {
    console.error(
      "POST /api/servers/status error:",
      error,
    )

    return NextResponse.json(
      {
        status: "error",
        message:
          "Impossible de vérifier le statut des serveurs.",
      },
      {
        status: 500,
      },
    )
  }
}