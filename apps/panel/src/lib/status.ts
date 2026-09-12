import type { Tone } from "@/components/ui/status-pill"

/**
 * Traduit un statut de container / site (souvent renvoyé en anglais par
 * Docker ou l'Agent) en libellé français + tonalité pour un StatusPill.
 */
export function siteStatus(status: string): { label: string; tone: Tone } {
  switch (status) {
    case "online":
    case "running":
      return { label: "En ligne", tone: "success" }

    case "deploying":
      return { label: "Déploiement…", tone: "warning" }

    case "creating":
      return { label: "Création…", tone: "warning" }

    case "restarting":
      return { label: "Redémarrage…", tone: "warning" }

    case "paused":
      return { label: "En pause", tone: "warning" }

    case "stopped":
    case "exited":
    case "dead":
      return { label: "Arrêté", tone: "neutral" }

    case "created":
      return { label: "Créé", tone: "neutral" }

    case "error":
    case "failed":
      return { label: "Erreur", tone: "danger" }

    default:
      return {
        label: status.charAt(0).toUpperCase() + status.slice(1),
        tone: "neutral",
      }
  }
}
