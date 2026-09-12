import { NextResponse } from "next/server"
import { z } from "zod"

import { requireSession } from "@/lib/auth/guard"
import {
  createAgentDatabase,
  deleteAgentDatabase,
  getAgentDatabaseStatuses,
} from "@/lib/agent/client"
import { encryptSecret } from "@/lib/agent/crypto"
import { query } from "@/lib/database"

const createDatabaseSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Le nom doit contenir au moins 3 caractères.")
    .max(40, "Le nom ne peut pas dépasser 40 caractères.")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Le nom doit contenir uniquement des lettres minuscules, chiffres et tirets.",
    ),

  engine: z.enum(["postgres"]),
})

type DatabaseRow = {
  id: string
  name: string
  engine: string
  container_name: string
  container_id: string | null
  image: string
  status: string
  database_name: string
  username: string
  internal_host: string
  internal_port: number
  created_at: string
  server_id: string
}

type AgentDatabaseStatus = {
  name: string | null
  containerId: string
  containerName: string | null
  status: string
  running: boolean
}

/*
 * Même règle de contactabilité que /api/sites (voir ce fichier) : un
 * serveur enrôlé injoignable depuis plus de 2 minutes n'est pas
 * interrogé, pour ne pas bloquer la requête sur un Agent mort. Les
 * serveurs sans agent_url (fallback dev local) sont toujours interrogés.
 */
const RECENT_HEARTBEAT_MS = 2 * 60 * 1000

/*
 * GET /api/databases
 *
 * Bases PostgreSQL du Panel + synchronisation de leur statut Docker,
 * en interrogeant l'Agent de CHAQUE serveur concerné.
 */
export async function GET() {
  try {
    const { response: authError } = await requireSession()
    if (authError) return authError

    const databasesResult = await query<DatabaseRow>(`
      SELECT
        id,
        name,
        engine,
        container_name,
        container_id,
        image,
        status,
        database_name,
        username,
        internal_host,
        internal_port,
        created_at,
        server_id
      FROM databases
      ORDER BY created_at DESC
    `)

    const databases = databasesResult.rows

    const serversResult = await query<{
      id: string
      agent_url: string | null
      last_seen_at: string | null
    }>(`SELECT id, agent_url, last_seen_at FROM servers`)

    const now = Date.now()

    const contactableServerIds = new Set(
      serversResult.rows
        .filter(
          (row) =>
            row.agent_url === null ||
            (row.last_seen_at !== null &&
              now - new Date(row.last_seen_at).getTime() <
                RECENT_HEARTBEAT_MS),
        )
        .map((row) => row.id),
    )

    const databaseServerIds = [
      ...new Set(databases.map((db) => db.server_id)),
    ]

    const targetServerIds = databaseServerIds.filter((id) =>
      contactableServerIds.has(id),
    )

    const statusByKey = new Map<string, AgentDatabaseStatus>()
    const unreachableServers: string[] = []

    const settled = await Promise.allSettled(
      targetServerIds.map(async (serverId) => {
        const data = await getAgentDatabaseStatuses(serverId)
        return { serverId, agentDatabases: data.databases }
      }),
    )

    settled.forEach((result, index) => {
      const serverId = targetServerIds[index]

      if (result.status === "rejected") {
        unreachableServers.push(serverId)
        console.error(
          `GET /api/databases — Agent injoignable (serveur ${serverId}) :`,
          result.reason,
        )
        return
      }

      for (const agentDatabase of result.value.agentDatabases) {
        if (agentDatabase.name) {
          statusByKey.set(
            `${serverId}:${agentDatabase.name}`,
            agentDatabase,
          )
        }
      }
    })

    const contactedServerIds = new Set(
      targetServerIds.filter(
        (id) => !unreachableServers.includes(id),
      ),
    )

    for (const database of databases) {
      if (!contactedServerIds.has(database.server_id)) {
        continue
      }

      const agentDatabase = statusByKey.get(
        `${database.server_id}:${database.name}`,
      )

      if (!agentDatabase) {
        if (database.status !== "stopped") {
          await query(
            `UPDATE databases SET status = 'stopped', updated_at = NOW() WHERE id = $1`,
            [database.id],
          )
          database.status = "stopped"
        }
        continue
      }

      const newStatus = agentDatabase.running ? "online" : "stopped"

      if (database.status !== newStatus) {
        await query(
          `UPDATE databases SET status = $1, updated_at = NOW() WHERE id = $2`,
          [newStatus, database.id],
        )
        database.status = newStatus
      }

      if (database.container_id !== agentDatabase.containerId) {
        await query(
          `UPDATE databases SET container_id = $1, updated_at = NOW() WHERE id = $2`,
          [agentDatabase.containerId, database.id],
        )
        database.container_id = agentDatabase.containerId
      }
    }

    const fullySynced =
      unreachableServers.length === 0 &&
      contactedServerIds.size === databaseServerIds.length

    return NextResponse.json({
      status: "ok",
      databases,
      sync: {
        status: fullySynced ? "synchronized" : "partial",
        unreachableServers,
      },
    })
  } catch (error) {
    console.error("GET /api/databases error:", error)

    return NextResponse.json(
      {
        status: "error",
        message: "Impossible de récupérer les bases de données.",
      },
      { status: 500 },
    )
  }
}

