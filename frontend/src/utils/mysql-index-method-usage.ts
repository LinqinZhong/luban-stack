import {
  getBackendServiceLibrary,
  getServiceProcessors,
} from '../api/projects'
import type { DataTypeLibrary } from '../types/data-types'
import type { MysqlColumnDef, MysqlIndexDef } from '../types/mysql'
import type { ServiceProcessor } from '../types/backend-services'
import { indexBySuffix } from './data-preset-methods'

export interface MysqlIndexMethodUsageRef {
  serviceId: string
  serviceName: string
  processorId: string
  processorName: string
  businessMethodId: string
  businessMethodName: string
  dataMethodId: string
  dataMethodName: string
}

export interface MysqlIndexMethodUsage {
  methodIds: string[]
  methodNames: string[]
  refs: MysqlIndexMethodUsageRef[]
}

/** 索引对应的预置方法 id / 展示名 */
export function presetMethodsForIndex(
  index: MysqlIndexDef,
  columns: MysqlColumnDef[],
): { id: string; name: string }[] {
  const name = index.name.trim()
  if (!name) return []
  const by = indexBySuffix(index, columns)
  return [
    {
      id: `preset_countBy_${name}`,
      name: by ? `countBy${by}` : `countBy(${name})`,
    },
    {
      id: `preset_pageBy_${name}`,
      name: by ? `pageBy${by}` : `pageBy(${name})`,
    },
  ]
}

function collectEntityIdsForTable(
  typeLibrary: DataTypeLibrary | null | undefined,
  tableName: string,
): Set<string> {
  const ids = new Set<string>()
  const target = tableName.trim()
  if (!target) return ids
  for (const group of typeLibrary?.groups ?? []) {
    for (const t of group.types) {
      if (t.tableName?.trim() === target) ids.add(t.id)
    }
  }
  return ids
}

function scanBusinessFlowRefs(
  businessProcessors: ServiceProcessor[],
  dataProcessorIds: Set<string>,
  methodById: Map<string, string>,
  serviceId: string,
  serviceName: string,
): MysqlIndexMethodUsageRef[] {
  const refs: MysqlIndexMethodUsageRef[] = []
  for (const proc of businessProcessors) {
    for (const method of proc.methods ?? []) {
      for (const node of method.flow?.nodes ?? []) {
        const data = node.data
        if (!data || typeof data !== 'object' || Array.isArray(data)) continue
        const raw = data as Record<string, unknown>
        const processorId =
          typeof raw.dataProcessorId === 'string'
            ? raw.dataProcessorId.trim()
            : ''
        const methodId =
          typeof raw.dataMethodId === 'string' ? raw.dataMethodId.trim() : ''
        if (!processorId || !methodId) continue
        if (!dataProcessorIds.has(processorId)) continue
        if (!methodById.has(methodId)) continue
        refs.push({
          serviceId,
          serviceName,
          processorId: proc.id,
          processorName: proc.name || proc.id,
          businessMethodId: method.id,
          businessMethodName: method.name || method.id,
          dataMethodId: methodId,
          dataMethodName: methodById.get(methodId) || methodId,
        })
      }
    }
  }
  return refs
}

/**
 * 检查索引对应的预置方法是否被任意服务的业务流引用。
 */
export async function findMysqlIndexMethodUsage(options: {
  projectPath: string
  tableName: string
  index: MysqlIndexDef
  columns: MysqlColumnDef[]
  typeLibrary?: DataTypeLibrary | null
}): Promise<MysqlIndexMethodUsage> {
  const methods = presetMethodsForIndex(options.index, options.columns)
  const empty: MysqlIndexMethodUsage = {
    methodIds: methods.map((m) => m.id),
    methodNames: methods.map((m) => m.name),
    refs: [],
  }
  if (!methods.length || !options.projectPath.trim()) return empty

  const methodById = new Map(methods.map((m) => [m.id, m.name]))
  const entityIds = collectEntityIdsForTable(
    options.typeLibrary,
    options.tableName,
  )
  if (!entityIds.size) return empty

  const lib = await getBackendServiceLibrary(options.projectPath)
  const refs: MysqlIndexMethodUsageRef[] = []

  for (const service of lib.services ?? []) {
    const [dataRes, bizRes] = await Promise.all([
      getServiceProcessors(options.projectPath, service.id, 'data'),
      getServiceProcessors(options.projectPath, service.id, 'business'),
    ])
    const dataProcessorIds = new Set(
      (dataRes.processors ?? [])
        .filter((p) => entityIds.has(p.entityRef))
        .map((p) => p.id),
    )
    if (!dataProcessorIds.size) continue
    refs.push(
      ...scanBusinessFlowRefs(
        bizRes.processors ?? [],
        dataProcessorIds,
        methodById,
        service.id,
        service.name || service.id,
      ),
    )
  }

  return {
    methodIds: methods.map((m) => m.id),
    methodNames: methods.map((m) => m.name),
    refs,
  }
}

export async function findMysqlIndexesMethodUsage(options: {
  projectPath: string
  tableName: string
  indexes: MysqlIndexDef[]
  columns: MysqlColumnDef[]
  typeLibrary?: DataTypeLibrary | null
}): Promise<Map<string, MysqlIndexMethodUsage>> {
  const result = new Map<string, MysqlIndexMethodUsage>()
  for (const index of options.indexes) {
    const key = index.name.trim()
    if (!key || result.has(key)) continue
    result.set(
      key,
      await findMysqlIndexMethodUsage({
        ...options,
        index,
      }),
    )
  }
  return result
}

export function formatIndexUsageWarning(
  indexName: string,
  usage: MysqlIndexMethodUsage,
): string {
  const methodText = usage.methodNames.length
    ? usage.methodNames.join('、')
    : '相关预置方法'
  const places = usage.refs
    .slice(0, 5)
    .map(
      (r) =>
        `「${r.serviceName}」${r.processorName}.${r.businessMethodName} → ${r.dataMethodName}`,
    )
  const more =
    usage.refs.length > 5 ? `等共 ${usage.refs.length} 处` : `${usage.refs.length} 处`
  const detail = places.length ? `\n${places.join('\n')}` : ''
  return `索引「${indexName}」对应的预置方法（${methodText}）已被业务流引用（${more}）。删除后这些方法将消失，确定仍要删除？${detail}`
}
