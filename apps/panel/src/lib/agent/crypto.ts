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

export function encryptAgentToken(
  token: string,
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
    cipher.update(token, "utf8"),
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

export function decryptAgentToken(
  encryptedToken: string,
): string {
  const key = getEncryptionKey()

  const parts =
    encryptedToken.split(":")

  if (parts.length !== 3) {
    throw new Error(
      "Token Agent chiffré invalide.",
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
