import type {
  MethodFlow,
  FlowNode,
  ProcessorMethod,
  ProcessorTypeExpr,
  ServiceProcessor,
} from '../../../types/backend-services.js'
import { safeIdent, slugify, toCamelCase } from './names.js'
import { processorTypeExprToTs, type IdToName } from './emit-types.js'
import {
  PAGE_META_FIELDS,
  PAGE_RECORDS_FIELD,
  readPageMapFieldMappings,
} from '../../../utils/page-map-flow.js'
import { readObjectMapFieldMappings } from '../../../utils/object-map-flow.js'
import { defaultEmptyReturnCode } from '../../../utils/empty-return-value.js'

export interface FlowEmitContext {
  /** processorId → resource slug */
  processorSlugById: Map<string, string>
  /** processorId → 'data' | 'business' */
  processorLayerById: Map<string, 'data' | 'business'>
  /** processorId → 域模块 slug（如 shop / user） */
  processorModuleSlugById?: Map<string, string>
  /** 当前类内资源 slug */
  selfResourceSlug: string
  mode: 'service' | 'controller'
  idToName: IdToName
  methodById: Map<string, { processorId: string; method: ProcessorMethod }>
  /** 当前正在导出的方法/API 出参类型（终止节点空返回时用） */
  methodOutput?: ProcessorTypeExpr
  /** 当前 BackendService id；跨模块输入节点查找用 */
  currentServiceId?: string
  /** 当前域模块 slug */
  currentModuleSlug?: string
}

function str(data: Record<string, unknown>, key: string): string {
  const v = data[key]
  return typeof v === 'string' ? v : ''
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

function indent(level: number): string {
  return '  '.repeat(level)
}

/** 节点「说明」→ 行注释；多行说明逐行加 // */
function emitDescriptionComment(
  pad: string,
  data: Record<string, unknown>,
): string {
  const desc = str(data, 'description').trim()
  if (!desc) return ''
  return desc
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => `${pad}// ${line}`)
    .join('\n')
    .concat('\n')
}

/** 当前节点代码与后续节点之间空一行 */
function joinNodeCode(block: string, next: string): string {
  if (!block) return next
  const body = block.endsWith('\n') ? block : `${block}\n`
  if (!next) return body
  if (next.startsWith('\n')) return body + next
  return `${body}\n${next}`
}

function findStart(flow: MethodFlow): FlowNode | null {
  return flow.nodes.find((n) => n.kind === 'start') ?? null
}

function edgesFrom(flow: MethodFlow, nodeId: string) {
  return flow.edges.filter((e) => e.source === nodeId)
}

function pickDefaultNext(flow: MethodFlow, nodeId: string): string | null {
  const outs = edgesFrom(flow, nodeId)
  const def =
    outs.find((e) => !e.sourceHandle || e.sourceHandle === 'default') ??
    outs.find((e) => e.sourceHandle !== 'true' && e.sourceHandle !== 'false')
  return def?.target ?? null
}

function pickBranchNext(
  flow: MethodFlow,
  nodeId: string,
  handle: 'true' | 'false',
): string | null {
  const outs = edgesFrom(flow, nodeId)
  const hit = outs.find((e) => e.sourceHandle === handle)
  return hit?.target ?? null
}

function emitCallArgs(
  method: ProcessorMethod,
  bindings: Record<string, string>,
): string {
  return (method.params ?? [])
    .map((p) => {
      const expr = bindings[p.name]
      return expr && expr.trim() ? expr.trim() : 'undefined'
    })
    .join(', ')
}

