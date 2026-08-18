import { createElement } from 'react'
import { Input, message, Modal } from 'antd'

type MessageArg = string | { message: string; type?: string; zIndex?: number }

function textOf(arg: MessageArg): string {
  return typeof arg === 'string' ? arg : arg.message
}

function show(kind: 'success' | 'error' | 'warning' | 'info', arg: MessageArg) {
  const content = textOf(arg)
  if (typeof arg !== 'string' && typeof arg.zIndex === 'number') {
    message.open({ type: kind, content, style: { zIndex: arg.zIndex } })
    return
  }
  message[kind](content)
}

/** Element Plus ElMessage 兼容层 */
export const ElMessage = {
  success: (arg: MessageArg) => show('success', arg),
  error: (arg: MessageArg) => show('error', arg),
  warning: (arg: MessageArg) => show('warning', arg),
  info: (arg: MessageArg) => show('info', arg),
}

type ConfirmOptions = {
  type?: 'warning' | 'info' | 'error' | 'success'
  confirmButtonText?: string
  cancelButtonText?: string
}

type PromptOptions = ConfirmOptions & {
  inputValue?: string
  inputPattern?: RegExp
  inputErrorMessage?: string
  inputPlaceholder?: string
}

/** Element Plus ElMessageBox.confirm 兼容层（取消时 reject） */
export const ElMessageBox = {
  confirm(
    content: string,
    title = '提示',
    options: ConfirmOptions = {},
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      Modal.confirm({
        title,
        content,
        okText: options.confirmButtonText ?? '确定',
        cancelText: options.cancelButtonText ?? '取消',
        okType: options.type === 'error' ? 'danger' : 'primary',
        centered: true,
        onOk: () => resolve(),
        onCancel: () => reject('cancel'),
      })
    })
  },
  prompt(
    content: string,
    title = '提示',
    options: PromptOptions = {},
  ): Promise<{ value: string }> {
    return new Promise((resolve, reject) => {
      let value = options.inputValue ?? ''
      Modal.confirm({
        title,
        centered: true,
        okText: options.confirmButtonText ?? '确定',
        cancelText: options.cancelButtonText ?? '取消',
        content: createElement(
          'div',
          null,
          createElement('p', { style: { marginBottom: 8 } }, content),
          createElement(Input, {
            defaultValue: value,
            placeholder: options.inputPlaceholder,
            onChange: (e) => {
              value = e.target.value
            },
          }),
        ),
        onOk: () => {
          if (options.inputPattern && !options.inputPattern.test(value)) {
            message.error(options.inputErrorMessage ?? '输入无效')
            return Promise.reject()
          }
          resolve({ value })
        },
        onCancel: () => reject('cancel'),
      })
    })
  },
}
