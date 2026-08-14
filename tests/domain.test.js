const test = require('node:test')
const assert = require('node:assert/strict')
const { hashSecret, safeEqual } = require('../cloudfunctions/identity/domain')
const { normalizeDishSettings, normalizeDishSelection, normalizeCategoryChanges, assertWeeklyMenu, assertMealType, assertMealDishCategories, normalizeCategoryOrder } = require('../cloudfunctions/menu/domain')
const presetDishes = require('../cloudfunctions/menu/preset-dishes')
const { assertOrderWindow, assertTransition, assertStapleSelection, validateSelectedSpecs, normalizeItems, inventoryDeltas } = require('../cloudfunctions/order/domain')
const { mealAvailability } = require('../miniprogram/utils/format')

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
  assert.deepEqual(normalizeDishSettings({ categoryId: 'c1', stock: 5, priceCents: 1500 }), {
    categoryId: 'c1', stockUnlimited: false, stock: 5, priceCents: 1500
  })
  assert.deepEqual(normalizeDishSettings({ categoryId: 'c1', stockUnlimited: true, stock: '', priceCents: 0 }), {
    categoryId: 'c1', stockUnlimited: true, stock: 0, priceCents: 0
  })
  assert.throws(() => normalizeDishSettings({ categoryId: 'c1', stock: '', priceCents: 100 }), /分类和库存/)
  assert.throws(() => normalizeDishSettings({ categoryId: 'c1', stock: -1, priceCents: 100 }), /分类和库存/)
  assert.throws(() => normalizeDishSettings({ categoryId: '', stock: 1, priceCents: 100 }), /分类和库存/)
  assert.throws(() => normalizeDishSettings({ categoryId: 'c1', stock: 1, priceCents: '' }), /单价/)
  assert.throws(() => normalizeDishSettings({ categoryId: 'c1', stock: 1, priceCents: 1000000 }), /单价/)
})

test('批量归类拒绝重复、空标识和超量菜品', () => {
  assert.deepEqual(normalizeDishSelection(['d1', 'd2']), ['d1', 'd2'])
  assert.throws(() => normalizeDishSelection(['d1', 'd1']), /重复菜品/)
  assert.throws(() => normalizeDishSelection(['']), /无效/)
  assert.throws(() => normalizeDishSelection(Array.from({ length: 101 }, (_, index) => `d${index}`)), /数量不正确/)
})

test('批量归类只接受互不重叠的明确移入和移出菜品', () => {
  assert.deepEqual(normalizeCategoryChanges(['d1'], ['d2']), { addDishIds: ['d1'], removeDishIds: ['d2'] })
  assert.throws(() => normalizeCategoryChanges(['d1'], ['d1']), /不能同时移入和移出/)
})

test('星期菜单只接受周一至周日且不硬编码具体菜品', () => {
  assert.doesNotThrow(() => assertWeeklyMenu(1))
  assert.doesNotThrow(() => assertWeeklyMenu(7))
  assert.throws(() => assertWeeklyMenu(0), /周一到周日/)
})

test('星期菜单只接受早中晚三种餐别', () => {
  assert.equal(assertMealType('breakfast').label, '早餐')
  assert.equal(assertMealType('lunch').deadlineHour, 14)
  assert.equal(assertMealType('dinner').reminderHour, 17)
  assert.throws(() => assertMealType('night'), /早餐、中餐或晚餐/)
})

test('分类拖动顺序拒绝重复和无效分类', () => {
  assert.deepEqual(normalizeCategoryOrder(['c2', 'c1']), ['c2', 'c1'])
  assert.throws(() => normalizeCategoryOrder(['c1', 'c1']), /重复分类/)
  assert.throws(() => normalizeCategoryOrder(['']), /无效/)
})

test('每餐菜单必须提供主食且不能包含未分类菜品', () => {
  assert.doesNotThrow(() => assertMealDishCategories([{ enabled: true, categoryId: 'staple' }], 'uncat', 'staple'))
  assert.throws(() => assertMealDishCategories([{ enabled: true, categoryId: 'dish' }], 'uncat', 'staple'), /至少选择一种主食/)
  assert.throws(() => assertMealDishCategories([{ enabled: true, categoryId: 'uncat' }], 'uncat', 'staple'), /不可用菜品/)
})

