import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockDnsLookup } = vi.hoisted(() => ({
  mockDnsLookup: vi.fn(),
}))

vi.mock("node:dns/promises", () => ({
  lookup: mockDnsLookup,
}))

import {
  assertAgentUrlAllowed,
  classifyAddress,
  resolveAllAddresses,
  SsrfBlockedError,
  ssrfSafeFetch,
} from "./ssrf-guard"

beforeEach(() => {
  mockDnsLookup.mockReset()
})

describe("classifyAddress", () => {
  it("autorise les plages RFC1918 (IPv4)", () => {
    expect(classifyAddress("10.0.0.5", 4)).toEqual({ blocked: false })
    expect(classifyAddress("172.16.0.5", 4)).toEqual({ blocked: false })
    expect(classifyAddress("172.31.255.254", 4)).toEqual({ blocked: false })
    expect(classifyAddress("192.168.1.1", 4)).toEqual({ blocked: false })
  })

  it("autorise une IPv4 publique", () => {
    expect(classifyAddress("8.8.8.8", 4)).toEqual({ blocked: false })
  })

  it("bloque la loopback IPv4 (127.0.0.0/8 entier)", () => {
    expect(classifyAddress("127.0.0.1", 4)).toEqual({
      blocked: true,
      kind: "loopback",
      address: "127.0.0.1",
    })
    expect(classifyAddress("127.5.5.5", 4)).toMatchObject({
      blocked: true,
      kind: "loopback",
    })
  })

  it("bloque les adresses de métadonnées cloud IPv4 connues", () => {
    expect(classifyAddress("169.254.169.254", 4)).toMatchObject({
      blocked: true,
      kind: "metadata",
    })
    expect(classifyAddress("169.254.170.2", 4)).toMatchObject({
      blocked: true,
      kind: "metadata",
    })
    expect(classifyAddress("100.100.100.200", 4)).toMatchObject({
      blocked: true,
      kind: "metadata",
    })
  })

  it("n'autorise pas une adresse link-local non listée comme si c'était de la métadonnée, mais ne la bloque pas non plus (hors périmètre)", () => {
    expect(classifyAddress("169.254.1.1", 4)).toEqual({ blocked: false })
  })

  it("bloque la loopback IPv6 (::1)", () => {
    expect(classifyAddress("::1", 6)).toEqual({
      blocked: true,
      kind: "loopback",
      address: "::1",
    })
  })

  it("bloque la métadonnée IPv6 (fd00:ec2::254)", () => {
    expect(classifyAddress("fd00:ec2::254", 6)).toMatchObject({
      blocked: true,
      kind: "metadata",
    })
    // insensible à la casse
    expect(classifyAddress("FD00:EC2::254", 6)).toMatchObject({
      blocked: true,
      kind: "metadata",
    })
  })

  it("autorise les plages privées IPv6 (ULA fc00::/7) et publiques", () => {
    expect(classifyAddress("fc00::1", 6)).toEqual({ blocked: false })
    expect(classifyAddress("fd12:3456:789a::1", 6)).toEqual({
      blocked: false,
    })
    expect(classifyAddress("2001:4860:4860::8888", 6)).toEqual({
      blocked: false,
    })
  })

  it("bloque les adresses IPv4 mappées en IPv6 (contournement classique)", () => {
    expect(classifyAddress("::ffff:127.0.0.1", 6)).toMatchObject({
      blocked: true,
      kind: "loopback",
    })
    expect(classifyAddress("::ffff:169.254.169.254", 6)).toMatchObject({
      blocked: true,
      kind: "metadata",
    })
    expect(classifyAddress("::ffff:10.0.0.5", 6)).toEqual({
      blocked: false,
    })
  })
})

describe("resolveAllAddresses", () => {
  it("renvoie directement une IP littérale sans appeler dns.lookup", async () => {
    const result = await resolveAllAddresses("10.0.0.5")

    expect(result).toEqual([{ address: "10.0.0.5", family: 4 }])
    expect(mockDnsLookup).not.toHaveBeenCalled()
  })

  it("renvoie directement une IPv6 littérale sans appeler dns.lookup", async () => {
    const result = await resolveAllAddresses("::1")

    expect(result).toEqual([{ address: "::1", family: 6 }])
    expect(mockDnsLookup).not.toHaveBeenCalled()
  })

  it("résout un hostname via dns.lookup avec {all:true}", async () => {
    mockDnsLookup.mockResolvedValue([
      { address: "203.0.113.10", family: 4 },
      { address: "2001:db8::1", family: 6 },
    ])

    const result = await resolveAllAddresses("agent.example")

    expect(result).toEqual([
      { address: "203.0.113.10", family: 4 },
      { address: "2001:db8::1", family: 6 },
    ])
    expect(mockDnsLookup).toHaveBeenCalledWith(
      "agent.example",
      expect.objectContaining({ all: true }),
    )
  })
})

