import { createContext, useContext, useMemo } from 'react'

export type FlowDebugInject = {
  cursorId: string | null | undefined
  visitedIds: string[] | undefined
  printByNode: Record<string, string> | undefined
}

export const FlowDebugContext = createContext<FlowDebugInject | null>(null)

export function useFlowDebug() {
  return useContext(FlowDebugContext)
}

export function useFlowDebugNode(nodeId: string) {
  const debug = useFlowDebug()
  return useMemo(() => {
    const isDebugCursor = Boolean(debug?.cursorId) && debug?.cursorId === nodeId
    const isDebugVisited = Boolean(debug?.visitedIds?.includes(nodeId))
    const debugClass = [
      'flow-debug-target',
      isDebugCursor ? 'is-debug-cursor' : '',
      isDebugVisited ? 'is-debug-visited' : '',
    ]
      .filter(Boolean)
      .join(' ')
    return { isDebugCursor, isDebugVisited, debugClass }
  }, [debug, nodeId])
}
