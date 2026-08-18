import { useState } from 'react'
import { Button } from 'antd'
import EventBindDialog from './EventBindDialog'
import {
  LIFECYCLE_HOOKS,
  type LifecycleConfig,
  type LifecycleHookKey,
} from '../../types/lifecycle'
import {
  countEventBindings,
  type PageMethod,
} from '../../types/page-method'
import type { DataField } from '../../types/page-data'
import type { ComponentEventDef, ComponentPropDef } from '../../types/component'
import type { ComponentRenderMap } from '../../types/component-render'
import type { ComponentMethodsMap } from '../../utils/widget-ref'
import type { DataTypeLibrary } from '../../types/data-types'
import './LifecyclePanel.css'

export default function LifecyclePanel({
  lifecycle,
  methods,
  dataFields,
  xml,
  componentMap,
  componentMethodsMap,
  iconOptions,
  emitEvents,
  componentProps,
  typeLibrary,
  projectPath,
  onLifecycleChange,
}: {
  lifecycle: LifecycleConfig
  methods: PageMethod[]
  dataFields?: DataField[]
  xml?: string
  componentMap?: ComponentRenderMap
  componentMethodsMap?: ComponentMethodsMap
  iconOptions?: Array<{ id: string; label: string }>
  emitEvents?: ComponentEventDef[]
  componentProps?: ComponentPropDef[] | null
  typeLibrary?: DataTypeLibrary | null
  projectPath?: string | null
  onLifecycleChange?: (value: LifecycleConfig) => void
}) {
  function summaryFor(key: LifecycleHookKey): string {
    const count = countEventBindings(lifecycle[key])
    if (!count) return '未配置'
    return `已绑定 ${count} 个方法`
  }

  const [bindVisible, setBindVisible] = useState(false)
  const [bindKey, setBindKey] = useState<LifecycleHookKey>('onMounted')
  const [bindLabel, setBindLabel] = useState('')

  function openBind(key: LifecycleHookKey, label: string) {
    setBindKey(key)
    setBindLabel(label)
    setBindVisible(true)
  }

  function handleBindSave(value: string) {
    const next: LifecycleConfig = { ...lifecycle }
    if (value.trim()) next[bindKey] = value
    else delete next[bindKey]
    onLifecycleChange?.(next)
  }

  return (
    <div className="lifecycle-panel">
      <div className="hook-list">
        {LIFECYCLE_HOOKS.map((hook) => (
          <div key={hook.key} className="hook-card">
            <div className="hook-main">
              <div className="hook-name">{hook.label}</div>
              <div className="hook-key">{hook.key}</div>
            </div>
            <div className="hook-actions">
              <span className="hook-summary">{summaryFor(hook.key)}</span>
              <Button type="link" onClick={() => openBind(hook.key, hook.label)}>
                配置
              </Button>
            </div>
          </div>
        ))}
      </div>

      <EventBindDialog
        open={bindVisible}
        onOpenChange={setBindVisible}
        eventLabel={bindLabel}
        eventKey={bindKey}
        rawValue={lifecycle[bindKey] ?? ''}
        methods={methods}
        emitEvents={emitEvents}
        dataFields={dataFields ?? []}
        xml={xml}
        componentMap={componentMap}
        componentMethodsMap={componentMethodsMap}
        iconOptions={iconOptions}
        componentProps={componentProps}
        typeLibrary={typeLibrary}
        projectPath={projectPath}
        onSave={handleBindSave}
      />
    </div>
  )
}
