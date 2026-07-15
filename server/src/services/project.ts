import { access, mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createDefaultConfig,
  isValidProjectConfig,
  VOIDER_CONFIG_FILE,
  type VoiderProjectConfig,
} from '../types/voider-project.js'
import { ensureIconLibraryFile } from './icons.js'

export class ProjectError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ProjectError'
    this.status = status
  }
}

export interface ProjectResult {
  path: string
  config: VoiderProjectConfig
}

export interface BrowseEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface BrowseResult {
  path: string
  parent: string | null
  entries: BrowseEntry[]
}

function normalizeProjectPath(input: string): string {
  if (!input || typeof input !== 'string' || !input.trim()) {
    throw new ProjectError('请提供项目路径')
  }

  const resolved = path.resolve(input.trim())
  return resolved
}

async function assertDirectory(dirPath: string): Promise<void> {
  try {
    const info = await stat(dirPath)
    if (!info.isDirectory()) {
      throw new ProjectError('路径不是文件夹')
    }
  } catch (err) {
    if (err instanceof ProjectError) throw err
    throw new ProjectError('文件夹不存在', 404)
  }
}

async function readConfigFile(projectPath: string): Promise<VoiderProjectConfig> {
  const configPath = path.join(projectPath, VOIDER_CONFIG_FILE)

  try {
    await access(configPath, constants.R_OK)
  } catch {
    throw new ProjectError(`所选文件夹缺少 ${VOIDER_CONFIG_FILE}`, 400)
  }

  let raw: string
  try {
    raw = await readFile(configPath, 'utf-8')
  } catch {
    throw new ProjectError(`无法读取 ${VOIDER_CONFIG_FILE}`, 500)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ProjectError(`${VOIDER_CONFIG_FILE} 不是合法 JSON`, 400)
  }

  if (!isValidProjectConfig(parsed)) {
    throw new ProjectError(`${VOIDER_CONFIG_FILE} 配置不完整或字段无效`, 400)
  }

  return parsed
}

export async function openProject(inputPath: string): Promise<ProjectResult> {
  const projectPath = normalizeProjectPath(inputPath)
  await assertDirectory(projectPath)
  const config = await readConfigFile(projectPath)

  return { path: projectPath, config }
}

export async function createProject(options: {
  path: string
  name: string
  author?: string
  version?: string
  engineVersion?: string
  canvasWidth?: number
}): Promise<ProjectResult> {
  const projectPath = normalizeProjectPath(options.path)

  if (!options.name?.trim()) {
    throw new ProjectError('请填写项目名称')
  }

  try {
    await mkdir(projectPath, { recursive: true })
  } catch {
    throw new ProjectError('无法创建项目文件夹', 500)
  }

  await assertDirectory(projectPath)

  const configPath = path.join(projectPath, VOIDER_CONFIG_FILE)

  try {
    await access(configPath, constants.F_OK)
    throw new ProjectError(`目标文件夹已存在 ${VOIDER_CONFIG_FILE}，请选择其他路径或打开现有项目`)
  } catch (err) {
    if (err instanceof ProjectError) throw err
  }

  const config = createDefaultConfig({
    name: options.name,
    author: options.author,
    version: options.version,
    engineVersion: options.engineVersion,
    canvasWidth: options.canvasWidth,
  })

  try {
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
    await mkdir(path.join(projectPath, 'pages'), { recursive: true })
    await mkdir(path.join(projectPath, 'components'), { recursive: true })
    await ensureIconLibraryFile(projectPath)
  } catch {
    throw new ProjectError(`无法写入 ${VOIDER_CONFIG_FILE}`, 500)
  }

  return { path: projectPath, config }
}

async function listWindowsDrives(): Promise<BrowseEntry[]> {
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  const drives: BrowseEntry[] = []

  await Promise.all(
    letters.map(async (letter) => {
      const drivePath = `${letter}:\\`
      try {
        await access(drivePath, constants.R_OK)
        drives.push({
          name: `${letter}:`,
          path: drivePath,
          isDirectory: true,
        })
      } catch {
        // skip unavailable drives
      }
    }),
  )

  return drives.sort((a, b) => a.name.localeCompare(b.name))
}

export async function browseDirectory(inputPath?: string): Promise<BrowseResult> {
  const trimmed = inputPath?.trim()

  if (!trimmed) {
    if (process.platform === 'win32') {
      return {
        path: '',
        parent: null,
        entries: await listWindowsDrives(),
      }
    }

    return {
      path: '/',
      parent: null,
      entries: [
        {
          name: '/',
          path: '/',
          isDirectory: true,
        },
        {
          name: 'home',
          path: os.homedir(),
          isDirectory: true,
        },
      ],
    }
  }

  const currentPath = normalizeProjectPath(trimmed)
  await assertDirectory(currentPath)

  const parentDir = path.dirname(currentPath)
  const parent =
    parentDir === currentPath || (process.platform === 'win32' && /^[A-Za-z]:\\$/.test(currentPath))
      ? null
      : parentDir

  let names: string[]
  try {
    names = await readdir(currentPath)
  } catch {
    throw new ProjectError('无法读取该文件夹', 500)
  }

  const entries: BrowseEntry[] = []

  await Promise.all(
    names.map(async (name) => {
      if (name.startsWith('.')) return

      const entryPath = path.join(currentPath, name)
      try {
        const info = await stat(entryPath)
        if (info.isDirectory()) {
          entries.push({
            name,
            path: entryPath,
            isDirectory: true,
          })
        }
      } catch {
        // skip inaccessible entries
      }
    }),
  )

  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

  return {
    path: currentPath,
    parent,
    entries,
  }
}
