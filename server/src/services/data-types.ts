import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import {
  createEmptyDataTypeLibrary,
  DATA_TYPES_DIR,
  DATA_TYPES_LEGACY_FILE,
  isValidGroupName,
  normalizeDataTypeLibrary,
  normalizeTypeGroupFile,
  type DataTypeGroup,
  type DataTypeLibrary,
} from '../types/data-types.js'
import { ProjectError } from './project.js'

function typesDir(projectPath: string): string {
  return path.join(projectPath, DATA_TYPES_DIR)
}

function legacyTypesPath(projectPath: string): string {
  return path.join(projectPath, DATA_TYPES_LEGACY_FILE)
}

function groupFilePath(projectPath: string, groupName: string): string {
  return path.join(typesDir(projectPath), `${groupName}.json`)
}

async function ensureDir(projectPath: string): Promise<string> {
  const dir = typesDir(projectPath)
  await mkdir(dir, { recursive: true })
  return dir
}

/** 旧 types.json → types/*.json（一次性迁移） */
async function migrateLegacyIfNeeded(projectPath: string): Promise<void> {
  const legacy = legacyTypesPath(projectPath)
  try {
    await access(legacy, constants.R_OK)
  } catch {
    return
  }

  const dir = await ensureDir(projectPath)
  const existing = await readdir(dir)
  const hasGroupFiles = existing.some((f) => f.endsWith('.json'))

  if (!hasGroupFiles) {
    try {
      const raw = await readFile(legacy, 'utf-8')
      const library = normalizeDataTypeLibrary(JSON.parse(raw))
      for (const group of library.groups) {
        const name = group.name.trim()
        if (!isValidGroupName(name)) {
          // 非法名：跳过写入，避免坏文件；保留 legacy 供人工处理
          continue
        }
        const filePath = groupFilePath(projectPath, name)
        const payload = {
          id: group.id,
          types: group.types,
        }
        await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
      }
    } catch {
      // 迁移失败则保留 legacy
      return
    }
  }

  try {
    await rename(legacy, path.join(projectPath, `${DATA_TYPES_LEGACY_FILE}.bak`))
  } catch {
    try {
      await unlink(legacy)
    } catch {
      // ignore
    }
  }
}

export async function readDataTypeLibrary(projectPath: string): Promise<DataTypeLibrary> {
  await migrateLegacyIfNeeded(projectPath)
  const dir = await ensureDir(projectPath)

  let files: string[] = []
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()
  } catch {
    throw new ProjectError(`无法读取 ${DATA_TYPES_DIR}/`, 500)
  }

  const groups: DataTypeGroup[] = []
  for (const file of files) {
    const name = file.replace(/\.json$/i, '')
    if (!isValidGroupName(name)) continue
    const filePath = path.join(dir, file)
    try {
      const raw = await readFile(filePath, 'utf-8')
      const group = normalizeTypeGroupFile(JSON.parse(raw), name)
      if (group) groups.push(group)
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new ProjectError(`${DATA_TYPES_DIR}/${file} 不是合法 JSON`, 400)
      }
      throw new ProjectError(`无法读取 ${DATA_TYPES_DIR}/${file}`, 500)
    }
  }

  return { groups }
}

export async function saveDataTypeLibrary(
  projectPath: string,
  library: unknown,
): Promise<DataTypeLibrary> {
  const normalized = normalizeDataTypeLibrary(library)
  const dir = await ensureDir(projectPath)

  // 校验分组名
  const seen = new Set<string>()
  for (const group of normalized.groups) {
    const name = group.name.trim()
    if (!isValidGroupName(name)) {
      throw new ProjectError(
        `分组名「${name || '(空)'}」不合法：仅允许纯英文（字母开头，字母/数字/下划线）`,
        400,
      )
    }
    if (seen.has(name)) {
      throw new ProjectError(`分组名重复：${name}`, 400)
    }
    seen.add(name)
  }

  // 写入各组文件
  for (const group of normalized.groups) {
    const name = group.name.trim()
    const payload = {
      id: group.id,
      types: group.types,
    }
    try {
      await writeFile(
        groupFilePath(projectPath, name),
        `${JSON.stringify(payload, null, 2)}\n`,
        'utf-8',
      )
    } catch {
      throw new ProjectError(`无法写入 ${DATA_TYPES_DIR}/${name}.json`, 500)
    }
  }

  // 删除已不存在的分组文件
  let files: string[] = []
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
  } catch {
    files = []
  }
  for (const file of files) {
    const name = file.replace(/\.json$/i, '')
    if (!seen.has(name)) {
      try {
        await unlink(path.join(dir, file))
      } catch {
        // ignore
      }
    }
  }

  // 清理遗留单文件
  try {
    await unlink(legacyTypesPath(projectPath))
  } catch {
    // ignore
  }

  return readDataTypeLibrary(projectPath)
}

export async function ensureDataTypeLibraryFile(projectPath: string): Promise<void> {
  await migrateLegacyIfNeeded(projectPath)
  await ensureDir(projectPath)
}
