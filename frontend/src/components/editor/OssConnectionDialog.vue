<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { testOssConnection } from '../../api/projects'
import type { OssBucketInfo, OssConnectionConfig } from '../../types/oss'

const props = defineProps<{
  modelValue: boolean
  connection: OssConnectionConfig | null
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  save: [conn: OssConnectionConfig]
}>()

const testing = ref(false)
const testedOk = ref(false)
const showErrors = ref(false)
const fetchedBuckets = ref<OssBucketInfo[]>([])

const form = reactive({
  id: '',
  name: '',
  endpoint: '',
  region: 'us-east-1',
  accessKeyId: '',
  secretAccessKey: '',
  forcePathStyle: true,
})

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return
    const src = props.connection
    testedOk.value = false
    showErrors.value = false
    fetchedBuckets.value = src?.buckets ?? []
    form.id = src?.id ?? ''
    form.name = src?.name ?? ''
    form.endpoint = src?.endpoint ?? ''
    form.region = src?.region || 'us-east-1'
    form.accessKeyId = src?.accessKeyId ?? ''
    form.secretAccessKey = src?.secretAccessKey ?? ''
    form.forcePathStyle = src?.forcePathStyle !== false
  },
)

function markDirty() {
  testedOk.value = false
}

const nameError = computed(() => showErrors.value && !form.name.trim())
const endpointError = computed(() => showErrors.value && !form.endpoint.trim())
const accessKeyError = computed(() => showErrors.value && !form.accessKeyId.trim())
const secretError = computed(() => showErrors.value && !form.secretAccessKey.trim())

function buildPayload() {
  return {
    endpoint: form.endpoint.trim(),
    region: form.region.trim() || 'us-east-1',
    accessKeyId: form.accessKeyId.trim(),
    secretAccessKey: form.secretAccessKey,
    forcePathStyle: form.forcePathStyle,
  }
}

function validateForm(): boolean {
  showErrors.value = true
  return Boolean(
    form.name.trim() &&
      form.endpoint.trim() &&
      form.accessKeyId.trim() &&
      form.secretAccessKey.trim(),
  )
}

async function handleTest() {
  if (!validateForm()) {
    ElMessage.error('请完善必填项')
    return
  }
  testing.value = true
  testedOk.value = false
  try {
    const result = await testOssConnection(buildPayload())
    fetchedBuckets.value = result.buckets
    testedOk.value = true
    ElMessage.success(`连接成功，共 ${result.buckets.length} 个桶`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '测试连接失败')
  } finally {
    testing.value = false
  }
}

function close() {
  emit('update:modelValue', false)
}

function handleSave() {
  if (!validateForm()) {
    ElMessage.error('请完善必填项')
    return
  }
  if (!testedOk.value) {
    ElMessage.warning('请先测试连接成功后再保存')
    return
  }
  const payload = buildPayload()
  const next: OssConnectionConfig = {
    id: form.id || `oss_${Date.now().toString(36)}`,
    name: form.name.trim(),
    endpoint: payload.endpoint,
    region: payload.region,
    accessKeyId: payload.accessKeyId,
    secretAccessKey: payload.secretAccessKey,
    forcePathStyle: payload.forcePathStyle,
    buckets: fetchedBuckets.value,
    lastTestedAt: Date.now(),
  }
  emit('save', next)
  close()
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="connection ? `配置对象存储 · ${connection.name}` : '添加对象存储连接'"
    width="720px"
    destroy-on-close
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="oss-form">
      <div class="form-item">
        <div class="label">显示名称</div>
        <div class="content">
          <el-input
            v-model="form.name"
            placeholder="如 测试环境"
            :status="nameError ? 'error' : undefined"
            @update:model-value="markDirty"
          />
        </div>
      </div>

      <div class="form-item">
        <div class="label">Endpoint</div>
        <div class="content">
          <el-input
            v-model="form.endpoint"
            placeholder="http://127.0.0.1:9000 或 https://oss-cn-hangzhou.aliyuncs.com"
            :status="endpointError ? 'error' : undefined"
            @update:model-value="markDirty"
          />
        </div>
      </div>

      <div class="form-item">
        <div class="label">Region</div>
        <div class="content">
          <el-input
            v-model="form.region"
            placeholder="us-east-1 / oss-cn-hangzhou"
            @update:model-value="markDirty"
          />
        </div>
      </div>

      <div class="form-item">
        <div class="label">AccessKeyId</div>
        <div class="content">
          <el-input
            v-model="form.accessKeyId"
            placeholder="Access Key"
            :status="accessKeyError ? 'error' : undefined"
            @update:model-value="markDirty"
          />
        </div>
      </div>

      <div class="form-item">
        <div class="label">SecretKey</div>
        <div class="content">
          <el-input
            v-model="form.secretAccessKey"
            type="password"
            show-password
            placeholder="Secret Access Key"
            :status="secretError ? 'error' : undefined"
            @update:model-value="markDirty"
          />
        </div>
      </div>

      <div class="form-item">
        <div class="label">Path Style</div>
        <div class="content path-style">
          <el-switch v-model="form.forcePathStyle" @change="markDirty" />
          <span class="hint">MinIO 等本地服务通常需要开启</span>
        </div>
      </div>

      <div v-if="testedOk" class="test-ok">
        已通过测试 · {{ fetchedBuckets.length }} 个桶
      </div>
    </div>

    <template #footer>
      <el-button :loading="testing" @click="handleTest">测试连接</el-button>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :disabled="!testedOk" @click="handleSave">
        保存
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.oss-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-item {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.label {
  width: 96px;
  flex-shrink: 0;
  padding-top: 6px;
  font-size: 13px;
  line-height: 20px;
  color: #606266;
  text-align: right;
}

.content {
  flex: 1;
  min-width: 0;
}

.path-style {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
}

.hint {
  font-size: 12px;
  color: #94a3b8;
}

.test-ok {
  margin-left: 112px;
  font-size: 12px;
  color: #67c23a;
  line-height: 1.4;
}
</style>
