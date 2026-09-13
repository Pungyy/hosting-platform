import { lookup as dnsLookup } from "node:dns/promises"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { isIP } from "node:net"
import { Readable } from "node:stream"

/*
 * Garde-fou SSRF centralisé pour toute communication sortante
 * Panel -> Agent (`agentUrl`, issu de l'enrôlement — voir
 * apps/panel/src/app/api/servers/enroll/route.ts). Réutilisé par
 * l'enrôlement (rejet immédiat) ET par chaque appel réseau réel dans
 * lib/agent/client.ts (défense en profondeur — un hôte valide à
 * l'enrôlement peut changer de résolution DNS plus tard).
 *
 * Principe anti rebinding DNS : la résolution DNS n'est faite QU'UNE
 * SEULE FOIS par appel (`assertAgentUrlAllowed`), et c'est CETTE MÊME
 * adresse résolue qui sert ensuite à établir la connexion TCP réelle
 * (`ssrfSafeFetch` -> `performPinnedRequest`, via `http.request`/
 * `https.request` en ciblant directement l'IP validée). Aucune
 * seconde résolution n'a jamais lieu entre la validation et la
 * connexion — c'est précisément cette fenêtre qu'exploite un DNS
 * rebinding classique (répondre une IP "propre" à la validation, puis
 * une IP interne à la connexion). Le header Host / SNI TLS restent
 * positionnés sur le nom d'hôte d'origine (`servername` pour
 * `https.request`), donc la vérification du certificat contre le vrai
 * hostname n'est pas affaiblie.
 *
 * RFC1918 (10/8, 172.16/12, 192.168/16) et les autres plages privées
 * ne sont PAS bloquées : un Agent légitime peut être hébergé sur un
 * réseau privé/VPN. Seuls loopback et les adresses de métadonnées
 * cloud (aucun usage légitime possible pour un Agent) sont interdits.
 */

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SsrfBlockedError"
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"])

/*
 * Adresses de métadonnées cloud documentées et reconnues :
 * - 169.254.169.254 : AWS, GCP, Azure, DigitalOcean, Oracle Cloud, OpenStack (adresse standard partagée)
 * - 169.254.170.2   : AWS ECS (metadata des tâches)
 * - 100.100.100.200 : Alibaba Cloud
 * - fd00:ec2::254   : AWS EC2, variante IPv6
 * Aucune de ces adresses n'a de cas d'usage légitime pour un Agent.
 */
const METADATA_V4 = new Set([
  "169.254.169.254",
  "169.254.170.2",
  "100.100.100.200",
])

const METADATA_V6 = new Set(["fd00:ec2::254"])

type AddressVerdict =
  | { blocked: false }
  | { blocked: true; kind: "loopback" | "metadata"; address: string }

function isLoopbackV4(address: string): boolean {
  const firstOctet = Number(address.split(".", 1)[0])
  return firstOctet === 127
}

function extractIpv4MappedAddress(address: string): string | null {
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  return match ? match[1] : null
}

export function classifyAddress(
  address: string,
  family: 4 | 6,
): AddressVerdict {
  if (family === 4) {
    if (isLoopbackV4(address)) {
      return { blocked: true, kind: "loopback", address }
    }

    if (METADATA_V4.has(address)) {
      return { blocked: true, kind: "metadata", address }
    }

    return { blocked: false }
  }

  const normalized = address.toLowerCase()

  if (normalized === "::1") {
    return { blocked: true, kind: "loopback", address }
  }

  if (METADATA_V6.has(normalized)) {
    return { blocked: true, kind: "metadata", address }
  }

  /*
   * Une adresse IPv4 "mappée" en IPv6 (::ffff:127.0.0.1,
   * ::ffff:169.254.169.254...) représente la même destination réelle
   * que sa forme IPv4 — on la re-classe avec les mêmes règles pour ne
   * pas laisser passer un contournement par ce biais.
   */
  const mapped = extractIpv4MappedAddress(normalized)

  if (mapped) {
    return classifyAddress(mapped, 4)
  }

  return { blocked: false }
}

/*
 * `URL.hostname` conserve les crochets autour d'un littéral IPv6
 * ("[::1]", pas "::1") — corrects pour le header Host (syntaxe
 * HTTP standard pour un hôte IPv6) mais invalides pour `net.isIP()`
 * ou `dns.lookup()`, qui attendent l'adresse nue.
 */
function stripIpv6Brackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1)
  }

  return hostname
}

export type ResolvedAddress = { address: string; family: 4 | 6 }

/*
 * Résout un hostname vers TOUTES ses adresses (IPv4 ET IPv6). Si
 * `hostname` est déjà une IP littérale, la renvoie directement sans
 * appel DNS. C'est la SEULE fonction de résolution utilisée par tout
 * le module — un appelant ne doit jamais refaire sa propre résolution
 * séparée.
 */
export async function resolveAllAddresses(
  hostname: string,
): Promise<ResolvedAddress[]> {
  const normalized = stripIpv6Brackets(hostname)
  const literalFamily = isIP(normalized)

  if (literalFamily === 4 || literalFamily === 6) {
    return [{ address: normalized, family: literalFamily }]
  }

  const results = await dnsLookup(normalized, {
    all: true,
    verbatim: true,
  })

  return results.map((result) => ({
    address: result.address,
    family: result.family as 4 | 6,
  }))
}

