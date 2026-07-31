import type {
  MethodFlow,
  ProcessorMethod,
  ProcessorTypeExpr,
  ServiceProcessor,
} from '../types/backend-services'
import { createDefaultMethodFlow } from '../types/backend-services'

/** 从 API flow 中解析「直接绑定」的业务方法（取第一条 business 输入节点） */
export type ApiBusinessBinding = {
  serviceId: string
  processorId: string
  methodId: string
  methodLabel: string
  varName: string
  paramBindings: Record<string, string>
  outputTypeExpr: ProcessorTypeExpr | null
}

export function extractApiBusinessBinding(
  flow: MethodFlow | null | undefined,
): ApiBusinessBinding | null {
  const nodes = flow?.nodes ?? []
  const input = nodes.find((n) => {
    if (n.kind !== 'input') return false
    const d = n.data as Record<string, unknown>
    const src = typeof d.dataSource === 'string' ? d.dataSource : ''
    return (
      src === 'business' ||
      src === 'current_business' ||
      src === 'other_business'
    )
  })
  if (!input) return null
  const d = input.data as Record<string, unknown>
  const processorId =
    typeof d.dataProcessorId === 'string' ? d.dataProcessorId.trim() : ''
  const methodId =
    typeof d.dataMethodId === 'string' ? d.dataMethodId.trim() : ''
  if (!processorId || !methodId) return null
  const rawBindings =
    d.paramBindings && typeof d.paramBindings === 'object' && !Array.isArray(d.paramBindings)
      ? (d.paramBindings as Record<string, unknown>)
      : {}
  const paramBindings: Record<string, string> = {}
  for (const [k, v] of Object.entries(rawBindings)) {
    if (!k.trim()) continue
    paramBindings[k] = typeof v === 'string' ? v : String(v ?? '')
  }
  const outputTypeExpr =
    d.outputTypeExpr && typeof d.outputTypeExpr === 'object'
      ? (d.outputTypeExpr as ProcessorTypeExpr)
      : null
  return {
    serviceId: typeof d.serviceId === 'string' ? d.serviceId.trim() : '',
    processorId,
    methodId,
    methodLabel: typeof d.methodLabel === 'string' ? d.methodLabel : '',
    varName:
      typeof d.varName === 'string' && d.varName.trim()
        ? d.varName.trim()
        : 'result',
    paramBindings,
    outputTypeExpr,
  }
}

/** 组装控制器 API 的标准 flow：开始 → 业务方法 → 终止 */
export function buildApiBusinessFlow(options: {
  serviceId: string
  processorId: string
  methodId: string
  methodLabel: string
  varName?: string
  paramBindings: Record<string, string>
  outputTypeExpr?: ProcessorTypeExpr | null
}): MethodFlow {
  const varName = options.varName?.trim() || 'result'
  const inputId = 'input_api_biz'
  const endId = 'end_api_biz'
  return {
    nodes: [
      {
        id: 'start',
        kind: 'start',
        position: { x: 280, y: 40 },
        data: {},
      },
      {
        id: inputId,
        kind: 'input',
        position: { x: 245, y: 160 },
        data: {
          serviceId: options.serviceId,
          dataSource: 'business',
          dataProcessorId: options.processorId,
          dataMethodId: options.methodId,
          headerField: '',
          varName,
          methodLabel: options.methodLabel,
          paramBindings: { ...options.paramBindings },
          printExpr: '',
          outputTypeExpr: options.outputTypeExpr ?? null,
        },
      },
      {
        id: endId,
        kind: 'end',
        position: { x: 277, y: 300 },
        data: {
          returnExpr: varName,
          printExpr: '',
        },
      },
    ],
    edges: [
      { id: 'edge_api_biz_1', source: 'start', target: inputId },
      { id: 'edge_api_biz_2', source: inputId, target: endId },
    ],
  }
}

/** 按方法入参名 → 同名 API 变量生成绑定；无同名则用空串 */
export function buildParamBindingsFromMethod(
  method: ProcessorMethod | null | undefined,
  apiInputNames: string[],
): Record<string, string> {
  const names = new Set(apiInputNames.map((n) => n.trim()).filter(Boolean))
  const out: Record<string, string> = {}
  for (const p of method?.params ?? []) {
    const name = p.name.trim()
    if (!name) continue
    out[name] = names.has(name) ? name : ''
  }
  return out
}

export function findProcessorMethod(
  processors: ServiceProcessor[],
  processorId: string,
  methodId: string,
): { processor: ServiceProcessor; method: ProcessorMethod } | null {
  const processor = processors.find((p) => p.id === processorId)
  if (!processor) return null
  const method = processor.methods.find((m) => m.id === methodId)
  if (!method) return null
  return { processor, method }
}

export function emptyApiFlow(): MethodFlow {
  return createDefaultMethodFlow()
}
