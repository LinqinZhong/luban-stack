import {
  access,
  mkdir,
  readdir,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { ProjectError } from './project.js'

const LOG_DIR_REL = path.join('.lubanstack', 'ai-assistant-log')
const GITIGNORE_ENTRY = '.lubanstack/ai-assistant-log/'
const LOCK_STALE_MS = 20_000
const SAFE_ID_RE = /^[a-zA-Z0-9._-]+$/

export type AiAssistantLogStatus = 'running' | 'done' | 'error' | 'cancelled'

export type AiAssistantLogRecord = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  modelId?: string
  modelName?: string
  status: AiAssistantLogStatus
  timeline: unknown[]
}

export type AiAssistantLogSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  modelId?: string
  modelName?: string
  status: AiAssistantLogStatus
}

type LockState = {
  ownerId: string
  acquiredAt: number
  heartbeatAt: number
}

const locks = new Map<string, LockState>()

function normalizeProjectPath(input: string): string {
  if (!input || typeof input !== 'string' || !input.trim()) {
    throw new ProjectError('请提供项目路径')
  }
  return path.resolve(input.trim())
}

function logDir(projectPath: string): string {
  return path.join(projectPath, LOG_DIR_REL)
}

function logFilePath(projectPath: string, id: string): string {
  if (!SAFE_ID_RE.test(id)) {
    throw new ProjectError('无效的日志 id')
  }
  return path.join(logDir(projectPath), `${id}.json`)
}

async function assertProjectDir(projectPath: string): Promise<void> {
  try {
    await access(projectPath, constants.R_OK)
  } catch {
    throw new ProjectError('项目路径不存在', 404)
  }
}

/** 确保日志目录存在，并在项目 .gitignore 中排除该路径 */
export async function ensureAiAssistantLogDir(projectPath: string): Promise<string> {
  const root = normalizeProjectPath(projectPath)
  await assertProjectDir(root)
  const dir = logDir(root)
  await mkdir(dir, { recursive: true })
  await ensureGitignoreEntry(root)
  return dir
}

async function ensureGitignoreEntry(projectPath: string): Promise<void> {
  const gitignorePath = path.join(projectPath, '.gitignore')
  let content = ''
  try {
    content = await readFile(gitignorePath, 'utf-8')
  } catch {
    content = ''
  }

  const lines = content.split(/\r?\n/)
  const hasEntry = lines.some((line) => {
    const trimmed = line.trim()
    return (
      trimmed === GITIGNORE_ENTRY ||
      trimmed === GITIGNORE_ENTRY.slice(0, -1) ||
      trimmed === '.lubanstack/' ||
      trimmed === '.lubanstack'
    )
  })
  if (hasEntry) return

  const next =
    content.length === 0
      ? `${GITIGNORE_ENTRY}\n`
      : `${content.replace(/\s*$/, '')}\n\n${GITIGNORE_ENTRY}\n`
  try {
    await writeFile(gitignorePath, next, 'utf-8')
  } catch {
    // 忽略无法写入 gitignore（权限/只读）
  }
}

function toSummary(record: AiAssistantLogRecord): AiAssistantLogSummary {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    modelId: record.modelId,
    modelName: record.modelName,
    status: record.status,
  }
}

function isRecord(value: unknown): value is AiAssistantLogRecord {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.title === 'string' &&
    typeof row.createdAt === 'string' &&
    typeof row.updatedAt === 'string' &&
    typeof row.status === 'string' &&
    Array.isArray(row.timeline)
  )
}

