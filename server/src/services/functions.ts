/** Update functions.ts to support pages | components */
import { access, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { ProjectError } from './project.js'
import {
  builtinsForRoot,
  isBuiltinMethodName,
  isValidMethodName,
  parseMethodFile,
  serializeMethodFile,
  type PageMethod,
} from '../types/page-method.js'

export type FunctionRoot = 'pages' | 'components'

const FUNCTION_DIR = 'function'

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

function normalizeRoot(root?: string): FunctionRoot {
  return root === 'components' ? 'components' : 'pages'
}

function functionDir(projectPath: string, root: FunctionRoot, id: string): string {
  return path.join(projectPath, root, id, FUNCTION_DIR)
}

function methodFilePath(
  projectPath: string,
  root: FunctionRoot,
  id: string,
  name: string,
): string {
  return path.join(functionDir(projectPath, root, id), `${name}.ts`)
}

async function ensureFunctionDir(
  projectPath: string,
  root: FunctionRoot,
  id: string,
): Promise<string> {
  const dir = functionDir(projectPath, root, id)
  await mkdir(dir, { recursive: true })
  return dir
}

async function assertResourceExists(
  projectPath: string,
  root: FunctionRoot,
  id: string,
) {
  const dir = path.join(projectPath, root, id)
  try {
    await access(dir, constants.R_OK)
  } catch {
    throw new ProjectError(root === 'components' ? '组件不存在' : '页面不存在', 404)
  }
}

export async function listPageMethods(
  projectPathInput: string,
  pageIdInput: string,
  rootInput?: string,
): Promise<{ methods: PageMethod[] }> {
  const projectPath = normalizeProjectPath(projectPathInput)
  const pageId = assertSafeId(pageIdInput)
  const root = normalizeRoot(rootInput)
  await assertResourceExists(projectPath, root, pageId)

  const dir = await ensureFunctionDir(projectPath, root, pageId)
  let files: string[] = []
  try {
    files = await readdir(dir)
  } catch {
    files = []
  }

  const custom: PageMethod[] = []
  for (const file of files) {
    if (!file.endsWith('.ts')) continue
    const base = file.slice(0, -3)
    if (isBuiltinMethodName(base, root)) continue
    try {
      const raw = await readFile(path.join(dir, file), 'utf-8')
      custom.push(parseMethodFile(raw, base))
    } catch {
      // skip
    }
  }

  custom.sort((a, b) => a.name.localeCompare(b.name))
  return {
    methods: [...builtinsForRoot(root), ...custom],
  }
}

export async function savePageMethod(options: {
  projectPath: string
  pageId: string
  method: PageMethod
  previousName?: string
  root?: string
}): Promise<PageMethod> {
  const projectPath = normalizeProjectPath(options.projectPath)
  const pageId = assertSafeId(options.pageId)
  const root = normalizeRoot(options.root)
  await assertResourceExists(projectPath, root, pageId)

  const name = options.method?.name?.trim() ?? ''
  if (!isValidMethodName(name)) {
    throw new ProjectError('方法名需以字母或下划线开头，仅含字母、数字、下划线')
  }
  if (isBuiltinMethodName(name, root)) {
    throw new ProjectError('不能覆盖预置方法')
  }

  const previousName = options.previousName?.trim()
  if (previousName && isBuiltinMethodName(previousName, root)) {
    throw new ProjectError('不能修改预置方法')
  }

  await ensureFunctionDir(projectPath, root, pageId)

  if (previousName && previousName !== name) {
    try {
      await unlink(methodFilePath(projectPath, root, pageId, previousName))
    } catch {
      // ignore
    }
  }

  const method: PageMethod = {
    name,
    params: Array.isArray(options.method.params) ? options.method.params : [],
    returnType: options.method.returnType || 'void',
    body: typeof options.method.body === 'string' ? options.method.body : '',
    builtin: false,
  }

  await writeFile(
    methodFilePath(projectPath, root, pageId, name),
    serializeMethodFile(method),
    'utf-8',
  )
  return method
}

export async function deletePageMethod(options: {
  projectPath: string
  pageId: string
  name: string
  root?: string
}): Promise<void> {
  const projectPath = normalizeProjectPath(options.projectPath)
  const pageId = assertSafeId(options.pageId)
  const root = normalizeRoot(options.root)
  await assertResourceExists(projectPath, root, pageId)

  const name = options.name?.trim() ?? ''
  if (!name) throw new ProjectError('请提供方法名')
  if (isBuiltinMethodName(name, root)) {
    throw new ProjectError('不能删除预置方法')
  }

  try {
    await unlink(methodFilePath(projectPath, root, pageId, name))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ProjectError('方法不存在', 404)
    }
    throw new ProjectError('删除方法失败', 500)
  }
}