export type AssertAgentUrlOptions = {
  /*
   * N'autoriser cette option que pour le fallback local de
   * développement (AGENT_URL/AGENT_TOKEN configurés directement par
   * l'opérateur dans son propre .env, jamais issus d'un enrôlement
   * attaquable) — voir lib/agent/client.ts:getAgentConfig(). Les
   * adresses de métadonnées cloud restent TOUJOURS interdites, quelle
   * que soit cette option.
   */
  allowLoopback?: boolean
}

export type AssertedAgentUrl = {
  url: URL
  addresses: ResolvedAddress[]
}

export async function assertAgentUrlAllowed(
  rawUrl: string,
  options: AssertAgentUrlOptions = {},
): Promise<AssertedAgentUrl> {
  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    throw new SsrfBlockedError("URL de l'Agent invalide.")
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfBlockedError(
      `Schéma "${url.protocol}" interdit pour un Agent — seuls http:// et https:// sont autorisés.`,
    )
  }

  let addresses: ResolvedAddress[]

  try {
    addresses = await resolveAllAddresses(url.hostname)
  } catch {
    throw new SsrfBlockedError(
      `Impossible de résoudre l'hôte de l'Agent ("${url.hostname}").`,
    )
  }

  if (addresses.length === 0) {
    throw new SsrfBlockedError(
      `Aucune adresse résolue pour l'hôte de l'Agent ("${url.hostname}").`,
    )
  }

  for (const { address, family } of addresses) {
    const verdict = classifyAddress(address, family)

    if (!verdict.blocked) {
      continue
    }

    if (verdict.kind === "loopback" && options.allowLoopback) {
      continue
    }

    const label =
      verdict.kind === "loopback"
        ? "une adresse loopback"
        : "une adresse de métadonnées cloud"

    throw new SsrfBlockedError(
      `Agent refusé : "${url.hostname}" résout vers ${label} (${verdict.address}).`,
    )
  }

  return { url, addresses }
}

export type SafeFetchInit = {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}

export type SsrfSafeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
  body: ReadableStream<Uint8Array> | null
}

/*
 * Effectue la requête HTTP(S) réelle en ciblant directement l'adresse
 * déjà validée (`address`) — jamais le hostname d'origine — tout en
 * conservant le hostname d'origine dans le header Host et, pour
 * HTTPS, dans `servername` (SNI + vérification du certificat contre
 * le VRAI nom d'hôte, pas affaiblie). Aucune redirection n'est jamais
 * suivie : une réponse 3xx avec Location est traitée comme un refus,
 * jamais comme une réponse normale à relayer.
 *
 * Utilise directement `http`/`https` (pas `fetch`) précisément pour
 * pouvoir spécifier l'adresse de connexion indépendamment du hostname
 * utilisé pour Host/SNI — `fetch` ne l'expose pas nativement sans un
 * dispatcher `undici` dédié, qu'on évite ici pour ne pas ajouter de
 * dépendance dans un chemin sécuritaire critique.
 */
function performPinnedRequest(
  url: URL,
  address: string,
  init: SafeFetchInit,
): Promise<SsrfSafeResponse> {
  const isHttps = url.protocol === "https:"
  const requestFn = isHttps ? httpsRequest : httpRequest
  const port = url.port
    ? Number(url.port)
    : isHttps
      ? 443
      : 80

  const headers: Record<string, string> = {
    ...init.headers,
    Host: url.port
      ? `${url.hostname}:${url.port}`
      : url.hostname,
  }

  return new Promise((resolve, reject) => {
    const req = requestFn(
      {
        host: address,
        port,
        path: `${url.pathname}${url.search}`,
        method: init.method ?? "GET",
        headers,
        signal: init.signal,
        ...(isHttps
          ? { servername: stripIpv6Brackets(url.hostname) }
          : {}),
      },
      (res) => {
        const status = res.statusCode ?? 0

        if (
          status >= 300 &&
          status < 400 &&
          res.headers.location
        ) {
          res.resume()
          reject(
            new SsrfBlockedError(
              `Redirection refusée (${status} vers "${res.headers.location}") — les redirections ne sont jamais suivies.`,
            ),
          )
          return
        }

        resolve({
          ok: status >= 200 && status < 300,
          status,
          get body() {
            return Readable.toWeb(
              res,
            ) as ReadableStream<Uint8Array>
          },
          text: async () => {
            const chunks: Buffer[] = []
            for await (const chunk of res) {
              chunks.push(chunk as Buffer)
            }
            return Buffer.concat(chunks).toString("utf8")
          },
        })
      },
    )

    req.on("error", (error) => reject(error))

    if (init.body) {
      req.write(init.body)
    }

    req.end()
  })
}

/*
 * Point d'entrée unique pour tout appel réseau Panel -> Agent. Résout
 * et valide `rawUrl` une seule fois (voir assertAgentUrlAllowed), puis
 * connecte directement à l'adresse validée — jamais de seconde
 * résolution DNS entre la validation et la connexion.
 */
export async function ssrfSafeFetch(
  rawUrl: string,
  init: SafeFetchInit = {},
  guardOptions: AssertAgentUrlOptions = {},
): Promise<SsrfSafeResponse> {
  const { url, addresses } = await assertAgentUrlAllowed(
    rawUrl,
    guardOptions,
  )

  const [{ address }] = addresses

  return performPinnedRequest(url, address, init)
}
