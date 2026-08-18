import { useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useFlowDebugNode } from '../use-flow-debug-node'
import FlowNodePrintBubble from '../FlowNodePrintBubble'
import './DefineNode.css'

export default function DefineNode({ id, data }: NodeProps) {
  const { debugClass } = useFlowDebugNode(id)

  const summary = useMemo(() => {
    const rec = (data ?? {}) as Record<string, unknown>
    const description =
      typeof rec.description === 'string' ? rec.description.trim() : ''
    if (description) return description
    const varName = typeof rec.varName === 'string' ? rec.varName.trim() : ''
    const initExpr = typeof rec.initExpr === 'string' ? rec.initExpr.trim() : ''
    if (varName && initExpr) return `${varName} = ${initExpr}`
    if (varName) return varName
    return '未配置'
  }, [data])

  return (
    <div className={`flow-node define-node ${debugClass}`}>
      <Handle id="default" type="target" position={Position.Top} />
      <div className="flow-node-kind">定义数据</div>
      <div className="flow-node-summary" title={summary}>
        {summary}
      </div>
      <Handle id="default" type="source" position={Position.Bottom} />
      <FlowNodePrintBubble nodeId={id} />
    </div>
  )
}
