import { useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useFlowDebugNode } from '../use-flow-debug-node'
import FlowNodePrintBubble from '../FlowNodePrintBubble'
import './ActionNode.css'

export default function ActionNode({ id, data }: NodeProps) {
  const { debugClass } = useFlowDebugNode(id)

  const summary = useMemo(() => {
    const rec = (data ?? {}) as Record<string, unknown>
    const description =
      typeof rec.description === 'string' ? rec.description.trim() : ''
    if (description) return description

    const outputVar =
      typeof rec.outputVarName === 'string' ? rec.outputVarName.trim() : ''
    if (outputVar) return `→ ${outputVar}`

    const code = typeof rec.code === 'string' ? rec.code.trim() : ''
    if (!code) return '未编写代码'
    const first = code.split(/\r?\n/).find((l) => l.trim()) ?? ''
    return first.length > 28 ? `${first.slice(0, 28)}…` : first
  }, [data])

  return (
    <div className={`flow-node action-node ${debugClass}`}>
      <Handle id="default" type="target" position={Position.Top} />
      <div className="flow-node-kind">操作</div>
      <div className="flow-node-summary" title={summary}>
        {summary}
      </div>
      <Handle id="default" type="source" position={Position.Bottom} />
      <FlowNodePrintBubble nodeId={id} />
    </div>
  )
}
