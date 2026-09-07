import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import fs from "node:fs/promises"

const execFileAsync =
  promisify(execFile)

const GITHUB_REPOSITORY_REGEX =
  /^https:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?$/

export type CloneRepositoryInput = {
  repositoryUrl: string
  branch: string
  destination: string
}

export type CloneRepositoryResult = {
  repositoryUrl: string
  branch: string
  destination: string
  commitSha: string
}

export async function cloneRepository({
  repositoryUrl,
  branch,
  destination,
}: CloneRepositoryInput): Promise<CloneRepositoryResult> {
  if (
    !GITHUB_REPOSITORY_REGEX.test(
      repositoryUrl,
    )
  ) {
    throw new Error(
      "URL GitHub invalide.",
    )
  }

  if (
    !/^[A-Za-z0-9._/-]+$/.test(
      branch,
    )
  ) {
    throw new Error(
      "Nom de branche invalide.",
    )
  }

  const resolvedDestination =
    path.resolve(destination)

  await fs.mkdir(
    resolvedDestination,
    {
      recursive: true,
    },
  )

  await execFileAsync(
    "git",
    [
      "clone",
      "--depth",
      "1",
      "--branch",
      branch,
      "--single-branch",
      repositoryUrl,
      resolvedDestination,
    ],
    {
      timeout: 120_000,
      maxBuffer:
        10 * 1024 * 1024,
    },
  )

  const {
    stdout,
  } = await execFileAsync(
    "git",
    [
      "-C",
      resolvedDestination,
      "rev-parse",
      "HEAD",
    ],
    {
      timeout: 30_000,
      maxBuffer:
        1024 * 1024,
    },
  )

  const commitSha =
    stdout.trim()

  if (
    !/^[a-f0-9]{40}$/i.test(
      commitSha,
    )
  ) {
    throw new Error(
      "Impossible de récupérer le commit SHA du repository.",
    )
  }

  return {
    repositoryUrl,
    branch,
    destination:
      resolvedDestination,
    commitSha,
  }
}