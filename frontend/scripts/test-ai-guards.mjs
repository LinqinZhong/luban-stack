/**
 * Smoke tests for AI data-field / dynamicStyles guards.
 * Run: node --experimental-strip-types scripts/test-ai-guards.mjs
 */
import assert from 'node:assert/strict'
import {
  coerceAiFieldValue,
  normalizeAiDataField,
} from '../src/types/page-data.ts'
import {
  assertDynamicStylesHaveOverrides,
  liftDynamicStylesFromScenarios,
  parseDynamicStyles,
  serializeDynamicStyles,
} from '../src/types/dynamic-styles.ts'
import { assertSingleAskUserQuestion } from '../src/services/ai-ask-user.ts'

// --- array string → real array ---
{
  const v = coerceAiFieldValue(
    'prizes',
    'array',
    '[{"emoji":"🍎","name":"苹果"},{"emoji":"🪙","name":"硬币"}]',
  )
  assert.ok(Array.isArray(v))
  assert.equal(v.length, 2)
  assert.equal(v[0].emoji, '🍎')
}

{
  const field = normalizeAiDataField({
    name: 'prizes',
    type: 'array',
    remark: '奖品',
    value: '[{"emoji":"🍎","name":"苹果"}]',
  })
  assert.ok(Array.isArray(field.value))
  assert.equal(field.itemType, 'json')
  assert.equal(field.arrayFields?.length, 1)
  assert.equal(Array.isArray(field.value) && field.value.length, 1)
}

// --- boolean / number coerce ---
assert.equal(coerceAiFieldValue('spinning', 'boolean', 'false'), false)
assert.equal(coerceAiFieldValue('count', 'number', '10'), 10)

// --- computed without body rejected ---
assert.throws(
  () =>
    normalizeAiDataField({
      name: 'slot0Bg',
      type: 'string',
      binding: 'computed',
      value: '',
    }),
  /computeBody/,
)

// --- invalid array string rejected ---
assert.throws(
  () => coerceAiFieldValue('bad', 'array', 'not-json'),
  /必须是 JSON 数组/,
)

// --- dynamicStyles: lift scenario styles ---
{
  const lifted = liftDynamicStylesFromScenarios({
    states: [
      {
        id: 'hl0',
        name: '高亮',
        scenarios: [
          {
            id: 'm0',
            name: '匹配',
            conditions: [{ field: 'currentIndex', op: 'eq', value: '0' }],
            styles: { background: '#ffd700' },
          },
        ],
      },
    ],
  })
  const state = lifted.states[0]
  assert.equal(state.styles.background, '#ffd700')
  assert.equal(state.scenarios[0].styles, undefined)

  const standard = parseDynamicStyles(JSON.stringify(lifted))
  assertDynamicStylesHaveOverrides(standard)
  const raw = serializeDynamicStyles(standard)
  assert.equal(JSON.parse(raw).states[0].styles.background, '#ffd700')
}

// --- empty styles with conditions rejected ---
assert.throws(
  () =>
    assertDynamicStylesHaveOverrides(
      parseDynamicStyles(
        JSON.stringify({
          states: [
            {
              id: 'hl0',
              name: '高亮',
              scenarios: [
                {
                  id: 'm0',
                  name: '匹配',
                  conditions: [{ field: 'currentIndex', op: 'eq', value: '0' }],
                },
              ],
              styles: {},
            },
          ],
        }),
      ),
    ),
  /styles 为空/,
)

assert.throws(
  () =>
    assertSingleAskUserQuestion(
      '关于九宫格老虎机，需要确认：\n1. 页面范围：home 还是新建？\n2. 格子里面放什么？\n3. 怎么玩？',
      [
        '新建一个 slot-machine 页面，保留 home 不动',
        '直接改造 home 页面做成老虎机',
        '格子放 emoji 图案',
        '格子放水果/图标',
        '点击开始 → 9 格同时滚动',
        '手动逐格点击旋转',
        '深色赌场风格背景',
        '浅色明亮风格背景',
        '随意发挥',
      ],
    ),
  /一次只能问一个问题/,
)
assertSingleAskUserQuestion('老虎机是新建独立页面，还是改当前 home？', [
  '新建 slot-machine 页面',
  '改造 home 页面',
])

console.log('ok: ai guards')