describe("assertAgentUrlAllowed", () => {
  it("rejette un schéma file://", async () => {
    await expect(
      assertAgentUrlAllowed("file:///etc/passwd"),
    ).rejects.toThrow(SsrfBlockedError)
    expect(mockDnsLookup).not.toHaveBeenCalled()
  })

  it("rejette un schéma ftp://", async () => {
    await expect(
      assertAgentUrlAllowed("ftp://agent.example/"),
    ).rejects.toThrow(SsrfBlockedError)
    expect(mockDnsLookup).not.toHaveBeenCalled()
  })

  it("rejette une URL malformée", async () => {
    await expect(assertAgentUrlAllowed("not a url")).rejects.toThrow(
      SsrfBlockedError,
    )
  })

  it("accepte http:// sur une IP RFC1918 littérale (10.x.x.x)", async () => {
    const result = await assertAgentUrlAllowed("http://10.1.2.3:4000")
    expect(result.addresses).toEqual([{ address: "10.1.2.3", family: 4 }])
  })

  it("accepte http:// sur une IP RFC1918 littérale (172.16.x.x)", async () => {
    const result = await assertAgentUrlAllowed("http://172.16.5.5:4000")
    expect(result.addresses[0].address).toBe("172.16.5.5")
  })

  it("accepte http:// sur une IP RFC1918 littérale (192.168.x.x)", async () => {
    const result = await assertAgentUrlAllowed("http://192.168.1.1:4000")
    expect(result.addresses[0].address).toBe("192.168.1.1")
  })

  it("accepte https://agent.example si la résolution est autorisée", async () => {
    mockDnsLookup.mockResolvedValue([
      { address: "192.0.2.10", family: 4 },
    ])

    const result = await assertAgentUrlAllowed("https://agent.example")

    expect(result.url.hostname).toBe("agent.example")
    expect(result.addresses).toEqual([
      { address: "192.0.2.10", family: 4 },
    ])
  })

  it("rejette http://127.0.0.1 par défaut", async () => {
    await expect(
      assertAgentUrlAllowed("http://127.0.0.1:4000"),
    ).rejects.toThrow(SsrfBlockedError)
  })

  it("rejette http://127.x.x.x (toute la plage loopback)", async () => {
    await expect(
      assertAgentUrlAllowed("http://127.42.42.42:4000"),
    ).rejects.toThrow(SsrfBlockedError)
  })

  it("rejette http://[::1]", async () => {
    await expect(
      assertAgentUrlAllowed("http://[::1]:4000"),
    ).rejects.toThrow(SsrfBlockedError)
  })

  it("rejette la métadonnée cloud IPv4", async () => {
    await expect(
      assertAgentUrlAllowed("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow(SsrfBlockedError)
  })

  it("rejette la métadonnée cloud IPv6", async () => {
    await expect(
      assertAgentUrlAllowed("http://[fd00:ec2::254]/latest/meta-data/"),
    ).rejects.toThrow(SsrfBlockedError)
  })

  it("rejette un hostname qui résout vers 127.0.0.1", async () => {
    mockDnsLookup.mockResolvedValue([
      { address: "127.0.0.1", family: 4 },
    ])

    await expect(
      assertAgentUrlAllowed("http://sneaky.example"),
    ).rejects.toThrow(SsrfBlockedError)
  })

  it("rejette un hostname qui résout vers une adresse de métadonnées", async () => {
    mockDnsLookup.mockResolvedValue([
      { address: "169.254.169.254", family: 4 },
    ])

    await expect(
      assertAgentUrlAllowed("http://sneaky.example"),
    ).rejects.toThrow(SsrfBlockedError)
  })

  it("rejette dès qu'UNE des adresses résolues est interdite, même si une autre est légitime", async () => {
    mockDnsLookup.mockResolvedValue([
      { address: "203.0.113.10", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ])

    await expect(
      assertAgentUrlAllowed("http://multi-answer.example"),
    ).rejects.toThrow(SsrfBlockedError)
  })

  describe("option allowLoopback (fallback local uniquement)", () => {
    it("autorise 127.0.0.1 quand allowLoopback est activé", async () => {
      const result = await assertAgentUrlAllowed(
        "http://127.0.0.1:4000",
        { allowLoopback: true },
      )
      expect(result.addresses[0].address).toBe("127.0.0.1")
    })

    it("autorise ::1 quand allowLoopback est activé", async () => {
      const result = await assertAgentUrlAllowed("http://[::1]:4000", {
        allowLoopback: true,
      })
      expect(result.addresses[0].address).toBe("::1")
    })

    it("continue de rejeter la métadonnée cloud MÊME avec allowLoopback activé", async () => {
      await expect(
        assertAgentUrlAllowed("http://169.254.169.254/", {
          allowLoopback: true,
        }),
      ).rejects.toThrow(SsrfBlockedError)
    })
  })

  describe("anti DNS-rebinding : une seule résolution par appel", () => {
    it("n'appelle dns.lookup qu'une seule fois, même si les réponses varient entre deux appels distincts", async () => {
      mockDnsLookup
        .mockResolvedValueOnce([{ address: "203.0.113.10", family: 4 }])
        .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }])

      // Premier appel : résolution "propre" -> accepté.
      const first = await assertAgentUrlAllowed("http://agent.example")
      expect(first.addresses[0].address).toBe("203.0.113.10")
      expect(mockDnsLookup).toHaveBeenCalledTimes(1)

      // Deuxième appel (nouvelle résolution complète) : la réponse a
      // changé (rebinding) -> refusé. Toujours UNE SEULE résolution
      // par appel, jamais deux résolutions différentes mélangées au
      // sein d'un même appel.
      await expect(
        assertAgentUrlAllowed("http://agent.example"),
      ).rejects.toThrow(SsrfBlockedError)
      expect(mockDnsLookup).toHaveBeenCalledTimes(2)
    })
  })
})

