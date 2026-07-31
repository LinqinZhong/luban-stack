import { access, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import {
  createDefaultColorPalette,
  createEmptyColorPalette,
  normalizeColorPalette,
  PALETTE_FILE,
  type ColorPalette,
} from '../types/color-palette.js'
import { ProjectError } from './project.js'

function palettePath(projectPath: string): string {
  return path.join(projectPath, PALETTE_FILE)
}

export async function readColorPalette(
  projectPath: string,
): Promise<ColorPalette> {
  const filePath = palettePath(projectPath)

  try {
    await access(filePath, constants.R_OK)
  } catch {
    const initial = createDefaultColorPalette()
    try {
      await writeFile(filePath, `${JSON.stringify(initial, null, 2)}\n`, 'utf-8')
    } catch {
      // 只读失败时仍返回默认库，不阻塞打开项目
    }
    return initial
  }

  try {
    const raw = await readFile(filePath, 'utf-8')
    return normalizeColorPalette(JSON.parse(raw))
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new ProjectError(`${PALETTE_FILE} 不是合法 JSON`, 400)
    }
    throw new ProjectError(`无法读取 ${PALETTE_FILE}`, 500)
  }
}

export async function saveColorPalette(
  projectPath: string,
  library: unknown,
): Promise<ColorPalette> {
  const normalized = normalizeColorPalette(library)
  const filePath = palettePath(projectPath)

  try {
    await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8')
  } catch {
    throw new ProjectError(`无法写入 ${PALETTE_FILE}`, 500)
  }

  return normalized
}

export async function ensureColorPaletteFile(
  projectPath: string,
): Promise<void> {
  const filePath = palettePath(projectPath)
  try {
    await access(filePath, constants.F_OK)
  } catch {
    const initial = createDefaultColorPalette()
    await writeFile(filePath, `${JSON.stringify(initial, null, 2)}\n`, 'utf-8')
  }
}

export { createEmptyColorPalette }
