<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { BackendService } from '../../types/backend-services'
import { createEmptyBackendService } from '../../types/backend-services'
import type { MysqlDatabaseConfig, MysqlLibrary } from '../../types/mysql'

const props = defineProps<{
  modelValue: boolean
  service: BackendService | null
  mysqlLibrary: MysqlLibrary | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [service: BackendService]
}>()

const draft = reactive<BackendService>(createEmptyBackendService())

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const mysqlOptions = computed(() => props.mysqlLibrary?.databases ?? [])

watch(
  () => [props.modelValue, props.service] as const,
  ([open, svc]) => {
    if (!open || !svc) return
    draft.id = svc.id
    draft.name = svc.name
    draft.testMysqlId = svc.testMysqlId
    draft.productionMysqlId = svc.productionMysqlId
  },
)

function mysqlLabel(db: MysqlDatabaseConfig): string {
  const schema = db.database?.trim()
  const endpoint = `${db.host}:${db.port}`
  if (schema) return `${db.name}（${endpoint} / ${schema}）`
  return `${db.name}（${endpoint}）`
}

function handleSave() {
  if (!props.service) return
  emit('save', {
    id: draft.id,
    name: draft.name.trim() || props.service.name,
    testMysqlId: draft.testMysqlId,
    productionMysqlId: draft.productionMysqlId,
  })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="`配置模块${draft.name ? ` · ${draft.name}` : ''}`"
    width="520px"
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <div class="service-dialog-body">
      <section class="block">
        <div class="block-title">基本信息</div>
        <el-form label-width="100px" @submit.prevent>
          <el-form-item label="名称">
            <el-input v-model="draft.name" placeholder="显示名，如 shop" />
          </el-form-item>
          <el-form-item label="ID">
            <el-input :model-value="draft.id" disabled />
          </el-form-item>
        </el-form>
      </section>

      <section class="block">
        <div class="block-title">数据库</div>
        <p class="hint">从左侧「MySQL」中已配置的数据库里选择。构建时写入对应环境的 .env。</p>
        <el-form label-width="100px" @submit.prevent>
          <el-form-item label="测试环境">
            <el-select
              v-model="draft.testMysqlId"
              clearable
              filterable
              placeholder="选择数据库"
              style="width: 100%"
            >
              <el-option
                v-for="db in mysqlOptions"
                :key="db.id"
                :label="mysqlLabel(db)"
                :value="db.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="生产环境">
            <el-select
              v-model="draft.productionMysqlId"
              clearable
              filterable
              placeholder="选择数据库"
              style="width: 100%"
            >
              <el-option
                v-for="db in mysqlOptions"
                :key="db.id"
                :label="mysqlLabel(db)"
                :value="db.id"
              />
            </el-select>
          </el-form-item>
        </el-form>
      </section>
    </div>
    <template #footer>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.service-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.block-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: #909399;
}
</style>