function emitMethodCall(
  ctx: FlowEmitContext,
  processorId: string,
  methodId: string,
  bindings: Record<string, string>,
  opts?: { serviceId?: string },
): string {
  const targetServiceId = opts?.serviceId?.trim() || ''
  const meta = ctx.methodById.get(methodId)
  const method = meta?.method
  if (!method) {
    const cross = targetServiceId
      ? ` (serviceId=${targetServiceId})`
      : ''
    return `/* missing method ${methodId}${cross}; cross-module call not emitted */ undefined as never`
  }

  // 预置方法 id（如 preset_oneById）跨表重复，必须以节点上的 processorId 定位资源
  const slug = ctx.processorSlugById.get(processorId) || 'resource'
  const layer = ctx.processorLayerById.get(processorId) || 'data'
  const methodName = safeIdent(method.name, 'method')
  const args = emitCallArgs(method, bindings)

  if (layer === 'data') {
    if (ctx.mode === 'service' && slug === ctx.selfResourceSlug) {
      return `await this.repo.${methodName}(${args})`
    }
    const repo = `${toCamelCase(slug)}Repo`
    return `await this.${repo}.${methodName}(${args})`
  }

  if (ctx.mode === 'controller') {
    const svc = `${toCamelCase(slug)}Service`
    return `await this.${svc}.${methodName}(${args})`
  }
  if (slug === ctx.selfResourceSlug) {
    return `await this.${methodName}(${args})`
  }
  const svc = `${toCamelCase(slug)}Service`
  return `await this.${svc}.${methodName}(${args})`
}

/** 业务/控制器流中引用的外部资源（跨 resource / 跨域模块） */
export type ExternalInjectDep = {
  resourceSlug: string
  moduleSlug: string
  layer: 'data' | 'business'
}

export function collectExternalInjectDeps(
  flows: Array<MethodFlow | null | undefined>,
  ctx: Pick<
    FlowEmitContext,
    | 'processorSlugById'
    | 'processorLayerById'
    | 'processorModuleSlugById'
    | 'methodById'
    | 'selfResourceSlug'
    | 'currentModuleSlug'
  >,
): ExternalInjectDep[] {
  const out = new Map<string, ExternalInjectDep>()
  for (const flow of flows) {
    for (const node of flow?.nodes ?? []) {
      if (node.kind !== 'input' && node.kind !== 'output') continue
      const data = asRecord(node.data)
      if (str(data, 'channel') === 'network') continue
      if (node.kind === 'input' && str(data, 'dataSource') === 'request_header') {
        continue
      }
      const processorId = str(data, 'dataProcessorId')
      if (!processorId) continue
      const resourceSlug = ctx.processorSlugById.get(processorId) || ''
      if (!resourceSlug) continue
      const moduleSlug =
        ctx.processorModuleSlugById?.get(processorId) ||
        ctx.currentModuleSlug ||
        ''
      const layer = ctx.processorLayerById.get(processorId) || 'data'
      const sameResource = resourceSlug === ctx.selfResourceSlug
      const sameModule =
        !moduleSlug ||
        !ctx.currentModuleSlug ||
        moduleSlug === ctx.currentModuleSlug
      if (sameResource && sameModule) continue
      const key = `${moduleSlug}/${resourceSlug}/${layer}`
      if (!out.has(key)) {
        out.set(key, { resourceSlug, moduleSlug, layer })
      }
    }
  }
  return [...out.values()]
}

type EmitParamRow = {
  name: string
  valueKind: 'variable' | 'constant'
  value: string
  constantType?: string
}

function readEmitParamRows(raw: unknown): EmitParamRow[] {
  if (!Array.isArray(raw)) return []
  const out: EmitParamRow[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (!name) continue
    out.push({
      name,
      valueKind: row.valueKind === 'variable' ? 'variable' : 'constant',
      value: row.value == null ? '' : String(row.value),
      constantType:
        typeof row.constantType === 'string' ? row.constantType : 'string',
    })
  }
  return out
}

function emitParamValueExpr(row: EmitParamRow): string {
  if (row.valueKind === 'variable') {
    const v = row.value.trim()
    return v ? safeIdent(v, 'v') : 'undefined'
  }
  if (row.constantType === 'number') {
    const n = Number(row.value)
    return Number.isFinite(n) ? String(n) : '0'
  }
  if (row.constantType === 'boolean') {
    const t = row.value.trim().toLowerCase()
    return t === 'true' || t === '1' ? 'true' : 'false'
  }
  return JSON.stringify(row.value)
}

