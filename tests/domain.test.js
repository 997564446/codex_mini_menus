const test = require('node:test')
const assert = require('node:assert/strict')
const { hashSecret, safeEqual } = require('../cloudfunctions/identity/domain')
const { normalizeDish, normalizeSpecs, assertMealKey } = require('../cloudfunctions/menu/domain')
const { assertTransition, validateSelectedSpecs, normalizeItems } = require('../cloudfunctions/order/domain')

test('初始化口令摘要可恒定时间比较且不等于明文', () => {
  const digest = hashSecret('family-secret')
  assert.equal(digest.length, 64)
  assert.notEqual(digest, 'family-secret')
  assert.equal(safeEqual(digest, hashSecret('family-secret')), true)
  assert.equal(safeEqual(digest, hashSecret('wrong')), false)
})

test('菜品规格支持必选单选和可选多选', () => {
  const specs = normalizeSpecs([
    { name: '辣度', type: 'single', required: true, options: ['不辣', '微辣'] },
    { name: '加料', type: 'multiple', required: false, options: ['鸡蛋', '葱花'] }
  ])
  assert.equal(specs.length, 2)
  assert.deepEqual(validateSelectedSpecs(specs, { 辣度: ['微辣'], 加料: ['鸡蛋', '葱花'] }), {
    辣度: ['微辣'],
    加料: ['鸡蛋', '葱花']
  })
  assert.throws(() => validateSelectedSpecs(specs, {}), /请选择辣度/)
  assert.throws(() => validateSelectedSpecs(specs, { 辣度: ['重辣'] }), /无效选项/)
  assert.throws(() => normalizeSpecs([
    { name: '辣度', type: 'single', options: ['不辣'] },
    { name: '辣度', type: 'multiple', options: ['微辣'] }
  ]), /重复/)
})

test('统一菜品价格允许零元但拒绝负数和无分类', () => {
  const dish = normalizeDish({ name: '家常豆腐', categoryId: 'c1', priceCents: 0, specs: [] })
  assert.equal(dish.priceCents, 0)
  assert.throws(() => normalizeDish({ name: '坏数据', categoryId: '', priceCents: -1 }), /正确填写/)
})

test('餐次只接受标准日期和三个固定餐次', () => {
  assert.doesNotThrow(() => assertMealKey('2026-08-14', 'dinner'))
  assert.throws(() => assertMealKey('2026/08/14', 'dinner'), /正确的日期/)
  assert.throws(() => assertMealKey('2026-08-14', 'snack'), /正确的日期/)
})

test('订单状态只能逐步向前或从进行中取消', () => {
  assert.doesNotThrow(() => assertTransition('pending', 'confirmed'))
  assert.doesNotThrow(() => assertTransition('cooking', 'cancelled'))
  assert.throws(() => assertTransition('pending', 'ready'), /不能从/)
  assert.throws(() => assertTransition('completed', 'cancelled'), /不能从/)
})

test('订单条目拒绝重复菜品和越界份数', () => {
  assert.equal(normalizeItems([{ dishId: 'd1', quantity: 2 }])[0].quantity, 2)
  assert.throws(() => normalizeItems([]), /至少选择/)
  assert.throws(() => normalizeItems([{ dishId: 'd1', quantity: 1 }, { dishId: 'd1', quantity: 2 }]), /重复菜品/)
  assert.throws(() => normalizeItems([{ dishId: 'd1', quantity: 21 }]), /数量不正确/)
})
