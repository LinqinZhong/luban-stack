import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { ProjectError } from './project.js'
import {
  createEmptyLifecycleConfig,
  normalizeLifecycleConfig,
  type LifecycleConfig,
} from '../types/lifecycle.js'

export type LifecycleRoot = 'pages' | 'components'

const LIFECYCLE_FILE = 'lifecycle.json'

function normalizeProjectPath(input: string): string {
  if (!input || typeof input !== 'string' || !input.trim()) {
    throw new ProjectError('请提供项目路径')
  }
  return path.resolve(input.trim())
}

function assertSafeId(id: string): string {
  const value = id?.trim()
  if (!value) throw new ProjectError('请提供资源 ID')
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new ProjectError('ID 仅支持字母、数字、下划线和短横线')
  }
  return value
}

function normalizeRoot(root?: string): LifecycleRoot {
  return root === 'components' ? 'components' : 'pages'
}

function resourceDir(projectPath: string, root: LifecycleRoot, id: string): string {
  return path.join(projectPath, root, id)
}

function lifecycleFilePath(
  projectPath: string,
  root: LifecycleRoot,
  id: string,
): string {
  return path.join(resourceDir(projectPath, root, id), LIFECYCLE_FILE)
}

async function assertResourceExists(
  projectPath: string,
  root: LifecycleRoot,
  id: string,
) {
  const dir = resourceDir(projectPath, root, id)
  try {
    await access(dir, constants.R_OK)
  } catch {
    throw new ProjectError(root === 'components' ? '组件不存在' : '页面不存在', 404)
  }
}

export async function getLifecycle(
  projectPathInput: string,
  idInput: string,
  rootInput?: string,
): Promise<{ lifecycle: LifecycleConfig }> {
  const projectPath = normalizeProjectPath(projectPathInput)
  const root = normalizeRoot(rootInput)
  const id = assertSafeId(idInput)
  await assertResourceExists(projectPath, root, id)

  const file = lifecycleFilePath(projectPath, root, id)
  try {
    const raw = await readFile(file, 'utf-8')
    return { lifecycle: normalizeLifecycleConfig(JSON.parse(raw)) }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { lifecycle: createEmptyLifecycleConfig() }
    }
    if (err instanceof SyntaxError) {
      return { lifecycle: createEmptyLifecycleConfig() }
    }
    throw new ProjectError(`无法读取 ${LIFECYCLE_FILE}`, 500)
  }
}

export async function saveLifecycle(options: {
  projectPath: string
  id: string
  root?: string
  lifecycle: unknown
}): Promise<{ lifecycle: LifecycleConfig }> {
  const projectPath = normalizeProjectPath(options.projectPath)
  const root = normalizeRoot(options.root)
  const id = assertSafeId(options.id)
  await assertResourceExists(projectPath, root, id)

  const lifecycle = normalizeLifecycleConfig(options.lifecycle)
  const dir = resourceDir(projectPath, root, id)
  await mkdir(dir, { recursive: true })

  try {
    await writeFile(
      lifecycleFilePath(projectPath, root, id),
      `${JSON.stringify(lifecycle, null, 2)}\n`,
      'utf-8',
    )
  } catch {
    throw new ProjectError(`无法写入 ${LIFECYCLE_FILE}`, 500)
  }

  return { lifecycle }
}
