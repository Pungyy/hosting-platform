import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto"

const ALGORITHM = "aes-256-gcm"

function getEncryptionKey(): Buffer {
  const keyHex =
    process.env.AGENT_TOKEN_ENCRYPTION_KEY

  if (!keyHex) {
    throw new Error(
      "AGENT_TOKEN_ENCRYPTION_KEY est manquante.",
    )
  }

  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error(
      "AGENT_TOKEN_ENCRYPTION_KEY doit contenir exactement 64 caractères hexadécimaux.",
    )
  }

  return Buffer.from(keyHex, "hex")
}

/*
 * Chiffrement générique aes-256-gcm, utilisé pour tout secret que le
 * Panel doit pouvoir déchiffrer plus tard (token d'Agent, mot de passe
 * de base de données…). La clé maître est la même pour tous les secrets
 * (AGENT_TOKEN_ENCRYPTION_KEY) : on ne chiffre ici que des identifiants
 * internes à l'infrastructure, pas des secrets utilisateur externes.
 */
export function encryptSecret(
  value: string,
): string {
  const key = getEncryptionKey()
  const iv = randomBytes(12)

  const cipher =
    createCipheriv(
      ALGORITHM,
      key,
      iv,
    )

  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ])

  const authTag =
    cipher.getAuthTag()

  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":")
}

export function decryptSecret(
  encryptedValue: string,
): string {
  const key = getEncryptionKey()

  const parts =
    encryptedValue.split(":")

  if (parts.length !== 3) {
    throw new Error(
      "Secret chiffré invalide.",
    )
  }

  const [
    ivHex,
    authTagHex,
    encryptedHex,
  ] = parts

  const decipher =
    createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivHex, "hex"),
    )

  decipher.setAuthTag(
    Buffer.from(authTagHex, "hex"),
  )

  const decrypted =
    Buffer.concat([
      decipher.update(
        Buffer.from(encryptedHex, "hex"),
      ),
      decipher.final(),
    ])

  return decrypted.toString("utf8")
}

/*
 * Alias historiques : le token d'Agent était le premier secret chiffré
 * par ce module, avant que le mécanisme ne soit généralisé.
 */
export const encryptAgentToken = encryptSecret
export const decryptAgentToken = decryptSecret