/*
 * POST /api/databases
 *
 * Création d'une base de données isolée sur le premier serveur
 * contactable.
 */
export async function POST(request: Request) {
  try {
    const { response: authError, session } = await requireSession()
    if (authError) return authError

    const body = await request.json().catch(() => null)

    const parsed = createDatabaseSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          status: "error",
          message: "Données invalides.",
          errors: parsed.error.flatten(),
        },
        { status: 400 },
      )
    }

    const { name, engine } = parsed.data

    const existing = await query<{ id: string }>(
      `SELECT id FROM databases WHERE name = $1 LIMIT 1`,
      [name],
    )

    if (existing.rows.length > 0) {
      return NextResponse.json(
        {
          status: "error",
          message: `La base de données "${name}" existe déjà.`,
        },
        { status: 409 },
      )
    }

    /*
     * Même règle de choix de serveur que POST /api/sites.
     */
    const serverResult = await query<{ id: string }>(
      `
        SELECT id
        FROM servers
        WHERE agent_url IS NULL
           OR last_seen_at > NOW() - INTERVAL '2 minutes'
        ORDER BY created_at ASC
        LIMIT 1
      `,
    )

    if (serverResult.rows.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          message: "Aucun serveur joignable pour héberger la base.",
        },
        { status: 503 },
      )
    }

    const serverId = serverResult.rows[0].id

    let created: {
      containerName: string
      image: string
      databaseName: string
      username: string
      password: string
      port: number
      running: boolean
    }

    try {
      const agentResponse = await createAgentDatabase(serverId, {
        name,
        engine,
      })

      if (!agentResponse.database) {
        throw new Error(
          "L'Agent n'a pas retourné les informations de la base.",
        )
      }

      created = agentResponse.database
    } catch (agentError) {
      return NextResponse.json(
        {
          status: "error",
          message:
            agentError instanceof Error
              ? agentError.message
              : "Impossible de créer la base de données sur l'Agent.",
        },
        { status: 502 },
      )
    }

    try {
      const insertResult = await query<DatabaseRow>(
        `
          INSERT INTO databases (
            user_id,
            server_id,
            name,
            engine,
            container_name,
            image,
            status,
            database_name,
            username,
            password_encrypted,
            internal_host,
            internal_port
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING
            id,
            name,
            engine,
            container_name,
            container_id,
            image,
            status,
            database_name,
            username,
            internal_host,
            internal_port,
            created_at,
            server_id
        `,
        [
          session.user_id,
          serverId,
          name,
          engine,
          created.containerName,
          created.image,
          created.running ? "online" : "stopped",
          created.databaseName,
          created.username,
          encryptSecret(created.password),
          created.containerName,
          created.port,
        ],
      )

      return NextResponse.json(
        { status: "ok", database: insertResult.rows[0] },
        { status: 201 },
      )
    } catch (databaseError) {
      console.error(
        "POST /api/databases — échec BDD après création Agent :",
        databaseError,
      )

      await deleteAgentDatabase(serverId, name).catch(
        (cleanupError) => {
          console.error(
            "POST /api/databases — nettoyage du container impossible :",
            cleanupError,
          )
        },
      )

      return NextResponse.json(
        {
          status: "error",
          message:
            "Le container a été créé mais son enregistrement en base a échoué.",
        },
        { status: 500 },
      )
    }
  } catch (error) {
    console.error("POST /api/databases error:", error)

    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de créer la base de données.",
      },
      { status: 500 },
    )
  }
}
