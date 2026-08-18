import {
  getBackendServiceLibrary,
  getServiceControllers,
  getServiceProcessors,
} from '../api/projects'
import type { FlowNode, ServiceProcessor } from '../types/backend-services'

export type DataMethodUsageLayer = 'business' | 'controller'

export type DataMethodUsageRef = {
  serviceId: string
  serviceName: string
  layer: DataMethodUsageLayer
  /** 业务处理器 id 或控制器 id */
  ownerId: string
  ownerName: string
  /** 业务方法 id 或 API id */
  methodId: string
  methodName: string
  nodeId: string
  nodeKind: string
  nodeLabel: string
}

function nodeUsesDataMethod(
  node: FlowNode,
  options: {
    /** 当前流所在服务 */
    callerServiceId: string
    /** 被查数据方法所在服务 */
    dataServiceId: string
    dataProcessorId: string
    dataMethodId: string
  },
): boolean {
  return matchedDataMethodId(node, options) === options.dataMethodId
}

/** 若节点调用了指定数据处理器下的方法，返回 methodId，否则 null */
function matchedDataMethodId(
  node: FlowNode,
  options: {
    callerServiceId: string
    dataServiceId: string
    dataProcessorId: string
    dataMethodId?: string
  },
): string | null {
  const data = node.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const raw = data as Record<string, unknown>
  const kind = node.kind
  if (kind !== 'input' && kind !== 'output') return null

  const channel = typeof raw.channel === 'string' ? raw.channel.trim() : 'local'
  if (channel === 'network') return null

  if (kind === 'input') {
    const dataSource =
      typeof raw.dataSource === 'string' ? raw.dataSource.trim() : 'data'
    if (
      dataSource === 'business' ||
      dataSource === 'request_header' ||
      dataSource === 'current_business' ||
      dataSource === 'other_business'
    ) {
      return null
    }
  }

  const processorId =
    typeof raw.dataProcessorId === 'string' ? raw.dataProcessorId.trim() : ''
  const methodId =
    typeof raw.dataMethodId === 'string' ? raw.dataMethodId.trim() : ''
  if (processorId !== options.dataProcessorId || !methodId) return null
  if (options.dataMethodId && methodId !== options.dataMethodId) return null

  const nodeServiceId =
    typeof raw.serviceId === 'string' ? raw.serviceId.trim() : ''
  const effectiveService = nodeServiceId || options.callerServiceId
  if (effectiveService !== options.dataServiceId) return null
  return methodId
}

function nodeLabelOf(node: FlowNode): string {
  const data = node.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return node.kind
  }
  const raw = data as Record<string, unknown>
  const methodLabel =
    typeof raw.methodLabel === 'string' ? raw.methodLabel.trim() : ''
  if (methodLabel) return methodLabel
  const varName = typeof raw.varName === 'string' ? raw.varName.trim() : ''
  if (varName) return `${node.kind}:${varName}`
  return node.kind === 'input' ? '输入节点' : node.kind === 'output' ? '输出节点' : node.kind
}

function scanProcessorFlows(
  processors: ServiceProcessor[],
  meta: {
    callerServiceId: string
    callerServiceName: string
    dataServiceId: string
    layer: DataMethodUsageLayer
    dataProcessorId: string
    dataMethodId: string
  },
): DataMethodUsageRef[] {
  const refs: DataMethodUsageRef[] = []
  for (const proc of processors) {
    for (const method of proc.methods ?? []) {
      for (const node of method.flow?.nodes ?? []) {
        if (
          !nodeUsesDataMethod(node, {
            callerServiceId: meta.callerServiceId,
            dataServiceId: meta.dataServiceId,
            dataProcessorId: meta.dataProcessorId,
            dataMethodId: meta.dataMethodId,
          })
        ) {
          continue
        }
        refs.push({
          serviceId: meta.callerServiceId,
          serviceName: meta.callerServiceName,
          layer: meta.layer,
          ownerId: proc.id,
          ownerName: proc.name || proc.id,
          methodId: method.id,
          methodName: method.name || method.id,
          nodeId: node.id,
          nodeKind: node.kind,
          nodeLabel: nodeLabelOf(node),
        })
      }
    }
  }
  return refs
}

