import { promises as fs } from "node:fs"
import path from "node:path"

const TRAEFIK_CONFIG_PATH =
  process.env.TRAEFIK_CONFIG_PATH ??
  path.resolve(
    process.cwd(),
    "../../docker/traefik/dynamic.json",
  )

export type TraefikRouter = {
  rule: string
  entryPoints: string[]
  service: string
  middlewares?: string[]
  tls?: {
    certResolver: string
  }
}

export type TraefikService = {
  loadBalancer: {
    servers: Array<{
      url: string
    }>
  }
}

export type TraefikMiddleware = {
  redirectScheme: {
    scheme: string
    permanent?: boolean
  }
}

export type TraefikConfig = {
  http: {
    routers: Record<string, TraefikRouter>
    services: Record<string, TraefikService>
    middlewares?: Record<
      string,
      TraefikMiddleware
    >
  }
}

export type SiteDomain = {
  domain: string
  sslEnabled?: boolean
}

function createEmptyConfig(): TraefikConfig {
  return {
    http: {
      routers: {},
      services: {},
      middlewares: {},
    },
  }
}

async function readConfig(): Promise<TraefikConfig> {
  const content =
    await fs.readFile(
      TRAEFIK_CONFIG_PATH,
      "utf8",
    )

  const cleanContent =
    content
      .replace(/^\uFEFF/, "")
      .trim()

  if (!cleanContent) {
    return createEmptyConfig()
  }

  const parsed =
    JSON.parse(
      cleanContent,
    ) as Partial<TraefikConfig>

  return {
    http: {
      routers:
        parsed.http?.routers ?? {},

      services:
        parsed.http?.services ?? {},

      middlewares:
        parsed.http?.middlewares ?? {},
    },
  }
}

async function writeConfig(
  config: TraefikConfig,
) {
  const directory =
    path.dirname(
      TRAEFIK_CONFIG_PATH,
    )

  await fs.mkdir(
    directory,
    {
      recursive: true,
    },
  )

  const content =
    `${JSON.stringify(
      config,
      null,
      2,
    )}\n`

  await fs.writeFile(
    TRAEFIK_CONFIG_PATH,
    content,
    "utf8",
  )
}

export async function getTraefikConfig() {
  return readConfig()
}

function createRouterName(
  siteName: string,
  domain: string,
  suffix: string,
) {
  const safeDomain =
    domain
      .toLowerCase()
      .replace(
        /[^a-z0-9]+/g,
        "-",
      )
      .replace(
        /^-+|-+$/g,
        "",
      )

  return `${siteName}--${safeDomain}--${suffix}`
}

function createRedirectMiddlewareName(
  siteName: string,
  domain: string,
) {
  const safeDomain =
    domain
      .toLowerCase()
      .replace(
        /[^a-z0-9]+/g,
        "-",
      )
      .replace(
        /^-+|-+$/g,
        "",
      )

  return `${siteName}--${safeDomain}--https-redirect`
}

function isLocalhostDomain(
  domain: string,
) {
  const normalized =
    domain
      .trim()
      .toLowerCase()

  return (
    normalized === "localhost" ||
    normalized.endsWith(
      ".localhost",
    )
  )
}