async function readLogFile(
  projectPath: string,
  id: string,
): Promise<AiAssistantLogRecord | null> {
  try {
    const raw = await readFile(logFilePath(projectPath, id), 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

export async function listAiAssistantLogs(
  projectPath: string,
): Promise<AiAssistantLogSummary[]> {
  const root = normalizeProjectPath(projectPath)
  await ensureAiAssistantLogDir(root)
  const dir = logDir(root)
  let names: string[] = []
  try {
    names = await readdir(dir)
  } catch {
    return []
  }

  const summaries: AiAssistantLogSummary[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const id = name.slice(0, -5)
    const record = await readLogFile(root, id)
    if (record) summaries.push(toSummary(record))
  }

  summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  return summaries
}

export async function getAiAssistantLog(
  projectPath: string,
  id: string,
): Promise<AiAssistantLogRecord> {
  const root = normalizeProjectPath(projectPath)
  await ensureAiAssistantLogDir(root)
  const record = await readLogFile(root, id)
  if (!record) throw new ProjectError('日志不存在', 404)
  return record
}

export async function saveAiAssistantLog(
  projectPath: string,
  input: Partial<AiAssistantLogRecord> & { id: string; title: string },
): Promise<AiAssistantLogRecord> {
  const root = normalizeProjectPath(projectPath)
  await ensureAiAssistantLogDir(root)

  const now = new Date().toISOString()
  const existing = await readLogFile(root, input.id)
  const record: AiAssistantLogRecord = {
    id: input.id,
    title: (input.title || existing?.title || '未命名').slice(0, 120),
    createdAt: existing?.createdAt || input.createdAt || now,
    updatedAt: now,
    modelId: input.modelId ?? existing?.modelId,
    modelName: input.modelName ?? existing?.modelName,
    status: input.status ?? existing?.status ?? 'done',
    timeline: Array.isArray(input.timeline)
      ? input.timeline
      : (existing?.timeline ?? []),
  }

  await writeFile(
    logFilePath(root, record.id),
    `${JSON.stringify(record, null, 2)}\n`,
    'utf-8',
  )
  return record
}

export async function deleteAiAssistantLog(
  projectPath: string,
  id: string,
): Promise<void> {
  const root = normalizeProjectPath(projectPath)
  await ensureAiAssistantLogDir(root)
  try {
    await unlink(logFilePath(root, id))
  } catch {
    throw new ProjectError('日志不存在', 404)
  }
}

function getFreshLock(projectPath: string): LockState | null {
  const lock = locks.get(projectPath)
  if (!lock) return null
  if (Date.now() - lock.heartbeatAt > LOCK_STALE_MS) {
    locks.delete(projectPath)
    return null
  }
  return lock
}

export function getAiAssistantLock(projectPath: string): {
  locked: boolean
  ownerId: string | null
} {
  const root = normalizeProjectPath(projectPath)
  const lock = getFreshLock(root)
  return {
    locked: Boolean(lock),
    ownerId: lock?.ownerId ?? null,
  }
}

export function acquireAiAssistantLock(
  projectPath: string,
  ownerId: string,
): { ok: true; ownerId: string } | { ok: false; ownerId: string } {
  const root = normalizeProjectPath(projectPath)
  if (!ownerId?.trim()) throw new ProjectError('缺少 ownerId')
  const id = ownerId.trim()
  const existing = getFreshLock(root)
  if (existing && existing.ownerId !== id) {
    return { ok: false, ownerId: existing.ownerId }
  }
  const now = Date.now()
  locks.set(root, {
    ownerId: id,
    acquiredAt: existing?.acquiredAt ?? now,
    heartbeatAt: now,
  })
  return { ok: true, ownerId: id }
}

export function heartbeatAiAssistantLock(
  projectPath: string,
  ownerId: string,
): { ok: boolean; ownerId: string | null } {
  const root = normalizeProjectPath(projectPath)
  const existing = getFreshLock(root)
  if (!existing || existing.ownerId !== ownerId?.trim()) {
    return { ok: false, ownerId: existing?.ownerId ?? null }
  }
  existing.heartbeatAt = Date.now()
  locks.set(root, existing)
  return { ok: true, ownerId: existing.ownerId }
}

export function releaseAiAssistantLock(
  projectPath: string,
  ownerId: string,
): { ok: boolean } {
  const root = normalizeProjectPath(projectPath)
  const existing = getFreshLock(root)
  if (!existing) return { ok: true }
  if (existing.ownerId !== ownerId?.trim()) return { ok: false }
  locks.delete(root)
  return { ok: true }
}
