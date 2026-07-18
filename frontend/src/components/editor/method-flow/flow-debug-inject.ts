import type { InjectionKey, Ref } from 'vue'

export type FlowDebugInject = {
  cursorId: Ref<string | null | undefined>
  visitedIds: Ref<string[] | undefined>
}

export const FLOW_DEBUG_KEY: InjectionKey<FlowDebugInject> = Symbol('method-flow-debug')
