const test = require('node:test')
const assert = require('node:assert/strict')
const { hashSecret, safeEqual } = require('../cloudfunctions/identity/domain')
const { normalizeDishSettings, assertWeeklyMenu } = require('../cloudfunctions/menu/domain')
const presetDishes = require('../cloudfunctions/menu/preset-dishes')
const { assertTransition, validateSelectedSpecs, normalizeItems, inventoryDeltas } = require('../cloudfunctions/order/domain')

test('初始化口令摘要可恒定时间比较且不等于明文', () => {
  const digest = hashSecret('family-secret')
  assert.equal(digest.length, 64)
  assert.notEqual(digest, 'family-secret')
  assert.equal(safeEqual(digest, hashSecret('family-secret')), true)
  assert.equal(safeEqual(digest, hashSecret('wrong')), false)
})

test('历史订单规格快照仍可正确校验', () => {
  const specs = [
    { name: '辣度', type: 'single', required: true, options: ['不辣', '微辣'] },
    { name: '加料', type: 'multiple', required: false, options: ['鸡蛋', '葱花'] }
  ]
  assert.equal(specs.length, 2)
  assert.deepEqual(validateSelectedSpecs(specs, { 辣度: ['微辣'], 加料: ['鸡蛋', '葱花'] }), {
    辣度: ['微辣'],
    加料: ['鸡蛋', '葱花']
  })
  assert.throws(() => validateSelectedSpecs(specs, {}), /请选择辣度/)
  assert.throws(() => validateSelectedSpecs(specs, { 辣度: ['重辣'] }), /无效选项/)
})

test('菜品库存支持有限数量和无限模式', () => {
  assert.deepEqual(normalizeDishSettings({ categoryId: 'c1', stock: 5 }), { categoryId: 'c1', stockUnlimited: false, stock: 5 })
  assert.deepEqual(normalizeDishSettings({ categoryId: 'c1', stockUnlimited: true, stock: -1 }), { categoryId: 'c1', stockUnlimited: true, stock: 0 })
  assert.throws(() => normalizeDishSettings({ categoryId: 'c1', stock: -1 }), /分类和库存/)
  assert.throws(() => normalizeDishSettings({ categoryId: '', stock: 1 }), /分类和库存/)
})

test('星期菜单只接受周一至周日且不硬编码具体菜品', () => {
  assert.doesNotThrow(() => assertWeeklyMenu(1))
  assert.doesNotThrow(() => assertWeeklyMenu(7))
  assert.throws(() => assertWeeklyMenu(0), /周一到周日/)
})

test('初始化菜品完整且不重复', () => {
  assert.equal(presetDishes.length, 51)
  assert.equal(new Set(presetDishes.map(name => name.toLowerCase())).size, 51)
  assert.ok(presetDishes.includes('kfc'))
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

test('改单库存按有限库存占用差额增减且忽略无限库存', () => {
  const oldItems = [
    { dishId: 'd1', quantity: 3, stockReserved: true },
    { dishId: 'd2', quantity: 2, stockReserved: false }
  ]
  const newItems = [
    { dishId: 'd1', quantity: 1, stockReserved: true },
    { dishId: 'd3', quantity: 4, stockReserved: true }
  ]
  assert.deepEqual(inventoryDeltas(oldItems, newItems), [
    { dishId: 'd1', delta: 2 },
    { dishId: 'd3', delta: -4 }
  ])
})