function emitNetworkHttpBlock(
  pad: string,
  data: Record<string, unknown>,
  opts: { awaitResult: boolean },
): string {
  const network = asRecord(data.network)
  const src = Object.keys(network).length ? network : data
  const apiUrlRaw = str(src, 'apiUrl').trim() || '""'
  const method = (str(src, 'httpMethod') || 'GET').toUpperCase()
  const mediaType = str(src, 'mediaType') || 'application/json'
  const headers = readEmitParamRows(src.headers)
  const query = readEmitParamRows(src.queryParams)
  const formParams = readEmitParamRows(src.formParams)
  const bodyVar = str(src, 'bodyVarName').trim()

  const lines: string[] = []
  const urlExpr = /^[A-Za-z_][A-Za-z0-9_]*$/.test(apiUrlRaw)
    ? apiUrlRaw
    : apiUrlRaw.includes('{')
      ? `\`${apiUrlRaw.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, '${$1}')}\``
      : JSON.stringify(apiUrlRaw)

  // IIFE keeps temps private; response vars are assigned in outer scope
  if (opts.awaitResult) {
    const bodyVarName = safeIdent(
      str(src, 'responseBodyVarName') || str(data, 'varName') || 'responseBody',
      'responseBody',
    )
    const bodyType = str(src, 'responseBodyType') || 'string'
    const headerVar = str(src, 'responseHeaderVarName').trim()
    const statusVar = str(src, 'statusCodeVarName').trim()
    const hv = headerVar ? safeIdent(headerVar, 'responseHeaders') : ''
    const sv = statusVar ? safeIdent(statusVar, 'statusCode') : ''

    lines.push(`${pad}let ${bodyVarName}: any;`)
    if (hv) lines.push(`${pad}let ${hv}: Record<string, string>;`)
    if (sv) lines.push(`${pad}let ${sv}: number;`)
    lines.push(`${pad}{`)
    lines.push(`${pad}  const __netUrl = new URL(String(${urlExpr}));`)
    for (const row of query) {
      lines.push(
        `${pad}  __netUrl.searchParams.set(${JSON.stringify(row.name)}, String(${emitParamValueExpr(row)}));`,
      )
    }
    lines.push(`${pad}  const __netHeaders: Record<string, string> = {};`)
    for (const row of headers) {
      lines.push(
        `${pad}  __netHeaders[${JSON.stringify(row.name)}] = String(${emitParamValueExpr(row)});`,
      )
    }
    if (!headers.some((h) => h.name.toLowerCase() === 'content-type')) {
      lines.push(
        `${pad}  __netHeaders['Content-Type'] = ${JSON.stringify(mediaType)};`,
      )
    }
    if (mediaType === 'application/x-www-form-urlencoded') {
      lines.push(`${pad}  const __netBodyParams = new URLSearchParams();`)
      for (const row of formParams) {
        lines.push(
          `${pad}  __netBodyParams.set(${JSON.stringify(row.name)}, String(${emitParamValueExpr(row)}));`,
        )
      }
      lines.push(`${pad}  const __netBody = __netBodyParams.toString();`)
    } else if (bodyVar) {
      const bodyIdent = safeIdent(bodyVar, 'body')
      lines.push(
        `${pad}  const __netBody = typeof ${bodyIdent} === 'string' ? ${bodyIdent} : JSON.stringify(${bodyIdent} ?? null);`,
      )
    } else {
      lines.push(`${pad}  const __netBody = undefined as string | undefined;`)
    }
    lines.push(
      `${pad}  const __netRes = await fetch(__netUrl, { method: ${JSON.stringify(method)}, headers: __netHeaders, body: ${
        method === 'GET' || method === 'HEAD' ? 'undefined' : '__netBody'
      } });`,
    )
    lines.push(`${pad}  const __netText = await __netRes.text();`)
    if (bodyType === 'json') {
      lines.push(
        `${pad}  try { ${bodyVarName} = JSON.parse(__netText || 'null'); } catch { ${bodyVarName} = __netText; }`,
      )
    } else {
      lines.push(`${pad}  ${bodyVarName} = __netText;`)
    }
    if (hv) {
      lines.push(
        `${pad}  ${hv} = {};`,
        `${pad}  __netRes.headers.forEach((v, k) => { ${hv}[k] = v; });`,
      )
    }
    if (sv) {
      lines.push(`${pad}  ${sv} = __netRes.status;`)
    }
    lines.push(`${pad}}`)
  } else {
    lines.push(`${pad}{`)
    lines.push(`${pad}  const __netUrl = new URL(String(${urlExpr}));`)
    for (const row of query) {
      lines.push(
        `${pad}  __netUrl.searchParams.set(${JSON.stringify(row.name)}, String(${emitParamValueExpr(row)}));`,
      )
    }
    lines.push(`${pad}  const __netHeaders: Record<string, string> = {};`)
    for (const row of headers) {
      lines.push(
        `${pad}  __netHeaders[${JSON.stringify(row.name)}] = String(${emitParamValueExpr(row)});`,
      )
    }
    if (!headers.some((h) => h.name.toLowerCase() === 'content-type')) {
      lines.push(
        `${pad}  __netHeaders['Content-Type'] = ${JSON.stringify(mediaType)};`,
      )
    }
    if (mediaType === 'application/x-www-form-urlencoded') {
      lines.push(`${pad}  const __netBodyParams = new URLSearchParams();`)
      for (const row of formParams) {
        lines.push(
          `${pad}  __netBodyParams.set(${JSON.stringify(row.name)}, String(${emitParamValueExpr(row)}));`,
        )
      }
      lines.push(`${pad}  const __netBody = __netBodyParams.toString();`)
    } else if (bodyVar) {
      const bodyIdent = safeIdent(bodyVar, 'body')
      lines.push(
        `${pad}  const __netBody = typeof ${bodyIdent} === 'string' ? ${bodyIdent} : JSON.stringify(${bodyIdent} ?? null);`,
      )
    } else {
      lines.push(`${pad}  const __netBody = undefined as string | undefined;`)
    }
    lines.push(
      `${pad}  void fetch(__netUrl, { method: ${JSON.stringify(method)}, headers: __netHeaders, body: ${
        method === 'GET' || method === 'HEAD' ? 'undefined' : '__netBody'
      } });`,
    )
    lines.push(`${pad}}`)
  }
  return `${lines.join('\n')}\n`
}

