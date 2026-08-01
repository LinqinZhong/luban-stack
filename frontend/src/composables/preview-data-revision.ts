import { ref } from 'vue'

/**
 * 预览数据池版本号。setData / updateProps 原地改 field.value 时递增，
 * 强制实例 $props / vShow 重算（避免 Vue 对深层原地写入漏订阅导致卡住）。
 */
export const previewDataRevision = ref(0)

export function bumpPreviewDataRevision(): void {
  previewDataRevision.value += 1
}

export function resetPreviewDataRevision(): void {
  previewDataRevision.value = 0
}
