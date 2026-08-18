import { useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useFlowDebugNode } from '../use-flow-debug-node'
import FlowNodePrintBubble from '../FlowNodePrintBubble'
import './InputNode.css'

export default function InputNode({ id, data }: NodeProps) {
  const { debugClass } = useFlowDebugNode(id)

  const summary = useMemo(() => {
    const rec = (data ?? {}) as Record<string, unknown>
    const channel = rec.channel === 'network' ? 'network' : 'local'
    if (channel === 'network') {
      const network =
        rec.network && typeof rec.network === 'object'
          ? (rec.network as Record<string, unknown>)
          : rec
      const method =
        typeof network.httpMethod === 'string' ? network.httpMethod : 'GET'
      const url =
        typeof network.apiUrl === 'string' ? network.apiUrl.trim() : ''
      const bodyVar =
        typeof network.responseBodyVarName === 'string'
          ? network.responseBodyVarName.trim()
          : typeof rec.varName === 'string'
            ? rec.varName.trim()
            : ''
      const label = `${method} ${url || '(未填地址)'}`
      return bodyVar ? `${bodyVar} ← ${label}` : label
    }
    const varName = typeof rec.varName === 'string' ? rec.varName.trim() : ''
    const methodLabel =
      typeof rec.methodLabel === 'string' ? rec.methodLabel.trim() : ''
    if (varName && methodLabel) return `${varName} ← ${methodLabel}`
    if (varName) return varName
    if (methodLabel) return methodLabel
    return '未配置'
  }, [data])

  return (
    <div className={`io-wrap ${debugClass}`}>
      <Handle id="default" type="target" position={Position.Top} />
      <div className="io-shape input-node">
        <div className="io-content">
          <div className="flow-node-kind">输入</div>
          <div className="flow-node-summary" title={summary}>
            {summary}
          </div>
        </div>
      </div>
      <Handle id="default" type="source" position={Position.Bottom} />
      <FlowNodePrintBubble nodeId={id} />
    </div>
  )
}
