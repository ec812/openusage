import { invoke } from "@tauri-apps/api/core"
import { resolveResource } from "@tauri-apps/api/path"

/** Resolve a bundled file path; works in release builds and `tauri dev`. */
export async function resolveAppResource(relativePath: string): Promise<string> {
  try {
    return await resolveResource(relativePath)
  } catch {
    return invoke<string>("resolve_app_resource_path", { relativePath })
  }
}
