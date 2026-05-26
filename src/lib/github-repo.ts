/** ec812 fork — not synced with robinebers/openusage. */
export const GITHUB_REPO = "ec812/openusage"

/** Off until ec812 publishes signed releases (separate pubkey + latest.json). */
export const AUTO_UPDATE_ENABLED = false

export function githubUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`
  return `https://github.com/${GITHUB_REPO}${suffix}`
}
