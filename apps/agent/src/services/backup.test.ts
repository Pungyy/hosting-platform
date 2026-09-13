import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  createBackup,
  deleteAllBackups,
  deleteBackupFile,
  getBackupDir,
  getBackupFilePath,
  resolveBackupPath,
  validateDatabaseName,
} from "./backup.js"

const VALID_FILENAME = "2026-01-01T000000Z.sql.gz"

/*
 * Ces noms n'existent que dans les tests. Aucun n'est censé jamais
 * atteindre Docker ou le système de fichiers : le but est justement de
 * prouver que validateDatabaseName() les rejette avant tout appel
 * dockerode / fs, sans dépendre d'un daemon Docker démarré.
 */
const MALICIOUS_NAMES = [
  // Injection dans le filtre `name` de dockerode/Docker (interprété
  // comme une regex) : alternation qui sort du préfixe "hosting-db-"
  // pour matcher n'importe quel autre container par son nom exact —
  // ex. le container Postgres partagé d'un autre projet sur la même
  // machine.
  "z$|^/regardscroises-db$",
  // Wildcard générique : élargit le filtre à tout ce qui suit le préfixe.
  ".*",
  // Path traversal visant à faire sortir getBackupDir() du dossier de
  // sauvegardes prévu (critique pour deleteAllBackups(), qui fait un
  // rm recursive+force sur ce chemin).
  "../../etc",
  "..",
  // Autres métacaractères regex/shell qui ne doivent pas être acceptés.
  "hosting-db-victim$",
  "a(b)c",
  "a[b]c",
  "a\\b",
  "a/b",
]

const INVALID_FORMAT_NAMES = [
  "",
  "ab", // trop court (< 3)
  "a".repeat(41), // trop long (> 40)
  "Has-Uppercase",
  "has_underscore",
  "has space",
  "-leading-hyphen",
  "trailing-hyphen-",
  "double--hyphen",
]

const VALID_NAMES = ["abc", "e2e-db-a", "a".repeat(40), "my-database-1"]

describe("validateDatabaseName", () => {
  it("accepte les noms conformes au format des bases créées par la plateforme", () => {
    for (const name of VALID_NAMES) {
      expect(() => validateDatabaseName(name)).not.toThrow()
    }
  })

  it("rejette les noms malveillants visant une injection regex/path traversal", () => {
    for (const name of MALICIOUS_NAMES) {
      expect(() => validateDatabaseName(name)).toThrow(
        "Nom de base de données invalide.",
      )
    }
  })

  it("rejette les noms qui ne respectent pas le format attendu", () => {
    for (const name of INVALID_FORMAT_NAMES) {
      expect(() => validateDatabaseName(name)).toThrow(
        "Nom de base de données invalide.",
      )
    }
  })
})

describe("getBackupDir", () => {
  it("rejette un nom malveillant avant de construire un chemin", () => {
    for (const name of MALICIOUS_NAMES) {
      expect(() => getBackupDir(name)).toThrow(
        "Nom de base de données invalide.",
      )
    }
  })

  it("construit un chemin sous le dossier de sauvegardes pour un nom valide", () => {
    const dir = getBackupDir("my-database-1")
    expect(path.basename(dir)).toBe("my-database-1")
  })
})

describe("resolveBackupPath", () => {
  it("rejette un databaseName malveillant même avec un nom de fichier valide", () => {
    for (const name of MALICIOUS_NAMES) {
      expect(() => resolveBackupPath(name, VALID_FILENAME)).toThrow(
        "Nom de base de données invalide.",
      )
    }
  })

  it("retourne null pour un nom de fichier hors du format généré (path traversal filename)", () => {
    expect(resolveBackupPath("valid-name", "../../../etc/passwd")).toBeNull()
  })
})

describe("createBackup", () => {
  it("rejette un databaseName malveillant sans jamais appeler Docker", async () => {
    for (const name of MALICIOUS_NAMES) {
      await expect(createBackup(name)).rejects.toThrow(
        "Nom de base de données invalide.",
      )
    }
  })
})

describe("getBackupFilePath", () => {
  it("rejette un databaseName malveillant sans jamais toucher le système de fichiers", async () => {
    for (const name of MALICIOUS_NAMES) {
      await expect(getBackupFilePath(name, VALID_FILENAME)).rejects.toThrow(
        "Nom de base de données invalide.",
      )
    }
  })
})

describe("deleteBackupFile", () => {
  it("rejette un databaseName malveillant sans jamais toucher le système de fichiers", async () => {
    for (const name of MALICIOUS_NAMES) {
      await expect(deleteBackupFile(name, VALID_FILENAME)).rejects.toThrow(
        "Nom de base de données invalide.",
      )
    }
  })
})

describe("deleteAllBackups", () => {
  it("rejette un databaseName malveillant avant tout appel à rm() recursif", async () => {
    for (const name of MALICIOUS_NAMES) {
      await expect(deleteAllBackups(name)).rejects.toThrow(
        "Nom de base de données invalide.",
      )
    }
  })
})
