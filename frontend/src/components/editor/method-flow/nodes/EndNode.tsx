import { useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useFlowDebugNode } from '../use-flow-debug-node'
import FlowNodePrintBubble from '../FlowNodePrintBubble'
import './EndNode.css'

export default function EndNode({ id, data }: NodeProps) {
  const { debugClass } = useFlowDebugNode(id)

  const returnExpr = useMemo(() => {
    const rec = (data ?? {}) as Record<string, unknown>
    return typeof rec.returnExpr === 'string' ? rec.returnExpr.trim() : ''
  }, [data])

  const needsReturn = Boolean((data as Record<string, unknown> | undefined)?.needsReturn)

  return (
    <div
      className={`flow-node end-node${needsReturn ? ' has-return' : ''} ${debugClass}`}
    >
      <Handle id="default" type="target" position={Position.Top} />
      <div className="flow-node-title">终止</div>
      {needsReturn ? (
        <div
          className="flow-node-summary"
          title={returnExpr || '空值（按出参类型）'}
        >
          {returnExpr || '空值'}
        </div>
      ) : null}
      <FlowNodePrintBubble nodeId={id} />
    </div>
  )
}
