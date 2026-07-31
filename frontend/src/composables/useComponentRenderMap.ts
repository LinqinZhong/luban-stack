import type { InjectionKey, Ref } from 'vue'
import type { ComponentRenderMap } from '../types/component-render'

/**
 * 画布组件渲染表：用 provide/inject 下发，避免作为 prop 层层传递。
 * 否则任意组件 setData 换 map 引用时，整棵 XmlNodeView 都会因 prop 变化重渲染。
 */
export const COMPONENT_RENDER_MAP_KEY: InjectionKey<
  Ref<ComponentRenderMap | undefined>
> = Symbol('voiderComponentRenderMap')
