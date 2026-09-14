import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockCreateBackup } = vi.hoisted(() => ({
  mockCreateBackup: vi.fn(),
}))

vi.mock("../services/backup.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/backup.js")
  >("../services/backup.js")

  return {
    ...actual,
    createBackup: mockCreateBackup,
  }
})

import { createBackupController } from "./backups.js"
import {
  BackupTimeoutError,
  MAX_BACKUP_TIMEOUT_MS,
  MIN_BACKUP_TIMEOUT_MS,
} from "../services/backup.js"

function makeRequest(body: unknown) {
  return new Request(
    "http://agent.local/databases/demo-db/backups",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  )
}

beforeEach(() => {
  mockCreateBackup.mockReset()
})

describe("createBackupController — timeout (finding M2)", () => {
  it("traduit un BackupTimeoutError en 504 avec un champ timeout explicite", async () => {
    mockCreateBackup.mockRejectedValue(
      new BackupTimeoutError(
        "pg_dump a dépassé le délai maximal de 9 minutes et a été annulé.",
      ),
    )

    const result = await createBackupController(
      makeRequest({}),
      "demo-db",
    )

    expect(result.response).toBeDefined()
    expect(result.response!.status).toBe(504)

    const body = await result.response!.json()
    expect(body.timeout).toBe(true)
    expect(body.status).toBe("error")
    expect(body.message).toContain("9 minutes")
  })

  it("un échec pg_dump normal (non-timeout) reste un 500 sans champ timeout", async () => {
    mockCreateBackup.mockRejectedValue(
      new Error("pg_dump a échoué : erreur de syntaxe SQL"),
    )

    const result = await createBackupController(
      makeRequest({}),
      "demo-db",
    )

    expect(result.response!.status).toBe(500)

    const body = await result.response!.json()
    expect(body.timeout).toBeUndefined()
  })

  it("une sauvegarde réussie renvoie les données normalement", async () => {
    mockCreateBackup.mockResolvedValue({
      filename: "2026-01-01T000000Z.sql.gz",
      sizeBytes: 1234,
    })

    const result = await createBackupController(
      makeRequest({}),
      "demo-db",
    )

    expect(result.response).toBeUndefined()
    expect(result.data?.status).toBe("ok")
  })
})

/*
 * Finding M2 ("timeout pg_dump") : l'Agent ne fait confiance à AUCUNE
 * valeur de backupTimeoutMs reçue du Panel au-delà de MIN/MAX_
 * BACKUP_TIMEOUT_MS, quelle que soit son origine — même exigence que
 * deploymentTimeoutMs (finding H1).
 */
describe("createBackupController — backupTimeoutMs (finding M2)", () => {
  it("rejette une valeur en dessous de MIN_BACKUP_TIMEOUT_MS (400, aucun appel à createBackup)", async () => {
    const result = await createBackupController(
      makeRequest({
        backupTimeoutMs: MIN_BACKUP_TIMEOUT_MS - 1,
      }),
      "demo-db",
    )

    expect(result.response).toBeDefined()
    expect(result.response!.status).toBe(400)
    expect(mockCreateBackup).not.toHaveBeenCalled()
  })

  it("rejette une valeur au-dessus de MAX_BACKUP_TIMEOUT_MS (400, aucun appel à createBackup)", async () => {
    const result = await createBackupController(
      makeRequest({
        backupTimeoutMs: MAX_BACKUP_TIMEOUT_MS + 1,
      }),
      "demo-db",
    )

    expect(result.response).toBeDefined()
    expect(result.response!.status).toBe(400)
    expect(mockCreateBackup).not.toHaveBeenCalled()
  })

  it("accepte l'absence de corps du tout (rétrocompatibilité) et appelle createBackup sans backupTimeoutMs", async () => {
    mockCreateBackup.mockResolvedValue({
      filename: "2026-01-01T000000Z.sql.gz",
      sizeBytes: 1234,
    })

    const result = await createBackupController(
      makeRequest(undefined),
      "demo-db",
    )

    expect(result.response).toBeUndefined()
    expect(mockCreateBackup).toHaveBeenCalledWith(
      "demo-db",
      undefined,
    )
  })

  it("transmet une valeur valide telle quelle à createBackup", async () => {
    mockCreateBackup.mockResolvedValue({
      filename: "2026-01-01T000000Z.sql.gz",
      sizeBytes: 1234,
    })

    const validTimeout = MIN_BACKUP_TIMEOUT_MS + 60_000

    const result = await createBackupController(
      makeRequest({ backupTimeoutMs: validTimeout }),
      "demo-db",
    )

    expect(result.response).toBeUndefined()
    expect(mockCreateBackup).toHaveBeenCalledWith(
      "demo-db",
      validTimeout,
    )
  })
})
