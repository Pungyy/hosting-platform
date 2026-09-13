import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    /*
     * config.ts valide AGENT_TOKEN (présence + longueur >= 32) dès
     * l'import du module. Fixé ici pour que les tests soient
     * déterministes, indépendamment du .env réel du développeur —
     * dotenv/config (chargé par config.ts) ne réécrit jamais une
     * variable déjà présente dans process.env.
     */
    env: {
      AGENT_TOKEN: "test-static-agent-token-0123456789abcdef",
    },
  },
})
