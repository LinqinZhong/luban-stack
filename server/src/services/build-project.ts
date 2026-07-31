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

/** 部分构建：传入则只构建列出的目标；都不传则整方案全量构建 */
export interface BuildProjectOptions {
  backendNames?: string[]
  frontendNames?: string[]
}

async function cleanDir(dir: string): Promise<void> {
  try {
    await emptyDirPreserveDeps(dir)
  } catch (err) {
    throw new ProjectError(
      `无法清理构建目录：${err instanceof Error ? err.message : String(err)}`,
      500,
    )
  }
}

function normalizeNameList(raw: string[] | undefined): string[] | null {
  if (raw == null) return null
  if (!Array.isArray(raw)) return []
  return raw.map((n) => String(n ?? '').trim()).filter(Boolean)
}

export async function buildProject(
  projectPathInput: string,
  schemeName: string,
  options: BuildProjectOptions = {},
): Promise<BuildProjectResult> {
  const { path: projectPath } = await openProject(projectPathInput)
  const scheme: BuildScheme = await getBuildSchemeByName(
    projectPath,
    schemeName,
  )

  const filterBackends = normalizeNameList(options.backendNames)
  const filterFrontends = normalizeNameList(options.frontendNames)
  const isPartial = filterBackends != null || filterFrontends != null

  const backendsToBuild = isPartial
    ? scheme.backends.filter((b) =>
        (filterBackends ?? []).includes(b.name.trim()),
      )
    : scheme.backends
  const frontendsToBuild = isPartial
    ? scheme.frontends.filter((f) =>
        (filterFrontends ?? []).includes(f.name.trim()),
      )
    : scheme.frontends

  if (!backendsToBuild.length && !frontendsToBuild.length) {
    throw new ProjectError('请至少选择一个构建目标', 400)
  }

  const outputRoot = path.join(projectPath, 'output', scheme.name)
  if (!isPartial) {
    await cleanDir(outputRoot)
  } else {
    for (const backend of backendsToBuild) {
      await cleanDir(path.join(outputRoot, 'backend', backend.name))
    }
    for (const app of frontendsToBuild) {
      await cleanDir(path.join(outputRoot, 'frontend', app.name))
    }
  }

  const apiBaseUrls = buildApiBaseUrlsFromBackends(scheme.backends)

  const backends: BuildProjectResult['backends'] = []
  for (const backend of backendsToBuild) {
    const bi = scheme.backends.findIndex((b) => b.name === backend.name)
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
      includeOss: backendShouldIncludeOss(scheme.backends, bi >= 0 ? bi : 0),
    })
    backends.push({
      name: backend.name,
      outputPath: result.outputPath,
      routes: result.routes,
    })
  }

  const frontends: BuildProjectResult['frontends'] = []
  for (const app of frontendsToBuild) {
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
