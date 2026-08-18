import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useFlowDebugNode } from '../use-flow-debug-node'
import FlowNodePrintBubble from '../FlowNodePrintBubble'
import './StartNode.css'

export default function StartNode({ id }: NodeProps) {
  const { debugClass } = useFlowDebugNode(id)

  return (
    <div className={`flow-node start-node ${debugClass}`}>
      <div className="flow-node-title">开始</div>
      <Handle id="default" type="source" position={Position.Bottom} />
      <FlowNodePrintBubble nodeId={id} />
    </div>
  )
}
