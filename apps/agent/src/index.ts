import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { z } from "zod"

import { config } from "./config.js"

import {
  executeSiteAction,
  getDockerContainers,
  getDockerInfo,
  getManagedSiteStatuses,
  getSiteLogs,
  getSiteStatus,
  deleteSite,
} from "./services/docker.js"

import {
  getTraefikConfig,
  syncSiteDomains,
} from "./services/traefik.js"

import { createSiteController } from "./controllers/sites.js"

import { requireAgentToken } from "./middleware/auth.js"

import {
  buildDeploymentController,
} from "./controllers/deployments.js"

import { getAgentToken } from "./services/credentials.js"

import { getSystemMetrics } from "./services/system.js"

const app = new Hono()

/*
 * ============================================================
 * Configuration
 * ============================================================
 */

const PANEL_URL =
  process.env.PANEL_URL ??
  "http://localhost:3001"

const HEARTBEAT_INTERVAL =
  30_000

/*
 * ============================================================
 * Schemas
 * ============================================================
 */

const siteActionSchema = z.object({
  action: z.enum([
    "start",
    "stop",
    "restart",
  ]),
})

const siteDomainsSchema = z.object({
  domains: z
    .array(
      z.object({
        domain: z.string().min(1),
        sslEnabled: z.boolean().optional(),
      }),
    )
    .min(1),

  containerPort: z
    .number()
    .int()
    .min(1)
    .max(65535)
    .optional(),
})

/*
 * ============================================================
 * General
 * ============================================================
 */

app.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "hosting-agent",
    version: "0.1.0",
  })
})

app.get("/health", (c) => {
  return c.json({
    status: "online",
    service: "hosting-agent",
    version: "0.1.0",
  })
})

/*
 * ============================================================
 * System
 * ============================================================
 */

app.get(
  "/system",
  requireAgentToken,
  async (c) => {
    try {
      const metrics =
        await getSystemMetrics()

      return c.json({
        status: "ok",
        system: metrics,
      })
    } catch (error) {
      console.error(
        "GET /system error:",
        error,
      )

      return c.json(
        {
          status: "error",
          message:
            "Impossible de récupérer les métriques système.",
        },
        500,
      )
    }
  },
)

/*
 * ============================================================
 * Docker
 * ============================================================
 */

app.get(
  "/docker",
  requireAgentToken,
  async (c) => {
    try {
      const info =
        await getDockerInfo()

      const containers =
        await getDockerContainers()

      return c.json({
        status: "ok",

        docker: {
          version:
            info.ServerVersion,

          containers: {
            total:
              containers.length,

            running:
              containers.filter(
                (container) =>
                  container.State ===
                  "running",
              ).length,
          },
        },
      })
    } catch (error) {
      console.error(
        "GET /docker error:",
        error,
      )

      return c.json(
        {
          status: "error",
          message:
            "Impossible de récupérer les informations Docker.",
        },
        500,
      )
    }
  },
)

/*
 * ============================================================
 * Traefik
 * ============================================================
 */

/*
 * Configuration dynamique Traefik
 *
 * Utilisée par Traefik via son HTTP Provider.
 */

app.get(
  "/traefik/config",
  requireAgentToken,
  async (c) => {
    try {
      const traefikConfig =
        await getTraefikConfig()

      return c.json(
        traefikConfig,
      )
    } catch (error) {
      console.error(
        "GET /traefik/config error:",
        error,
      )

      return c.json(
        {
          status: "error",
          message:
            "Impossible de récupérer la configuration Traefik.",
        },
        500,
      )
    }
  },
)

/*
 * Synchronisation des domaines d'un site
 *
 * Le Panel envoie la liste complète des domaines.
 * L'Agent reconstruit les routers Traefik du site.
 */

app.put(
  "/sites/:name/domains",
  requireAgentToken,
  async (c) => {
    try {
      const name =
        c.req.param("name")

      if (!name) {
        return c.json(
          {
            status: "error",
            message:
              "Nom du site manquant.",
          },
          400,
        )
      }

      const body =
        await c.req
          .json()
          .catch(() => null)

      const parsed =
        siteDomainsSchema.safeParse(
          body,
        )

      if (!parsed.success) {
        return c.json(
          {
            status: "error",
            message:
              "Liste de domaines invalide.",
            errors:
              parsed.error.flatten(),
          },
          400,
        )
      }

      const result =
        await syncSiteDomains(
          name,
          parsed.data.domains,
          parsed.data
            .containerPort ??
            8080,
        )

      return c.json({
        status: "ok",
        site: result,
      })
    } catch (error) {
      console.error(
        "PUT /sites/:name/domains error:",
        error,
      )

      return c.json(
        {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Impossible de synchroniser les domaines.",
        },
        500,
      )
    }
  },
)

/*
 * ============================================================
 * Sites
 * ============================================================
 */

/*
 * Liste des statuts Docker
 * de tous les sites gérés.
 */

app.get(
  "/sites/statuses",
  requireAgentToken,
  async (c) => {
    try {
      const sites =
        await getManagedSiteStatuses()

      return c.json({
        status: "ok",
        sites,
      })
    } catch (error) {
      console.error(
        "GET /sites/statuses error:",
        error,
      )

      return c.json(
        {
          status: "error",
          message:
            "Impossible de récupérer les statuts des sites.",
        },
        500,
      )
    }
  },
)

/*
 * Création d'un site
 */