function emitNodeBlock(
  flow: MethodFlow,
  nodeId: string | null,
  ctx: FlowEmitContext,
  level: number,
  stack: Set<string>,
): string {
  if (!nodeId) return `${indent(level)}return undefined\n`
  if (stack.has(nodeId)) {
    return `${indent(level)}throw new Error(${JSON.stringify(`流程循环：${nodeId}`)})\n`
  }
  const node = flow.nodes.find((n) => n.id === nodeId)
  if (!node) return `${indent(level)}return undefined\n`

  const nextStack = new Set(stack)
  nextStack.add(nodeId)
  const data = asRecord(node.data)
  const pad = indent(level)

  const comment = emitDescriptionComment(pad, data)
  const emitNext = () =>
    emitNodeBlock(
      flow,
      pickDefaultNext(flow, node.id),
      ctx,
      level,
      nextStack,
    )

  if (node.kind === 'start') {
    return emitNext()
  }

  if (node.kind === 'end') {
    const returnExpr = str(data, 'returnExpr').trim()
    const fallback = defaultEmptyReturnCode(ctx.methodOutput)
    const expr = returnExpr || fallback
    // 数据层实体与 types 接口同名时结构常不一致（可空等），按方法出参断言
    const retTs = processorTypeExprToTs(ctx.methodOutput, ctx.idToName)
    const cast =
      retTs && retTs !== 'any' && retTs !== 'void'
        ? ` as unknown as ${retTs}`
        : ''
    return joinNodeCode(`${comment}${pad}return ${expr}${cast};\n`, '')
  }

  if (node.kind === 'throw') {
    const messageExpr = str(data, 'messageExpr').trim() || "'业务异常'"
    return joinNodeCode(
      `${comment}${pad}throw Object.assign(new Error(String(${messageExpr})), { statusCode: 400 })\n`,
      '',
    )
  }

  if (node.kind === 'define') {
    const varName = safeIdent(str(data, 'varName'), 'v')
    const initExpr = str(data, 'initExpr').trim()
    let line: string
    if (initExpr) {
      const normalized = initExpr
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((l, i) => (i === 0 ? l : `${pad}${l}`))
        .join('\n')
      line = `${pad}let ${varName}: any = ${normalized};\n`
    } else {
      line = `${pad}let ${varName}: any = null;\n`
    }
    return joinNodeCode(`${comment}${line}`, emitNext())
  }

  if (node.kind === 'input') {
    if (str(data, 'channel') === 'network') {
      return joinNodeCode(
        `${comment}${emitNetworkHttpBlock(pad, data, { awaitResult: true })}`,
        emitNext(),
      )
    }
    const varName = safeIdent(str(data, 'varName'), 'v')
    const dataSource = str(data, 'dataSource') || 'data'
    const bindingsRaw = asRecord(data.paramBindings)
    const bindings: Record<string, string> = {}
    for (const [k, v] of Object.entries(bindingsRaw)) {
      if (typeof v === 'string') bindings[k] = v
    }
    let assign: string
    if (dataSource === 'request_header') {
      assign = `${pad}const ${varName} = '';\n`
    } else {
      const processorId = str(data, 'dataProcessorId')
      const methodId = str(data, 'dataMethodId')
      const targetServiceId = str(data, 'serviceId')
      const call = emitMethodCall(ctx, processorId, methodId, bindings, {
        serviceId: targetServiceId,
      })
      assign = `${pad}const ${varName} = ${call};\n`
    }
    return joinNodeCode(`${comment}${assign}`, emitNext())
  }

  if (node.kind === 'output') {
    if (str(data, 'channel') === 'network') {
      return joinNodeCode(
        `${comment}${emitNetworkHttpBlock(pad, data, { awaitResult: false })}`,
        emitNext(),
      )
    }
    const processorId = str(data, 'dataProcessorId')
    const methodId = str(data, 'dataMethodId')
    const bindingsRaw = asRecord(data.paramBindings)
    const bindings: Record<string, string> = {}
    for (const [k, v] of Object.entries(bindingsRaw)) {
      if (typeof v === 'string') bindings[k] = v
    }
    const resultVar = safeIdent(
      str(data, 'resultVarName') || '_writeResult',
      '_writeResult',
    )
    const call = emitMethodCall(ctx, processorId, methodId, bindings)
    return joinNodeCode(
      `${comment}${pad}const ${resultVar} = ${call};\n`,
      emitNext(),
    )
  }

  if (node.kind === 'pageMap') {
    const sourceKind = str(data, 'sourceKind') === 'array' ? 'array' : 'page'
    const sourcePath = str(data, 'sourcePath').trim()
    const targetVarName = safeIdent(
      str(data, 'targetVarName') || str(data, 'targetPath'),
      '_pageTarget',
    )
    const mappings = readPageMapFieldMappings(data.fieldMappings)
    const metaKeys = PAGE_META_FIELDS.map((k) => JSON.stringify(k)).join(', ')

    let block =
      `${pad}let ${targetVarName}: any;\n` +
      `${pad}{\n` +
      `${pad}  const _pageOut: Record<string, unknown> = {};\n`

    if (sourceKind === 'page') {
      block +=
        `${pad}  const _srcPage = ${sourcePath || 'undefined'};\n` +
        `${pad}  if (_srcPage && typeof _srcPage === 'object') {\n` +
        `${pad}    for (const _k of [${metaKeys}] as const) {\n` +
        `${pad}      if (_k in (_srcPage as object)) _pageOut[_k] = (_srcPage as unknown as Record<string, unknown>)[_k];\n` +
        `${pad}    }\n` +
        `${pad}  }\n` +
        `${pad}  const _srcRecords = Array.isArray((_srcPage as unknown as Record<string, unknown>)?.${PAGE_RECORDS_FIELD}) ? ((_srcPage as unknown as Record<string, unknown>).${PAGE_RECORDS_FIELD} as unknown[]) : [];\n`
    } else {
      const currentExpr = str(data, 'currentExpr').trim() || 'undefined'
      const pageSizeExpr = str(data, 'pageSizeExpr').trim() || 'undefined'
      const totalExpr = str(data, 'totalExpr').trim() || 'undefined'
      const hasNextExpr = str(data, 'hasNextExpr').trim()
      block +=
        `${pad}  const _srcRecords = Array.isArray(${sourcePath || 'undefined'}) ? (${sourcePath || 'undefined'} as unknown[]) : [];\n` +
        `${pad}  _pageOut.current = ${currentExpr};\n` +
        `${pad}  _pageOut.pageSize = ${pageSizeExpr};\n` +
        `${pad}  _pageOut.total = ${totalExpr};\n`
      if (hasNextExpr) {
        block += `${pad}  _pageOut.hasNext = ${hasNextExpr};\n`
      } else {
        block +=
          `${pad}  {\n` +
          `${pad}    const _cur = Number(_pageOut.current);\n` +
          `${pad}    const _ps = Number(_pageOut.pageSize);\n` +
          `${pad}    const _tot = Number(_pageOut.total);\n` +
          `${pad}    if (!Number.isNaN(_cur) && !Number.isNaN(_ps) && !Number.isNaN(_tot)) {\n` +
          `${pad}      _pageOut.hasNext = _cur * _ps < _tot;\n` +
          `${pad}    }\n` +
          `${pad}  }\n`
      }
    }

    const mappingEntries = mappings
      .map((m) => {
        const targetField = m.targetField.trim()
        const sourceField = m.sourceField.trim()
        if (!targetField || !sourceField) return ''
        if (targetField === sourceField) {
          return JSON.stringify(targetField)
        }
        return `[${JSON.stringify(targetField)}, ${JSON.stringify(sourceField)}]`
      })
      .filter(Boolean)
      .join(`,\n${pad}    `)
    block +=
      `${pad}  _pageOut.${PAGE_RECORDS_FIELD} = _srcRecords.map((_item) =>\n` +
      `${pad}    mapObjectFields(_item, [\n` +
      `${pad}    ${mappingEntries}\n` +
      `${pad}    ]),\n` +
      `${pad}  );\n` +
      `${pad}  ${targetVarName} = _pageOut;\n` +
      `${pad}}\n`
    return joinNodeCode(`${comment}${block}`, emitNext())
  }

  if (node.kind === 'objectMap') {
    const sourcePath = str(data, 'sourcePath').trim()
    const targetVarName = safeIdent(
      str(data, 'targetVarName') || str(data, 'targetPath'),
      '_objectTarget',
    )
    const mappings = readObjectMapFieldMappings(data.fieldMappings)
    const mappingEntries = mappings
      .map((m) => {
        const targetField = m.targetField.trim()
        const sourceField = m.sourceField.trim()
        if (!targetField || !sourceField) return ''
        if (targetField === sourceField) {
          return JSON.stringify(targetField)
        }
        return `[${JSON.stringify(targetField)}, ${JSON.stringify(sourceField)}]`
      })
      .filter(Boolean)
      .join(`,\n${pad}  `)
    const block =
      `${pad}let ${targetVarName}: any = mapObjectFields(${sourcePath || 'undefined'}, [\n` +
      `${pad}  ${mappingEntries}\n` +
      `${pad}]);\n`
    return joinNodeCode(`${comment}${block}`, emitNext())
  }

  if (node.kind === 'action') {
    const code = str(data, 'code').trim()
    const outputVarRaw = str(data, 'outputVarName').trim()
    const outputVar = outputVarRaw ? safeIdent(outputVarRaw, 'v') : ''
    let block = ''
    if (code) {
      // 与调试运行时一致：action 内 return 是节点出参，不能泄漏成方法 return
      // 前导分号避免上一行无分号时与 IIFE 发生 ASI 粘连
      const inner = code
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((l) => `${pad}  ${l}`)
        .join('\n')
      if (outputVar) {
        block =
          `${pad}const ${outputVar}: any = (() => {\n` +
          `${inner}\n` +
          `${pad}})();\n`
      } else {
        block = `${pad};(() => {\n${inner}\n${pad}})();\n`
      }
    } else if (outputVar) {
      block = `${pad}const ${outputVar}: any = undefined;\n`
    }
    return joinNodeCode(`${comment}${block}`, emitNext())
  }

  if (node.kind === 'branch') {
    const expression = str(data, 'expression').trim() || 'false'
    const trueNext = pickBranchNext(flow, node.id, 'true')
    const falseNext = pickBranchNext(flow, node.id, 'false')
    const block =
      `${pad}if (${expression}) {\n` +
      emitNodeBlock(flow, trueNext, ctx, level + 1, nextStack) +
      `${pad}} else {\n` +
      emitNodeBlock(flow, falseNext, ctx, level + 1, nextStack) +
      `${pad}}\n`
    return joinNodeCode(`${comment}${block}`, '')
  }

  return emitNext()
}

