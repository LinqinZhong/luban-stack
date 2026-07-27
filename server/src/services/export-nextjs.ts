import {
  mkdir,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { openProject, ProjectError } from './project.js'
import { generateNestJsModules } from './export-nextjs/codegen/index.js'
import { scaffoldNestJsFiles } from './export-nextjs/scaffold.js'
import { readMysqlLibrary } from './mysql.js'
import { readOssLibrary } from './oss.js'
import { readBackendServiceLibrary } from './backend-services.js'
import {
  collectMysqlSlots,
  formatNestEnvExample,
  formatNestEnvFile,
  pickOssForEnv,
} from './export-nextjs/env.js'

export interface ExportNestJsOptions {
  /** 绝对或相对项目的输出目录；默认 output/nestjs */
  outputPath?: string
  /** 仅导出这些模块 id */
  moduleIds?: string[]
  /** 写入 .env 的 PORT */
  port?: number
  projectName?: string
}

export interface ExportNestJsResult {
  outputPath: string
  services: number
  routes: number
}

/** @deprecated */
export type ExportNextJsResult = ExportNestJsResult

const OUTPUT_DIR = path.join('output', 'nestjs')

async function writeProjectFile(
  baseDir: string,
  relPath: string,
  content: string,
): Promise<void> {
  const filePath = path.join(baseDir, relPath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
}

async function writeMany(
  baseDir: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    await writeProjectFile(baseDir, rel, content)
  }
}

export async function cleanExportOutput(outputPath: string): Promise<void> {
  const keep = new Set([
    'node_modules',
    'dist',
    '.git',
    'pnpm-lock.yaml',
    'package-lock.json',
  ])
  await mkdir(outputPath, { recursive: true })
  let entries
  try {
    entries = await readdir(outputPath, { withFileTypes: true })
  } catch (err) {
    throw new ProjectError(
      `无法读取导出目录：${err instanceof Error ? err.message : String(err)}`,
      500,
    )
  }
  for (const ent of entries) {
    if (keep.has(ent.name)) continue
    try {
      await rm(path.join(outputPath, ent.name), { recursive: true, force: true })
    } catch (err) {
      throw new ProjectError(
        `无法清理导出目录项「${ent.name}」：${err instanceof Error ? err.message : String(err)}`,
        500,
      )
    }
  }
}

function buildEnvFiles(options: {
  mysqlLib: Awaited<ReturnType<typeof readMysqlLibrary>>
  ossLib: Awaited<ReturnType<typeof readOssLibrary>>
  services: Awaited<ReturnType<typeof readBackendServiceLibrary>>['services']
  port: number
}): {
  example: string
  development: string
  production: string
} {
  const { mysqlLib, ossLib, services, port } = options
  const mysqlDev = collectMysqlSlots(mysqlLib, services, 'development')
  const mysqlProd = collectMysqlSlots(mysqlLib, services, 'production')
  const ossDev = pickOssForEnv(ossLib, 'development')
  const ossProd = pickOssForEnv(ossLib, 'production')

  return {
    example: formatNestEnvExample(),
    development: formatNestEnvFile({
      profile: 'development',
      port,
      mysqlSlots: mysqlDev,
      oss: ossDev,
      ossName: ossDev?.name,
      missingOss: !ossDev,
    }),
    production: formatNestEnvFile({
      profile: 'production',
      port,
      mysqlSlots: mysqlProd,
      oss: ossProd,
      ossName: ossProd?.name,
      missingOss: !ossProd,
    }),
  }
}

export async function exportNestJsProject(
  projectPathInput: string,
  options: ExportNestJsOptions = {},
): Promise<ExportNestJsResult> {
  const { path: projectPath, config } = await openProject(projectPathInput)
  const outputPath = options.outputPath
    ? path.resolve(options.outputPath)
    : path.join(projectPath, OUTPUT_DIR)

  await cleanExportOutput(outputPath)

  const moduleIds = options.moduleIds
  const [generated, mysqlLib, ossLib, serviceLib] = await Promise.all([
    generateNestJsModules(projectPath, { moduleIds }),
    readMysqlLibrary(projectPath),
    readOssLibrary(projectPath),
    readBackendServiceLibrary(projectPath),
  ])

  const services = moduleIds?.length
    ? serviceLib.services.filter((s) => moduleIds.includes(s.id))
    : serviceLib.services

  const port =
    options.port && options.port > 0 ? Math.floor(options.port) : 3030

  const envFiles = buildEnvFiles({
    mysqlLib,
    ossLib,
    services,
    port,
  })

  const scaffold = await scaffoldNestJsFiles({
    projectName: options.projectName || config.name || 'voider-backend',
    defaultMysqlId: generated.defaultMysqlId,
    routes: generated.routes,
    rootModuleImports: generated.rootModuleImports,
    envFiles,
  })

  await writeMany(outputPath, scaffold)
  await writeMany(outputPath, generated.files)

  return {
    outputPath,
    services: generated.services,
    routes: generated.routes.length,
  }
}

/** @deprecated 使用 exportNestJsProject */
export const exportNextJsProject = exportNestJsProject