app.post(
  "/sites",
  requireAgentToken,
  async (c) => {
    const result =
      await createSiteController(
        c.req.raw,
      )

    if (result.response) {
      return result.response
    }

    return c.json(
      result.data,
    )
  },
)

/*
 * Statut d'un site
 */

app.get(
  "/sites/:name/status",
  requireAgentToken,
  async (c) => {
    try {
      const name =
        c.req.param("name")

      if (!name) {
        return c.json(
          {
            status: "error",
            message:
              "Nom du site manquant.",
          },
          400,
        )
      }

      const status =
        await getSiteStatus(
          name,
        )

      if (!status.exists) {
        return c.json(
          {
            status: "error",
            message:
              "Container introuvable.",
            site: status,
          },
          404,
        )
      }

      return c.json({
        status: "ok",
        site: status,
      })
    } catch (error) {
      console.error(
        "GET /sites/:name/status error:",
        error,
      )

      return c.json(
        {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Impossible de récupérer le statut.",
        },
        500,
      )
    }
  },
)

/*
 * Actions sur un site
 */

app.post(
  "/sites/:name/action",
  requireAgentToken,
  async (c) => {
    try {
      const name =
        c.req.param("name")

      if (!name) {
        return c.json(
          {
            status: "error",
            message:
              "Nom du site manquant.",
          },
          400,
        )
      }

      const body =
        await c.req
          .json()
          .catch(() => null)

      const parsed =
        siteActionSchema.safeParse(
          body,
        )

      if (!parsed.success) {
        return c.json(
          {
            status: "error",
            message:
              "Action invalide.",
            errors:
              parsed.error.flatten(),
          },
          400,
        )
      }

      const result =
        await executeSiteAction(
          name,
          parsed.data.action,
        )

      return c.json({
        status: "ok",
        action:
          parsed.data.action,
        site: result,
      })
    } catch (error) {
      console.error(
        "POST /sites/:name/action error:",
        error,
      )

      return c.json(
        {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Impossible d'exécuter l'action.",
        },
        500,
      )
    }
  },
)

/*
 * Logs d'un site
 */

app.get(
  "/sites/:name/logs",
  requireAgentToken,
  async (c) => {
    try {
      const name =
        c.req.param("name")

      if (!name) {
        return c.json(
          {
            status: "error",
            message:
              "Nom du site manquant.",
          },
          400,
        )
      }

      const logs =
        await getSiteLogs(
          name,
        )

      return c.json({
        status: "ok",
        logs,
      })
    } catch (error) {
      console.error(
        "GET /sites/:name/logs error:",
        error,
      )

      return c.json(
        {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Impossible de récupérer les logs.",
        },
        500,
      )
    }
  },
)

/*
 * Suppression d'un site
 */

app.delete(
  "/sites/:name",
  requireAgentToken,
  async (c) => {
    try {
      const name =
        c.req.param("name")

      if (!name) {
        return c.json(
          {
            status: "error",
            message:
              "Nom du site manquant.",
          },
          400,
        )
      }

      const result =
        await deleteSite(
          name,
        )

      return c.json({
        status: "ok",
        site: result,
      })
    } catch (error) {
      console.error(
        "DELETE /sites/:name error:",
        error,
      )

      return c.json(
        {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Impossible de supprimer le site.",
        },
        500,
      )
    }
  },
)

/*
 * ============================================================
 * Deployments
 * ============================================================
 */

app.post(
  "/deployments/build",
  requireAgentToken,
  async (c) => {
    const result =
      await buildDeploymentController(
        c.req.raw,
      )

    if (result.response) {
      return result.response
    }

    return c.json(
      result.data,
    )
  },
)

/*
 * ============================================================
 * Heartbeat
 * ============================================================
 */

/*
 * Envoie régulièrement un signal au Panel
 * pour indiquer que l'Agent est actif.
 *
 * Le token permanent de l'Agent est envoyé
 * dans le corps de la requête.
 */

async function sendHeartbeat() {
  const agentToken =
    getAgentToken()

  if (!agentToken) {
    console.error(
      "❌ Aucun token permanent trouvé pour le heartbeat.",
    )

    return
  }

  try {
    const metrics =
      await getSystemMetrics()

    const response =
      await fetch(
        `${PANEL_URL}/api/servers/heartbeat`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            token: agentToken,

            agentVersion:
              "0.1.0",

            metrics,
          }),
        },
      )

    const data =
      await response.json()

    if (!response.ok) {
      console.error(
        "❌ Heartbeat refusé :",
        data,
      )

      return
    }

    console.log(
      "💓 Heartbeat envoyé.",
      {
        cpu:
          metrics.cpu.usage,
        memory:
          metrics.memory.usage,
        disk:
          metrics.disk.usage,
      },
    )
  } catch (error) {
    console.error(
      "❌ Erreur heartbeat :",
      error,
    )
  }
}

/*
 * Premier heartbeat immédiatement
 * au démarrage de l'Agent.
 */
void sendHeartbeat()

/*
 * Puis un heartbeat toutes les 30 secondes.
 */
setInterval(
  () => {
    void sendHeartbeat()
  },
  HEARTBEAT_INTERVAL,
)

/*
 * ============================================================
 * Server
 * ============================================================
 */

serve({
  fetch: app.fetch,
  port: config.port,
})

console.log(
  `Hosting Agent démarré sur http://localhost:${config.port}`,
)