test('每餐允许提前两天下单并按餐别截止', () => {
  const beforeBreakfast = Date.parse('2026-08-14T08:59:00+08:00')
  assert.equal(assertOrderWindow('2026-08-14', 'breakfast', beforeBreakfast).daysAhead, 0)
  const dinnerWindow = assertOrderWindow('2026-08-16', 'dinner', beforeBreakfast)
  assert.equal(dinnerWindow.daysAhead, 2)
  assert.equal(dinnerWindow.deadlineAt.toISOString(), '2026-08-16T13:00:00.000Z')
  assert.equal(dinnerWindow.reminderAt.toISOString(), '2026-08-16T09:00:00.000Z')
  assert.throws(() => assertOrderWindow('2026-08-17', 'lunch', beforeBreakfast), /提前 2 天/)
  assert.throws(() => assertOrderWindow('2026-08-14', 'breakfast', Date.parse('2026-08-14T09:00:00+08:00')), /已截止/)
  assert.throws(() => assertOrderWindow('2026-08-14', 'lunch', Date.parse('2026-08-14T14:00:00+08:00')), /已截止/)
  assert.throws(() => assertOrderWindow('2026-08-14', 'dinner', Date.parse('2026-08-14T21:00:00+08:00')), /已截止/)
})

test('客户端三餐截止展示与服务端规则一致', () => {
  assert.equal(mealAvailability('2026-08-14', 'breakfast', new Date('2026-08-14T08:59:00+08:00')).closed, false)
  assert.equal(mealAvailability('2026-08-14', 'breakfast', new Date('2026-08-14T09:00:00+08:00')).closed, true)
  assert.equal(mealAvailability('2026-08-14', 'lunch', new Date('2026-08-14T13:59:00+08:00')).closed, false)
  assert.equal(mealAvailability('2026-08-14', 'dinner', new Date('2026-08-14T21:00:00+08:00')).closed, true)
})

test('初始化菜品完整且不重复', () => {
  assert.equal(presetDishes.length, 71)
  assert.equal(new Set(presetDishes.map(dish => dish.name.toLowerCase())).size, 71)
  assert.deepEqual(presetDishes.find(dish => dish.name === 'kfc'), {
    name: 'kfc', priceCents: 5000, stockUnlimited: true, stock: 0
  })
  assert.deepEqual(presetDishes.find(dish => dish.name === '家庭火锅'), {
    name: '家庭火锅', priceCents: 5000, stockUnlimited: false, stock: 0
  })
  assert.ok(presetDishes.every(dish => Number.isInteger(dish.priceCents) && Number.isInteger(dish.stock)))
})

test('订单状态只能逐步向前或从进行中取消', () => {
  assert.doesNotThrow(() => assertTransition('pending', 'confirmed'))
  assert.doesNotThrow(() => assertTransition('cooking', 'cancelled'))
  assert.throws(() => assertTransition('pending', 'ready'), /不能从/)
  assert.throws(() => assertTransition('completed', 'cancelled'), /不能从/)
})

test('订单条目拒绝重复菜品和越界份数', () => {
  assert.equal(normalizeItems([{ dishId: 'd1', quantity: 2 }])[0].quantity, 2)
  assert.equal(normalizeItems(Array.from({ length: 61 }, (_, index) => ({ dishId: `d${index}`, quantity: 1 }))).length, 61)
  assert.throws(() => normalizeItems([]), /至少选择/)
  assert.throws(() => normalizeItems([{ dishId: 'd1', quantity: 1 }, { dishId: 'd1', quantity: 2 }]), /重复菜品/)
  assert.throws(() => normalizeItems([{ dishId: 'd1', quantity: 21 }]), /数量不正确/)
})

test('食客订单必须选择主食且不能选择未分类菜品', () => {
  const dishes = [{ _id: 'staple', categoryId: 'c-staple' }, { _id: 'dish', categoryId: 'c1' }, { _id: 'uncat', categoryId: 'c-uncat' }]
  assert.doesNotThrow(() => assertStapleSelection([{ dishId: 'staple' }, { dishId: 'dish' }], dishes, 'c-staple', 'c-uncat'))
  assert.throws(() => assertStapleSelection([{ dishId: 'dish' }], dishes, 'c-staple', 'c-uncat'), /请选择一种主食/)
  assert.throws(() => assertStapleSelection([{ dishId: 'staple' }, { dishId: 'uncat' }], dishes, 'c-staple', 'c-uncat'), /未分类菜品/)
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
