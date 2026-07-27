import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { openProject, ProjectError } from './project.js'
import { getBuildSchemeByName } from './build-schemes.js'
import { exportNestJsProject, cleanExportOutput } from './export-nextjs.js'
import { exportVue3Project } from './export-vue3.js'
import { exportMpWxProject } from './export-mp-wx.js'
import { buildApiBaseUrlsFromBackends } from './export-api-base.js'
import type { BuildScheme } from '../types/build-scheme.js'

export interface BuildProjectResult {
  schemeName: string
  outputRoot: string
  backends: Array<{ name: string; outputPath: string; routes: number }>
  frontends: Array<{ name: string; type: string; outputPath: string }>
}

async function cleanSchemeRoot(outputRoot: string): Promise<void> {
  await mkdir(outputRoot, { recursive: true })
  let entries
  try {
    entries = await readdir(outputRoot, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    if (ent.name === '.git') continue
    try {
      await rm(path.join(outputRoot, ent.name), {
        recursive: true,
        force: true,
      })
    } catch (err) {
      throw new ProjectError(
        `无法清理构建目录「${ent.name}」：${err instanceof Error ? err.message : String(err)}`,
        500,
      )
    }
  }
}

export async function buildProject(
  projectPathInput: string,
  schemeName: string,
): Promise<BuildProjectResult> {
  const { path: projectPath } = await openProject(projectPathInput)
  const scheme: BuildScheme = await getBuildSchemeByName(
    projectPath,
    schemeName,
  )

  const outputRoot = path.join(projectPath, 'output', scheme.name)
  await cleanSchemeRoot(outputRoot)

  const apiBaseUrls = buildApiBaseUrlsFromBackends(scheme.backends)

  const backends: BuildProjectResult['backends'] = []
  for (const backend of scheme.backends) {
    const out = path.join(outputRoot, 'backend', backend.name)
    await mkdir(path.dirname(out), { recursive: true })
    const result = await exportNestJsProject(projectPath, {
      outputPath: out,
      moduleIds: backend.moduleIds,
      port: backend.port,
      projectName: `${scheme.name}-${backend.name}`,
    })
    backends.push({
      name: backend.name,
      outputPath: result.outputPath,
      routes: result.routes,
    })
  }

  const frontends: BuildProjectResult['frontends'] = []
  for (const app of scheme.frontends) {
    const out = path.join(outputRoot, 'frontend', app.name)
    await mkdir(path.dirname(out), { recursive: true })
    if (app.type === 'vue3') {
      const result = await exportVue3Project(projectPath, {
        outputPath: out,
        pageIds: app.pageIds,
        port: app.port,
        apiBaseUrls,
      })
      frontends.push({
        name: app.name,
        type: 'vue3',
        outputPath: result.outputPath,
      })
    } else {
      const result = await exportMpWxProject(projectPath, {
        outputPath: out,
        pageIds: app.pageIds,
        wechatAppId: app.wechatAppId,
        apiBaseUrls,
      })
      frontends.push({
        name: app.name,
        type: 'mp-wx',
        outputPath: result.outputPath,
      })
    }
  }

  return {
    schemeName: scheme.name,
    outputRoot,
    backends,
    frontends,
  }
}

/** 兼容旧单目录 Nest 清理 */
export { cleanExportOutput }
