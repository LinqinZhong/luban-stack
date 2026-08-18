import { useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useFlowDebugNode } from '../use-flow-debug-node'
import FlowNodePrintBubble from '../FlowNodePrintBubble'
import './PageMapNode.css'

export default function PageMapNode({ id, data }: NodeProps) {
  const { debugClass } = useFlowDebugNode(id)

  const summary = useMemo(() => {
    const rec = (data ?? {}) as Record<string, unknown>
    const description =
      typeof rec.description === 'string' ? rec.description.trim() : ''
    if (description) return description
    const sourceKind = rec.sourceKind === 'array' ? 'array' : 'page'
    const kindLabel = sourceKind === 'array' ? '[]' : '分页'
    const sourcePath =
      typeof rec.sourcePath === 'string' ? rec.sourcePath.trim() : ''
    const targetVarName =
      (typeof rec.targetVarName === 'string' ? rec.targetVarName.trim() : '') ||
      (typeof rec.targetPath === 'string' ? rec.targetPath.trim() : '')
    if (sourcePath && targetVarName) {
      return `${kindLabel} · ${sourcePath} → ${targetVarName}`
    }
    if (sourcePath) return `${kindLabel} · 源：${sourcePath}`
    if (targetVarName) return `目标：${targetVarName}`
    return '未配置分页映射'
  }, [data])

  return (
    <div className={`flow-node page-map-node ${debugClass}`}>
      <Handle id="default" type="target" position={Position.Top} />
      <div className="flow-node-kind">分页映射</div>
      <div className="flow-node-summary" title={summary}>
        {summary}
      </div>
      <Handle id="default" type="source" position={Position.Bottom} />
      <FlowNodePrintBubble nodeId={id} />
    </div>
  )
}
