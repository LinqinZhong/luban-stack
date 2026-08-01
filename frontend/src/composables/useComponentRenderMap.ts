import type { ComputedRef, InjectionKey, Ref } from 'vue'
import type { ComponentRenderMap } from '../types/component-render'
import type { PageData } from '../types/page-data'

/**
 * 画布组件渲染表：用 provide/inject 下发，避免作为 prop 层层传递。
 * 否则任意组件 setData 换 map 引用时，整棵 XmlNodeView 都会因 prop 变化重渲染。
 */
export const COMPONENT_RENDER_MAP_KEY: InjectionKey<
  Ref<ComponentRenderMap | undefined>
> = Symbol('voiderComponentRenderMap')

/**
 * 当前组件实例的 live 数据池（setData 写入处）。
 * vIf/vShow 求值走这里，避免实例快照未刷新时条件仍为旧值。
 */
export const COMPONENT_LIVE_PAGE_DATA_KEY: InjectionKey<
  ComputedRef<PageData | undefined>
> = Symbol('voiderComponentLivePageData')

/**
 * 当前组件实例的 live `$props`（随宿主 `{field}` 绑定刷新）。
 * 定义树内 vIf/vShow 读这里，避免 prop 透传的 $props 对象引用卡住。
 */
export const COMPONENT_LIVE_DOLLAR_PROPS_KEY: InjectionKey<
  ComputedRef<Record<string, unknown> | undefined>
> = Symbol('voiderComponentLiveDollarProps')

/**
 * 页面级 live 数据池（previewRuntimeData / 编辑态数据池）。
 * 插槽投影里的 Component 组装 `$props` 时优先用它，避免拿到过期快照。
 */
export const PAGE_LIVE_PAGE_DATA_KEY: InjectionKey<
  ComputedRef<PageData | undefined>
> = Symbol('voiderPageLivePageData')