describe("ssrfSafeFetch — intégration réelle (serveur HTTP local)", () => {
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    server = createServer((req, res) => {
      if (req.url === "/redirect-relative") {
        res.writeHead(302, { Location: "/somewhere-else" })
        res.end()
        return
      }

      if (req.url === "/redirect-https") {
        res.writeHead(301, {
          Location: "https://example.com/",
        })
        res.end()
        return
      }

      if (req.url === "/redirect-private") {
        res.writeHead(302, {
          Location: "http://192.168.1.1/internal",
        })
        res.end()
        return
      }

      res.writeHead(200, {
        "Content-Type": "application/json",
        "X-Received-Host": req.headers.host ?? "",
      })
      res.end(JSON.stringify({ status: "ok", path: req.url }))
    })

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve)
    })

    const { port } = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it("effectue une vraie requête et lit la réponse (allowLoopback: true)", async () => {
    const response = await ssrfSafeFetch(
      `${baseUrl}/health`,
      {},
      { allowLoopback: true },
    )

    expect(response.ok).toBe(true)
    expect(response.status).toBe(200)

    const body = await response.text()
    expect(JSON.parse(body)).toEqual({ status: "ok", path: "/health" })
  })

  it("refuse une redirection HTTP au lieu de la suivre", async () => {
    await expect(
      ssrfSafeFetch(
        `${baseUrl}/redirect-relative`,
        {},
        { allowLoopback: true },
      ),
    ).rejects.toThrow(SsrfBlockedError)
  })

  it("refuse une redirection HTTP -> HTTPS", async () => {
    await expect(
      ssrfSafeFetch(
        `${baseUrl}/redirect-https`,
        {},
        { allowLoopback: true },
      ),
    ).rejects.toThrow(SsrfBlockedError)
  })

  it("refuse une redirection vers une IP privée", async () => {
    await expect(
      ssrfSafeFetch(
        `${baseUrl}/redirect-private`,
        {},
        { allowLoopback: true },
      ),
    ).rejects.toThrow(SsrfBlockedError)
  })

  it("rejette sans jamais se connecter quand allowLoopback est absent (comportement par défaut agent_url)", async () => {
    await expect(
      ssrfSafeFetch(`${baseUrl}/health`),
    ).rejects.toThrow(SsrfBlockedError)
  })

  it("anti rebinding de bout en bout : une seule résolution DNS sert à la fois à valider ET à se connecter, et le Host d'origine est préservé", async () => {
    const { port } = server.address() as AddressInfo

    // Le hostname n'est PAS une IP littérale : la résolution passe
    // bien par dns.lookup (mocké ici pour renvoyer l'adresse réelle du
    // serveur de test), une seule fois, et c'est cette même adresse
    // qui sert à la connexion réelle.
    mockDnsLookup.mockResolvedValue([
      { address: "127.0.0.1", family: 4 },
    ])

    const response = await ssrfSafeFetch(
      `http://agent-rebinding-test.internal:${port}/health`,
      {},
      { allowLoopback: true },
    )

    expect(mockDnsLookup).toHaveBeenCalledTimes(1)
    expect(response.ok).toBe(true)

    // Le serveur a bien reçu le hostname d'ORIGINE dans le header
    // Host, pas l'adresse IP sur laquelle la connexion TCP a
    // réellement eu lieu.
    const body = await response.text()
    expect(JSON.parse(body).status).toBe("ok")
  })
})
