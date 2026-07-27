import type {
  ProcessorMethod,
  ServiceProcessor,
} from '../../../types/backend-services.js'
import type { DataTypeLibrary } from '../../../types/data-types.js'
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

export function emitRepositoryFile(options: {
  resourceSlug: string
  processor: ServiceProcessor
  typeLibrary: DataTypeLibrary
  idToName: IdToName
  typeIdToGroupStem: Map<string, string>
}): string {
  const {
    resourceSlug,
    processor,
    typeLibrary,
    idToName,
    typeIdToGroupStem,
  } = options
  const className = `${toPascalCase(resourceSlug)}Repository`
  const table = resolveTableName(processor, typeLibrary)
  const methods = (processor.methods ?? [])
    .map((m) => emitDataMethod(m, table, idToName))
    .join('\n\n')

  const refs = [
    processor.entityRef,
    ...(processor.methods ?? []).flatMap(collectRefsFromMethod),
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
