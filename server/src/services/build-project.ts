import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { openProject, ProjectError } from './project.js'
import { getBuildSchemeByName } from './build-schemes.js'
import { exportNestJsProject, cleanExportOutput } from './export-nextjs.js'
import { exportVue3Project } from './export-vue3.js'
import { exportMpWxProject } from './export-mp-wx.js'
import { buildApiBaseUrlsFromBackends } from './export-api-base.js'
import { emptyDirPreserveDeps } from './clean-output.js'
import {
  backendShouldIncludeOss,
  type BuildScheme,
} from '../types/build-scheme.js'

export interface BuildProjectResult {
  schemeName: string
  outputRoot: string
  backends: Array<{ name: string; outputPath: string; routes: number }>
  frontends: Array<{ name: string; type: string; outputPath: string }>
}

async function cleanSchemeRoot(outputRoot: string): Promise<void> {
  try {
    await emptyDirPreserveDeps(outputRoot)
  } catch (err) {
    throw new ProjectError(
      `无法清理构建目录：${err instanceof Error ? err.message : String(err)}`,
      500,
    )
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
  for (let bi = 0; bi < scheme.backends.length; bi++) {
    const backend = scheme.backends[bi]!
    const out = path.join(outputRoot, 'backend', backend.name)
    await mkdir(path.dirname(out), { recursive: true })
    if (backend.type !== 'nestjs') {
      throw new ProjectError(`暂不支持的后端框架：${backend.type}`, 400)
    }
    const result = await exportNestJsProject(projectPath, {
      outputPath: out,
      moduleIds: backend.moduleIds,
      port: backend.port,
      projectName: `${scheme.name}-${backend.name}`,
      includeOss: backendShouldIncludeOss(scheme.backends, bi),
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
        entryPage: app.entryPage,
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
        entryPage: app.entryPage,
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
