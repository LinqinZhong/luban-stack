import { access, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import {
  BUILD_FILE,
  createEmptyBuildSchemeLibrary,
  normalizeBuildSchemeLibrary,
  validateBuildScheme,
  type BuildScheme,
  type BuildSchemeLibrary,
  type BuildSchemeValidationIssue,
} from '../types/build-scheme.js'
import { ProjectError } from './project.js'
import { readBackendServiceLibrary } from './backend-services.js'

function buildPath(projectPath: string): string {
  return path.join(projectPath, BUILD_FILE)
}

export async function readBuildSchemeLibrary(
  projectPath: string,
): Promise<BuildSchemeLibrary> {
  const filePath = buildPath(projectPath)
  try {
    await access(filePath, constants.R_OK)
  } catch {
    return createEmptyBuildSchemeLibrary()
  }
  let raw: string
  try {
    raw = await readFile(filePath, 'utf-8')
  } catch {
    throw new ProjectError(`无法读取 ${BUILD_FILE}`, 500)
  }
  try {
    return normalizeBuildSchemeLibrary(JSON.parse(raw))
  } catch {
    throw new ProjectError(`${BUILD_FILE} 不是合法 JSON`, 400)
  }
}

export async function writeBuildSchemeLibrary(
  projectPath: string,
  library: BuildSchemeLibrary,
): Promise<BuildSchemeLibrary> {
  const normalized = normalizeBuildSchemeLibrary(library)
  const serviceLib = await readBackendServiceLibrary(projectPath)
  const allModuleIds = serviceLib.services.map((s) => s.id)
  const allIssues: BuildSchemeValidationIssue[] = []
  const names = new Set<string>()
  for (const scheme of normalized.schemes) {
    if (names.has(scheme.name)) {
      allIssues.push({
        path: 'schemes',
        message: `构建方案名称重复：${scheme.name}`,
      })
    }
    names.add(scheme.name)
    allIssues.push(...validateBuildScheme(scheme, allModuleIds))
  }
  if (allIssues.length) {
    throw new ProjectError(
      allIssues.map((i) => i.message).join('；'),
      400,
    )
  }
  const filePath = buildPath(projectPath)
  try {
    await writeFile(
      filePath,
      `${JSON.stringify(normalized, null, 2)}\n`,
      'utf-8',
    )
  } catch {
    throw new ProjectError(`无法写入 ${BUILD_FILE}`, 500)
  }
  return normalized
}

export async function getBuildSchemeByName(
  projectPath: string,
  schemeName: string,
): Promise<BuildScheme> {
  const name = schemeName.trim()
  const lib = await readBuildSchemeLibrary(projectPath)
  const scheme = lib.schemes.find((s) => s.name === name)
  if (!scheme) {
    throw new ProjectError(`未找到构建方案：${name}`, 404)
  }
  const serviceLib = await readBackendServiceLibrary(projectPath)
  const issues = validateBuildScheme(
    scheme,
    serviceLib.services.map((s) => s.id),
  )
  if (issues.length) {
    throw new ProjectError(issues.map((i) => i.message).join('；'), 400)
  }
  return scheme
}
