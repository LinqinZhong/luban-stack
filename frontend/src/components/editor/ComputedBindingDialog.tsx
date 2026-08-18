import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Form, Modal } from 'antd'
import TsCodeEditor from './TsCodeEditor'
import { defaultComputeBody, type DataField } from '../../types/page-data'
import {
  buildTypeLibraryAmbientDeclarations,
  dataFieldsToAmbientVars,
  dataFieldToMethodParamType,
  dataFieldToTsType,
  type MethodParam,
  type MethodReturnType,
} from '../../types/page-method'
import { buildGetDeviceInfoAmbientDeclaration } from '../../utils/device-info'
import {
  buildDollarPropsAmbientDeclaration,
  buildUpdatePropsAmbientDeclarations,
} from '../../utils/component-props'
import { buildDollarQueryAmbientDeclaration } from '../../types/page-query'
import {
  buildDollarColorAmbientDeclaration,
  type ColorPalette,
} from '../../types/color-palette'
import type { ComponentPropDef } from '../../types/component'
import type { DataTypeLibrary } from '../../types/data-types'
import type { PageQueryParamDef } from '../../types/page-query'
import './ComputedBindingDialog.css'

type TsCodeEditorHandle = { getBody: () => string }

export default function ComputedBindingDialog({
  open,
  onOpenChange,
  field,
  siblingFields,
  componentProps,
  pageQueryParams,
  typeLibrary,
  colorPalette,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  field: DataField | null
  siblingFields?: DataField[]
  componentProps?: ComponentPropDef[] | null
  pageQueryParams?: PageQueryParamDef[] | null
  typeLibrary?: DataTypeLibrary | null
  colorPalette?: ColorPalette | null
  onSave?: (body: string) => void
}) {
  const [body, setBody] = useState('')
  const editorRef = useRef<TsCodeEditorHandle | null>(null)

  const fieldName = field?.name.trim() || '未命名字段'

  const ambientVars = useMemo<MethodParam[]>(
    () => dataFieldsToAmbientVars(siblingFields, typeLibrary),
    [siblingFields, typeLibrary],
  )

  const ambientExtra = useMemo(
    () =>
      [
        buildTypeLibraryAmbientDeclarations(typeLibrary),
        buildGetDeviceInfoAmbientDeclaration(),
        buildDollarColorAmbientDeclaration(colorPalette),
        buildDollarPropsAmbientDeclaration(componentProps, typeLibrary),
        buildUpdatePropsAmbientDeclarations(componentProps, typeLibrary),
        pageQueryParams != null
          ? buildDollarQueryAmbientDeclaration(pageQueryParams)
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    [typeLibrary, colorPalette, componentProps, pageQueryParams],
  )

  const showQueryHint = pageQueryParams != null

  const returnType = useMemo<MethodReturnType>(
    () => dataFieldToMethodParamType(field?.type ?? 'string'),
    [field?.type],
  )

  const returnTypeTs = field ? dataFieldToTsType(field, typeLibrary) : 'any'

  const functionName = fieldName === '未命名字段' ? 'compute' : fieldName

  useEffect(() => {
    if (!open || !field) return
    setBody(
      field.computeBody?.trim() ? field.computeBody : defaultComputeBody(field.type),
    )
  }, [open, field])

  function handleSave() {
    const next = editorRef.current?.getBody?.() ?? body
    setBody(next)
    onSave?.(next)
    onOpenChange?.(false)
  }

  return (
    <Modal
      open={open}
      title={`计算 · ${fieldName}`}
      width={760}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onCancel={() => onOpenChange?.(false)}
      footer={
        <Button type="primary" onClick={handleSave}>
          保存
        </Button>
      }
    >
      <Form layout="vertical">
        <Form.Item label="方法体">
          <p className="hint">
            语法 TypeScript：顶部方法声明只读且无入参；同级数据池字段可直接按名字引用。
            亦可调用 <code>getDeviceInfo()</code>；画板颜色用 <code>$color.xxx</code>
            ；组件内可用 <code>$props</code>。
            {showQueryHint ? (
              <>
                {' '}
                页面可用 <code>$query</code> / <code>$route</code> 读取路由参数。
              </>
            ) : null}
            <code>return</code> 的值即为该字段的计算值。
          </p>
          <TsCodeEditor
            ref={editorRef}
            value={body}
            onChange={setBody}
            functionName={functionName}
            ambientVars={ambientVars}
            ambientExtra={ambientExtra}
            returnType={returnType}
            returnTypeTs={returnTypeTs}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
