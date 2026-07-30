import type {
  ProcessorMethod,
  ServiceProcessor,
} from '../../../types/backend-services.js'
import type { DataTypeLibrary } from '../../../types/data-types.js'
import type { MysqlColumnDef, MysqlIndexDef } from '../../../types/mysql.js'
import {
  buildPresetMethods,
} from '../../../utils/data-preset-methods.js'
import {
  findTypeDef,
  type IdToName,
} from './emit-types.js'
import { safeIdent, toPascalCase } from './names.js'
import { emitMethodSignature } from './emit-flow.js'

function resolveTableName(
  processor: ServiceProcessor,
  library: DataTypeLibrary,
): string {
  const entity = findTypeDef(library, processor.entityRef)
  const table =
    entity?.tableName?.trim() ||
    entity?.name?.trim() ||
    processor.name ||
    'table'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) return 'unknown_table'
  return table
}

function typeImportLines(
  typeLibrary: DataTypeLibrary,
  idToName: IdToName,
  typeIdToGroupStem: Map<string, string>,
  refs: string[],
): string {
  const byGroup = new Map<string, Set<string>>()
  for (const ref of refs) {
    if (!ref) continue
    const name = idToName.get(ref)
    const stem = typeIdToGroupStem.get(ref)
    if (!name || !stem) continue
    if (!byGroup.has(stem)) byGroup.set(stem, new Set())
    byGroup.get(stem)!.add(name)
  }
  return [...byGroup.entries()]
    .map(
      ([stem, names]) =>
        `import type { ${[...names].sort().join(', ')} } from '../../../types/${stem}'`,
    )
    .join('\n')
}

function collectRefsFromMethod(method: ProcessorMethod): string[] {
  const refs: string[] = []
  const push = (r?: string) => {
    if (r) refs.push(r)
  }
  push(method.output?.typeRef)
  push(method.output?.itemTypeRef)
  push(method.output?.itemItemTypeRef)
  for (const v of Object.values(method.output?.genericArgs || {})) push(v)
  for (const p of method.params ?? []) {
    push(p.typeExpr?.typeRef)
    push(p.typeExpr?.itemTypeRef)
    push(p.typeExpr?.itemItemTypeRef)
    for (const v of Object.values(p.typeExpr?.genericArgs || {})) push(v)
  }
  return refs
}

function emitDataMethod(
  method: ProcessorMethod,
  table: string,
  idToName: IdToName,
): string {
  const name = safeIdent(method.name, 'method')
  const { params, returnType } = emitMethodSignature(method, idToName)
  const config = method.dataConfig
  const paramNames = (method.params ?? []).map((p) =>
    safeIdent(p.name, 'param'),
  )
  const paramsObject =
    paramNames.length === 0 ? '{}' : `{ ${paramNames.join(', ')} }`

  const outputMeta = {
    type: method.output?.type || 'json',
    typeRef: method.output?.typeRef || '',
    itemType: method.output?.itemType || '',
    itemTypeRef: method.output?.itemTypeRef || '',
  }

  const remark = method.remark?.trim()
    ? `  /** ${method.remark.trim()} */\n`
    : ''

  return `${remark}  async ${name}(${params}): Promise<${returnType}> {
    return runDataMethod({
      table: ${JSON.stringify(table)},
      config: ${JSON.stringify(config, null, 2)} as unknown as DataMethodConfig,
      params: ${paramsObject},
      output: ${JSON.stringify(outputMeta)},
      dryRun: false,
    }) as Promise<${returnType}>
  }`
}

/** 从业务流节点收集被引用的 dataMethodId（按 processorId 分组） */
export function collectUsedDataMethodIds(
  businessProcessors: ServiceProcessor[],
): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>()
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
        if (!used.has(processorId)) used.set(processorId, new Set())
        used.get(processorId)!.add(methodId)
      }
    }
  }
  return used
}

export function emitRepositoryFile(options: {
  resourceSlug: string
  processor: ServiceProcessor
  typeLibrary: DataTypeLibrary
  idToName: IdToName
  typeIdToGroupStem: Map<string, string>
  /** 该数据处理器被业务流引用到的方法 id；预置方法仅在此集合内才生成 */
  usedMethodIds?: Set<string>
  /** 表列与索引（含 logicDelete），用于还原预置方法 */
  tableColumns?: MysqlColumnDef[]
  tableIndexes?: MysqlIndexDef[]
}): string {
  const {
    resourceSlug,
    processor,
    typeLibrary,
    idToName,
    typeIdToGroupStem,
    usedMethodIds,
    tableColumns = [],
    tableIndexes = [],
  } = options
  const className = `${toPascalCase(resourceSlug)}Repository`
  const table = resolveTableName(processor, typeLibrary)

  const entity = findTypeDef(typeLibrary, processor.entityRef)
  const presets = buildPresetMethods({
    entity,
    columns: tableColumns,
    indexes: tableIndexes,
  }).filter((m) => !m.disabled)

  const customMethods = processor.methods ?? []
  const customNames = new Set(
    customMethods.map((m) => m.name.trim()).filter(Boolean),
  )
  const usedPresets = presets.filter((m) => {
    if (customNames.has(m.name.trim())) return false
    if (!usedMethodIds || usedMethodIds.size === 0) return false
    return usedMethodIds.has(m.id)
  })

  const methodsToEmit = [...usedPresets, ...customMethods]
  const methods = methodsToEmit
    .map((m) => emitDataMethod(m, table, idToName))
    .join('\n\n')

  const refs = [
    processor.entityRef,
    ...methodsToEmit.flatMap(collectRefsFromMethod),
  ]
  const imports = typeImportLines(
    typeLibrary,
    idToName,
    typeIdToGroupStem,
    refs,
  )

  return `/** 数据处理器「${processor.name}」 */
import { Injectable } from '@nestjs/common'
import {
  runDataMethod,
  type DataMethodConfig,
} from '../../../common/data-method'
${imports ? imports + '\n' : ''}
@Injectable()
export class ${className} {
${methods || '  // no methods\n'}
}
`
}
