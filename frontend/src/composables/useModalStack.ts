import { computed, ref, type ComputedRef, type InjectionKey, type Ref } from 'vue'

export interface ModalStackApi {
  /** Modal 打开栈（栈顶为当前可见） */
  stack: Ref<string[]>
  top: ComputedRef<string | null>
  open: (name: string) => void
  /** 无参：关闭栈顶；有 name：弹出到该层（含自身） */
  close: (name?: string) => void
  closeAll: () => void
  isTop: (name: string) => boolean
}

export const MODAL_STACK_KEY: InjectionKey<ModalStackApi> = Symbol('voiderModalStack')
export const MODAL_HOST_KEY: InjectionKey<Ref<HTMLElement | null>> = Symbol('voiderModalHost')
/** 编辑态角标挂载层（需高于屏幕虚线框） */
export const BADGE_HOST_KEY: InjectionKey<Ref<HTMLElement | null>> = Symbol('voiderBadgeHost')
/** 编辑态测量模式：select 普通选中；measure 显示间距与尺寸 */
export type CanvasToolMode = 'select' | 'measure'
export const CANVAS_TOOL_MODE_KEY: InjectionKey<Ref<CanvasToolMode>> =
  Symbol('voiderCanvasToolMode')

/** 预览检视：纯净模式不显示组件操纵杆；组件模式显示 */
export type PreviewInspectMode = 'clean' | 'component'
export const PREVIEW_INSPECT_MODE_KEY: InjectionKey<Ref<PreviewInspectMode>> =
  Symbol('voiderPreviewInspectMode')

/** 预览检视：按 Component 节点 id 覆盖实例入参（调试面板修改，不要求「可更新」） */
export const PREVIEW_INSTANCE_PROP_OVERRIDES_KEY: InjectionKey<
  Ref<Record<string, Record<string, unknown>>>
> = Symbol('voiderPreviewInstancePropOverrides')

/**
 * 页面级 Modal 堆栈：同一时刻仅栈顶可见；
 * open 会将同名项移到栈顶（其余层暂隐，关闭时可恢复）。
 */
export function createModalStack(): ModalStackApi {
  const stack = ref<string[]>([])

  const top = computed(() => {
    const list = stack.value
    return list.length ? list[list.length - 1]! : null
  })

  function open(name: string) {
    const id = String(name ?? '').trim()
    if (!id) return
    stack.value = [...stack.value.filter((item) => item !== id), id]
  }

  function close(name?: string) {
    const id = name == null ? '' : String(name).trim()
    if (!id) {
      if (stack.value.length) {
        stack.value = stack.value.slice(0, -1)
      }
      return
    }
    const idx = stack.value.lastIndexOf(id)
    if (idx < 0) return
    stack.value = stack.value.slice(0, idx)
  }

  function closeAll() {
    stack.value = []
  }

  function isTop(name: string) {
    const id = String(name ?? '').trim()
    return Boolean(id) && top.value === id
  }

  return { stack, top, open, close, closeAll, isTop }
}
