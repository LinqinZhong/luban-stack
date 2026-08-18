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
import { methodJsDoc } from './js-comments.js'
import { listCommaArrayFieldNames } from '../../../utils/comma-array-fields.js'
import { compileTypeOrmMethodBody } from './compile-typeorm-method.js'

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

function resolveEntityClassName(
  processor: ServiceProcessor,
  library: DataTypeLibrary,
  resourceSlug: string,
): string {
  const entity = findTypeDef(library, processor.entityRef)
  return entity?.name?.trim() || `${toPascalCase(resourceSlug)}Entity`
}

function typeImportLines(
  typeLibrary: DataTypeLibrary,
  idToName: IdToName,
  typeIdToGroupStem: Map<string, string>,
  refs: string[],
  entityClassName: string,
): string {
  const byGroup = new Map<string, Set<string>>()
  for (const ref of refs) {
    if (!ref) continue
    const name = idToName.get(ref)
    const stem = typeIdToGroupStem.get(ref)
    if (!name || !stem) continue
    if (name === entityClassName) continue
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

function emitTypeOrmMethod(
  method: ProcessorMethod,
  table: string,
  idToName: IdToName,
  commaArrayFields: string[],
  typeLibrary: DataTypeLibrary,
): {
  code: string
  imports: string[]
  needsCommaArrayHelper: boolean
  needsSqlBuilder: boolean
} {
  const name = safeIdent(method.name, 'method')
  const { params, returnType } = emitMethodSignature(method, idToName)
  const compiled = compileTypeOrmMethodBody(method, table, {
    returnType,
    commaArrayFields,
    typeLibrary,
  })

  const remark = methodJsDoc(
    method.remark,
    (method.params ?? []).map((p) => ({
      name: safeIdent(p.name, 'param'),
      remark: p.remark,
    })),
  )

  const code = `${remark}  async ${name}(${params}): Promise<${returnType}> {
${compiled.body}
  }`

  return {
    code,
    imports: compiled.imports,
    needsCommaArrayHelper: compiled.needsCommaArrayHelper,
    needsSqlBuilder: compiled.needsSqlBuilder,
  }
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
  const entityClassName = resolveEntityClassName(processor, typeLibrary, resourceSlug)
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
  const allTypeOrmImports = new Set<string>()
  const methodBlocks: string[] = []
  let needsCommaArrayHelper = false
  let needsSqlBuilder = false

  // 出参/实体中数组字段（varchar 逗号串）合并，供 raw query / map 组装后拆分
  const entityArrayFields = listCommaArrayFieldNames(entity)
  const outputArrayFields = new Set<string>(entityArrayFields)
  for (const m of methodsToEmit) {
    for (const ref of [
      m.output?.typeRef,
      m.output?.itemTypeRef,
      m.output?.itemItemTypeRef,
    ]) {
      if (!ref) continue
      for (const name of listCommaArrayFieldNames(
        findTypeDef(typeLibrary, ref),
      )) {
        outputArrayFields.add(name)
      }
    }
  }
  const commaArrayFields = [...outputArrayFields]

  for (const m of methodsToEmit) {
    const emitted = emitTypeOrmMethod(
      m,
      table,
      idToName,
      commaArrayFields,
      typeLibrary,
    )
    methodBlocks.push(emitted.code)
    for (const imp of emitted.imports) allTypeOrmImports.add(imp)
    if (emitted.needsCommaArrayHelper) needsCommaArrayHelper = true
    if (emitted.needsSqlBuilder) needsSqlBuilder = true
  }

  const methods = methodBlocks.join('\n\n')

  const refs = [
    processor.entityRef,
    ...methodsToEmit.flatMap(collectRefsFromMethod),
  ]
  const typeImports = typeImportLines(
    typeLibrary,
    idToName,
    typeIdToGroupStem,
    refs,
    entityClassName,
  )

  const typeormImportList = ['Repository', ...allTypeOrmImports].sort()
  const typeormImportLine = `import { ${typeormImportList.join(', ')} } from 'typeorm'`
  const commaArrayImport = needsCommaArrayHelper
    ? `import { coerceCommaArrayFields, coerceCommaArrayRows } from '../../../common/comma-array'\n`
    : ''
  const sqlBuilderImport = needsSqlBuilder
    ? `import { SqlBuilder } from '../../../common/sql-builder'\n`
    : ''

  return `/** 数据处理器「${processor.name}」 */
import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
${typeormImportLine}
${commaArrayImport}${sqlBuilderImport}import { ${entityClassName} } from './${resourceSlug}.entity'
${typeImports ? typeImports + '\n' : ''}
@Injectable()
export class ${className} {
  constructor(
    @InjectRepository(${entityClassName})
    private readonly repo: Repository<${entityClassName}>,
  ) {}

${methods || '  // no methods\n'}
}
`
}

/** 供模块注册 TypeOrmModule.forFeature 使用 */
export function resolveRepositoryEntityClassName(options: {
  resourceSlug: string
  processor: ServiceProcessor
  typeLibrary: DataTypeLibrary
}): string {
  return resolveEntityClassName(
    options.processor,
    options.typeLibrary,
    options.resourceSlug,
  )
}