/** 工作流是否需要 mapObjectFields（objectMap / pageMap 记录映射） */
export function collectFlowUsesObjectMap(
  flows: Array<MethodFlow | null | undefined>,
): boolean {
  for (const flow of flows) {
    for (const node of flow?.nodes ?? []) {
      if (node.kind === 'objectMap') return true
      if (node.kind === 'pageMap') {
        const mappings = readPageMapFieldMappings(
          (node.data as Record<string, unknown> | undefined)?.fieldMappings,
        )
        if (mappings.some((m) => m.targetField.trim() && m.sourceField.trim())) {
          return true
        }
      }
    }
  }
  return false
}

export function emitFlowMethodBody(
  flow: MethodFlow | null | undefined,
  ctx: FlowEmitContext,
  level = 2,
): string {
  if (!flow?.nodes?.length) {
    return `${indent(level)}return undefined\n`
  }
  const start = findStart(flow)
  if (!start) {
    return `${indent(level)}throw new Error('工作流缺少开始节点')\n`
  }
  return emitNodeBlock(flow, start.id, ctx, level, new Set())
}

export function emitMethodSignature(
  method: ProcessorMethod,
  idToName: IdToName,
): { params: string; returnType: string } {
  const params = (method.params ?? [])
    .map((p) => {
      const name = safeIdent(p.name, 'param')
      const ty = processorTypeExprToTs(p.typeExpr, idToName)
      return `${name}: ${ty}`
    })
    .join(', ')
  const returnType = processorTypeExprToTs(method.output, idToName)
  return { params, returnType }
}

export function buildMethodIndex(
  dataProcessors: ServiceProcessor[],
  businessProcessors: ServiceProcessor[],
): Map<string, { processorId: string; method: ProcessorMethod }> {
  const map = new Map<
    string,
    { processorId: string; method: ProcessorMethod }
  >()
  for (const p of [...dataProcessors, ...businessProcessors]) {
    for (const m of p.methods ?? []) {
      map.set(m.id, { processorId: p.id, method: m })
    }
  }
  return map
}

export function buildProcessorMaps(
  dataProcessors: ServiceProcessor[],
  businessProcessors: ServiceProcessor[],
): {
  processorSlugById: Map<string, string>
  processorLayerById: Map<string, 'data' | 'business'>
} {
  const processorSlugById = new Map<string, string>()
  const processorLayerById = new Map<string, 'data' | 'business'>()
  for (const p of dataProcessors) {
    processorSlugById.set(p.id, slugify(p.name || p.id, 'resource'))
    processorLayerById.set(p.id, 'data')
  }
  for (const p of businessProcessors) {
    processorSlugById.set(p.id, slugify(p.name || p.id, 'resource'))
    processorLayerById.set(p.id, 'business')
  }
  return { processorSlugById, processorLayerById }
}
