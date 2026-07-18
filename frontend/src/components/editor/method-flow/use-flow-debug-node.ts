import { computed, inject } from 'vue'
import { FLOW_DEBUG_KEY } from './flow-debug-inject'

export function useFlowDebugNode(nodeId: string) {
  const debug = inject(FLOW_DEBUG_KEY, null)
  const isDebugCursor = computed(
    () => Boolean(debug?.cursorId.value) && debug?.cursorId.value === nodeId,
  )
  const isDebugVisited = computed(
    () => Boolean(debug?.visitedIds.value?.includes(nodeId)),
  )
  const debugClass = computed(() => ({
    'flow-debug-target': true,
    'is-debug-cursor': isDebugCursor.value,
    'is-debug-visited': isDebugVisited.value,
  }))
  return { isDebugCursor, isDebugVisited, debugClass }
}
