import path from "node:path"

import { config as loadEnv } from "dotenv"
import { defineConfig } from "vitest/config"

/*
 * Vitest ne lit pas les fichiers .env de Next.js — on les charge nous-même.
 * .env.local (DATABASE_NAME) sert uniquement à la comparaison de sécurité
 * dans vitest.setup.ts ; .env.test (TEST_DATABASE_*) est la seule source
 * utilisée pour se connecter réellement.
 */
loadEnv({ path: path.resolve(__dirname, ".env.local"), quiet: true })
loadEnv({ path: path.resolve(__dirname, ".env.test"), quiet: true })

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
})
