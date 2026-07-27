<script setup lang="ts">
import { computed } from 'vue'
import DataFieldTypeTreeSelect, {
  type TypeSelectPayload,
} from './DataFieldTypeTreeSelect.vue'
import {
  isTypeExprCleared,
  type DataTypeLibrary,
  type TypeExpr,
} from '../../types/data-types'
import {
  selectPayloadToTypeExpr,
  TYPE_EXPR_EXCLUDE_TYPES,
  typeExprToSelectPayload,
} from '../../utils/type-expr-select'

const props = withDefaults(
  defineProps<{
    modelValue: TypeExpr | null
    library?: DataTypeLibrary | null
    genericNames?: string[]
    excludeNamedIds?: string[]
    /** 允许选择「无约束」，值为 null */
    allowNone?: boolean
    size?: 'large' | 'default' | 'small'
  }>(),
  {
    allowNone: false,
    size: 'default',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: TypeExpr | null]
}>()

const payload = computed(() => typeExprToSelectPayload(props.modelValue))

const isEmpty = computed(() => {
  if (props.modelValue == null) return true
  return isTypeExprCleared(props.modelValue)
})

function onChange(next: TypeSelectPayload) {
  if (next.cleared) {
    emit('update:modelValue', props.allowNone ? null : selectPayloadToTypeExpr(next))
    return
  }
  emit('update:modelValue', selectPayloadToTypeExpr(next))
}
</script>

<template>
  <DataFieldTypeTreeSelect
    :type="payload.cleared ? 'string' : payload.type"
    :type-ref="payload.typeRef"
    :item-type="payload.itemType"
    :item-type-ref="payload.itemTypeRef"
    :item-item-type="payload.itemItemType"
    :item-item-type-ref="payload.itemItemTypeRef"
    :empty="isEmpty"
    :library="library"
    :generic-names="genericNames"
    :exclude-named-ids="excludeNamedIds"
    :exclude-types="TYPE_EXPR_EXCLUDE_TYPES"
    allow-any
    empty-on-clear
    clearable
    :size="size"
    @change="onChange"
  />
</template>