/**
 * 查找引用指定数据层方法的业务流 / 控制器 API 流节点。
 */
export async function findDataMethodUsage(options: {
  projectPath: string
  /** 被引用的数据方法所在服务 */
  serviceId: string
  dataProcessorId: string
  dataMethodId: string
}): Promise<DataMethodUsageRef[]> {
  const projectPath = options.projectPath.trim()
  const dataServiceId = options.serviceId.trim()
  const dataProcessorId = options.dataProcessorId.trim()
  const dataMethodId = options.dataMethodId.trim()
  if (!projectPath || !dataServiceId || !dataProcessorId || !dataMethodId) {
    return []
  }

  const lib = await getBackendServiceLibrary(projectPath)
  const refs: DataMethodUsageRef[] = []

  for (const service of lib.services ?? []) {
    const callerServiceId = service.id
    const callerServiceName = service.name || callerServiceId
    const [bizRes, ctrlRes] = await Promise.all([
      getServiceProcessors(projectPath, callerServiceId, 'business'),
      getServiceControllers(projectPath, callerServiceId),
    ])

    refs.push(
      ...scanProcessorFlows(bizRes.processors ?? [], {
        callerServiceId,
        callerServiceName,
        dataServiceId,
        layer: 'business',
        dataProcessorId,
        dataMethodId,
      }),
    )

    for (const ctrl of ctrlRes.controllers ?? []) {
      for (const api of ctrl.apis ?? []) {
        for (const node of api.flow?.nodes ?? []) {
          if (
            !nodeUsesDataMethod(node, {
              callerServiceId,
              dataServiceId,
              dataProcessorId,
              dataMethodId,
            })
          ) {
            continue
          }
          refs.push({
            serviceId: callerServiceId,
            serviceName: callerServiceName,
            layer: 'controller',
            ownerId: ctrl.id,
            ownerName: ctrl.name || ctrl.id,
            methodId: api.id,
            methodName: api.name || api.id,
            nodeId: node.id,
            nodeKind: node.kind,
            nodeLabel: nodeLabelOf(node),
          })
        }
      }
    }
  }

  return refs
}

/**
 * 一次扫描：统计某数据处理器下各方法被引用次数（methodId → count）
 */
export async function countDataMethodUsages(options: {
  projectPath: string
  serviceId: string
  dataProcessorId: string
}): Promise<Record<string, number>> {
  const projectPath = options.projectPath.trim()
  const dataServiceId = options.serviceId.trim()
  const dataProcessorId = options.dataProcessorId.trim()
  const counts: Record<string, number> = {}
  if (!projectPath || !dataServiceId || !dataProcessorId) return counts

  const lib = await getBackendServiceLibrary(projectPath)
  for (const service of lib.services ?? []) {
    const callerServiceId = service.id
    const [bizRes, ctrlRes] = await Promise.all([
      getServiceProcessors(projectPath, callerServiceId, 'business'),
      getServiceControllers(projectPath, callerServiceId),
    ])

    for (const proc of bizRes.processors ?? []) {
      for (const method of proc.methods ?? []) {
        for (const node of method.flow?.nodes ?? []) {
          const mid = matchedDataMethodId(node, {
            callerServiceId,
            dataServiceId,
            dataProcessorId,
          })
          if (!mid) continue
          counts[mid] = (counts[mid] ?? 0) + 1
        }
      }
    }

    for (const ctrl of ctrlRes.controllers ?? []) {
      for (const api of ctrl.apis ?? []) {
        for (const node of api.flow?.nodes ?? []) {
          const mid = matchedDataMethodId(node, {
            callerServiceId,
            dataServiceId,
            dataProcessorId,
          })
          if (!mid) continue
          counts[mid] = (counts[mid] ?? 0) + 1
        }
      }
    }
  }

  return counts
}

export function formatDataMethodUsagePath(ref: DataMethodUsageRef): string {
  const layerLabel = ref.layer === 'business' ? '业务层' : '控制器'
  return `${ref.serviceName} / ${layerLabel} / ${ref.ownerName}.${ref.methodName} / ${ref.nodeLabel}`
}
