/** 编辑器控件复制粘贴（内存剪贴板，跨页面/组件会话内有效） */

let fragmentXml = ''

export function setWidgetClipboard(xml: string) {
  fragmentXml = xml.trim()
}

export function getWidgetClipboard(): string {
  return fragmentXml
}

export function hasWidgetClipboard(): boolean {
  return Boolean(fragmentXml.trim())
}