export async function syncSiteDomains(
  name: string,
  domains: SiteDomain[],
  containerPort = 8080,
) {
  const config =
    await readConfig()

  /*
   * Supprime tous les anciens routers
   * appartenant à ce site.
   */
  for (
    const [routerName, router]
    of Object.entries(
      config.http.routers,
    )
  ) {
    if (
      router.service === name
    ) {
      delete config.http.routers[
        routerName
      ]
    }
  }

  /*
   * Compatibilité avec l'ancien format.
   */
  delete config.http.routers[name]

  /*
   * Nettoyage des anciens middlewares
   * appartenant à ce site.
   */
  for (
    const middlewareName
    of Object.keys(
      config.http.middlewares ?? {},
    )
  ) {
    if (
      middlewareName.startsWith(
        `${name}--`,
      )
    ) {
      delete config.http.middlewares![
        middlewareName
      ]
    }
  }

  /*
   * Nettoyage et dédoublonnage
   * des domaines.
   */
  const uniqueDomains =
    Array.from(
      new Map(
        domains
          .map((item) => ({
            domain:
              item.domain
                .trim()
                .toLowerCase(),

            sslEnabled:
              item.sslEnabled === true,
          }))
          .filter(
            (item) =>
              Boolean(
                item.domain,
              ),
          )
          .map((item) => [
            item.domain,
            item,
          ]),
      ).values(),
    )

  /*
   * Si aucun domaine n'est fourni,
   * on garde le domaine localhost.
   */
  const finalDomains =
    uniqueDomains.length > 0
      ? uniqueDomains
      : [
          {
            domain:
              `${name}.localhost`,
            sslEnabled: false,
          },
        ]

  /*
   * Sécurité supplémentaire :
   * un domaine localhost ne peut jamais
   * utiliser SSL / Let's Encrypt.
   */
  for (
    const item
    of finalDomains
  ) {
    if (
      item.sslEnabled &&
      isLocalhostDomain(
        item.domain,
      )
    ) {
      throw new Error(
        `Le SSL ne peut pas être activé sur le domaine local "${item.domain}".`,
      )
    }
  }

  /*
   * Un seul service Traefik
   * par site.
   */
  config.http.services[name] = {
    loadBalancer: {
      servers: [
        {
          url:
            `http://hosting-site-${name}:${containerPort}`,
        },
      ],
    },
  }

  /*
   * Initialise les middlewares.
   */
  config.http.middlewares ??= {}

  /*
   * Un ou deux routers Traefik
   * par domaine selon le SSL.
   */
  for (
    const item
    of finalDomains
  ) {
    if (!item.sslEnabled) {
      const routerName =
        createRouterName(
          name,
          item.domain,
          "http",
        )

      config.http.routers[
        routerName
      ] = {
        rule:
          `Host(\`${item.domain}\`)`,

        entryPoints: [
          "web",
        ],

        service: name,
      }

      continue
    }

    /*
     * Middleware HTTP → HTTPS.
     */
    const middlewareName =
      createRedirectMiddlewareName(
        name,
        item.domain,
      )

    config.http.middlewares[
      middlewareName
    ] = {
      redirectScheme: {
        scheme: "https",
        permanent: true,
      },
    }

    /*
     * Router HTTP.
     */
    const httpRouterName =
      createRouterName(
        name,
        item.domain,
        "http",
      )

    config.http.routers[
      httpRouterName
    ] = {
      rule:
        `Host(\`${item.domain}\`)`,

      entryPoints: [
        "web",
      ],

      middlewares: [
        middlewareName,
      ],

      service: name,
    }

    /*
     * Router HTTPS.
     */
    const httpsRouterName =
      createRouterName(
        name,
        item.domain,
        "https",
      )

    config.http.routers[
      httpsRouterName
    ] = {
      rule:
        `Host(\`${item.domain}\`)`,

      entryPoints: [
        "websecure",
      ],

      service: name,

      tls: {
        certResolver:
          "letsencrypt",
      },
    }
  }

  await writeConfig(
    config,
  )

  return {
    name,

    domains:
      finalDomains,

    service:
      name,

    containerPort,
  }
}

export async function addSiteToTraefik(
  name: string,
  containerPort = 8080,
) {
  return syncSiteDomains(
    name,
    [
      {
        domain:
          `${name}.localhost`,

        sslEnabled:
          false,
      },
    ],
    containerPort,
  )
}

export async function removeSiteFromTraefik(
  name: string,
) {
  const config =
    await readConfig()

  /*
   * Supprime tous les routers
   * liés au service du site.
   */
  for (
    const [routerName, router]
    of Object.entries(
      config.http.routers,
    )
  ) {
    if (
      router.service === name
    ) {
      delete config.http.routers[
        routerName
      ]
    }
  }

  /*
   * Supprime les middlewares
   * liés au site.
   */
  for (
    const middlewareName
    of Object.keys(
      config.http.middlewares ?? {},
    )
  ) {
    if (
      middlewareName.startsWith(
        `${name}--`,
      )
    ) {
      delete config.http.middlewares![
        middlewareName
      ]
    }
  }

  /*
   * Supprime le service.
   */
  delete config.http.services[name]

  await writeConfig(
    config,
  )

  return {
    name,
  }
}