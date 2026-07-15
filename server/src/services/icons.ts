import { access, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import {
  createDefaultIconLibrary,
  createEmptyIconLibrary,
  ICONS_FILE,
  normalizeIconLibrary,
  type IconLibrary,
} from '../types/icon-library.js'
import { ProjectError } from './project.js'

function iconsPath(projectPath: string): string {
  return path.join(projectPath, ICONS_FILE)
}

export async function readIconLibrary(projectPath: string): Promise<IconLibrary> {
  const filePath = iconsPath(projectPath)

  try {
    await access(filePath, constants.R_OK)
  } catch {
    const initial = createDefaultIconLibrary()
    try {
      await writeFile(filePath, `${JSON.stringify(initial, null, 2)}\n`, 'utf-8')
    } catch {
      // 只读失败时仍返回默认库，不阻塞打开项目
    }
    return initial
  }

  try {
    const raw = await readFile(filePath, 'utf-8')
    return normalizeIconLibrary(JSON.parse(raw))
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new ProjectError(`${ICONS_FILE} 不是合法 JSON`, 400)
    }
    throw new ProjectError(`无法读取 ${ICONS_FILE}`, 500)
  }
}

export async function saveIconLibrary(
  projectPath: string,
  library: unknown,
): Promise<IconLibrary> {
  const normalized = normalizeIconLibrary(library)
  const filePath = iconsPath(projectPath)

  try {
    await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8')
  } catch {
    throw new ProjectError(`无法写入 ${ICONS_FILE}`, 500)
  }

  return normalized
}

export async function ensureIconLibraryFile(projectPath: string): Promise<void> {
  const filePath = iconsPath(projectPath)
  try {
    await access(filePath, constants.F_OK)
  } catch {
    const initial = createDefaultIconLibrary()
    await writeFile(filePath, `${JSON.stringify(initial, null, 2)}\n`, 'utf-8')
  }
}
