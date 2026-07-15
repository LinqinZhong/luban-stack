import { computed, ref, type ComputedRef, type InjectionKey, type Ref } from 'vue'

export interface MaskStackApi {
  /** 遮罩打开栈（栈顶为当前可见） */
  stack: Ref<string[]>
  top: ComputedRef<string | null>
  open: (name: string) => void
  /** 无参：关闭栈顶；有 name：弹出到该层（含自身） */
  close: (name?: string) => void
  closeAll: () => void
  isTop: (name: string) => boolean
}

export const MASK_STACK_KEY: InjectionKey<MaskStackApi> = Symbol('voiderMaskStack')
export const MASK_HOST_KEY: InjectionKey<Ref<HTMLElement | null>> = Symbol('voiderMaskHost')

/**
 * 页面级遮罩堆栈：同一时刻仅栈顶可见；
 * open 会将同名项移到栈顶（其余层暂隐，关闭时可恢复）。
 */
export function createMaskStack(): MaskStackApi {
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
