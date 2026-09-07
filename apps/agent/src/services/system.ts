import si from "systeminformation"

export type SystemMetrics = {
  cpu: {
    usage: number
    cores: number
    model: string
  }

  memory: {
    total: number
    used: number
    free: number
    usage: number
  }

  disk: {
    mount: string
    total: number
    used: number
    free: number
    usage: number
  }

  uptime: number
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  const [
    cpu,
    load,
    memory,
    filesystem,
    time,
  ] = await Promise.all([
    si.cpu(),
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.time(),
  ])

  /*
   * Sur notre environnement Windows local,
   * nous utilisons E: pour les données Docker
   * et le stockage de notre plateforme.
   */
  const disk =
    filesystem.find(
      (filesystem) =>
        filesystem.mount
          .toUpperCase()
          .replace(/\\/g, "") === "E:",
    ) ??
    filesystem[0]

  const diskTotal =
    disk?.size ?? 0

  const diskUsed =
    disk?.used ?? 0

  const diskFree =
    disk?.available ?? 0

  const diskUsage =
    disk?.use ?? 0

  const memoryUsage =
    memory.total > 0
      ? (memory.used /
          memory.total) *
        100
      : 0

  return {
    cpu: {
      usage: Number(
        load.currentLoad.toFixed(2),
      ),

      cores:
        cpu.cores,

      model:
        cpu.brand,
    },

    memory: {
      total:
        memory.total,

      used:
        memory.used,

      free:
        memory.free,

      usage: Number(
        memoryUsage.toFixed(2),
      ),
    },

    disk: {
      mount:
        disk?.mount ?? "unknown",

      total:
        diskTotal,

      used:
        diskUsed,

      free:
        diskFree,

      usage: Number(
        diskUsage.toFixed(2),
      ),
    },

    uptime:
      time.uptime,
  }
}