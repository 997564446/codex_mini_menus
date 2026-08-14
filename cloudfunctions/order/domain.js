const TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['cooking', 'cancelled'],
  cooking: ['ready', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  cancelled: []
}
const MEAL_TYPES = {
  breakfast: { label: '早餐', deadlineHour: 9, reminderHour: 6 },
  lunch: { label: '中餐', deadlineHour: 14, reminderHour: 10 },
  dinner: { label: '晚餐', deadlineHour: 21, reminderHour: 17 }
}

function chinaDateKey(nowMs) {
  return new Date(nowMs + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * 校验下单日期、餐别、提前天数和截止时间。
 * @param {string} mealDate 用餐日期
 * @param {string} mealType 餐别
 * @param {number} nowMs 当前毫秒时间
 * @returns {object} 下单窗口与提醒时间
 */
function assertOrderWindow(mealDate, mealType, nowMs = Date.now()) {
  const config = MEAL_TYPES[mealType]
  if (!config || !/^\d{4}-\d{2}-\d{2}$/.test(mealDate)) {
    throw Object.assign(new Error('订单日期或餐别不正确'), { code: 'INVALID_INPUT' })
  }
  const mealDay = Date.parse(`${mealDate}T00:00:00+08:00`)
  if (Number.isNaN(mealDay) || new Date(mealDay + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) !== mealDate) {
    throw Object.assign(new Error('订单日期不正确'), { code: 'INVALID_INPUT' })
  }
  const today = chinaDateKey(nowMs)
  const todayStart = Date.parse(`${today}T00:00:00+08:00`)
  const daysAhead = Math.round((mealDay - todayStart) / (24 * 60 * 60 * 1000))
  if (daysAhead < 0) throw Object.assign(new Error('过去的日期不能再点餐'), { code: 'MENU_CLOSED' })
  if (daysAhead > 2) throw Object.assign(new Error('最多只能提前 2 天下单'), { code: 'MENU_CLOSED' })
  const deadlineAt = Date.parse(`${mealDate}T${String(config.deadlineHour).padStart(2, '0')}:00:00+08:00`)
  if (nowMs >= deadlineAt) throw Object.assign(new Error(`${config.label}已截止点餐`), { code: 'MENU_CLOSED' })
  return {
    mealType,
    mealTypeLabel: config.label,
    daysAhead,
    deadlineAt: new Date(deadlineAt),
    reminderAt: new Date(Date.parse(`${mealDate}T${String(config.reminderHour).padStart(2, '0')}:00:00+08:00`))
  }
}

/**
 * 校验订单状态是否允许向前流转。
 * @param {string} from 当前状态
 * @param {string} to 目标状态
 */
function assertTransition(from, to) {
  if (!TRANSITIONS[from] || !TRANSITIONS[from].includes(to)) {
    throw Object.assign(new Error(`订单不能从 ${from} 变为 ${to}`), { code: 'CONFLICT' })
  }
}

/**
 * 按菜品规格定义校验食客选择。
 * @param {Array<object>} specs 菜品规格定义
 * @param {object} selectedSpecs 食客选择
 * @returns {object} 安全规格选择
 */
function validateSelectedSpecs(specs, selectedSpecs) {
  const selections = selectedSpecs && typeof selectedSpecs === 'object' ? selectedSpecs : {}
  const normalized = {}
  for (const spec of specs || []) {
    const raw = Array.isArray(selections[spec.name]) ? selections[spec.name] : []
    const values = [...new Set(raw.map(item => String(item || '').trim()).filter(Boolean))]
    if (spec.required && !values.length) {
      throw Object.assign(new Error(`请选择${spec.name}`), { code: 'INVALID_INPUT' })
    }
    if (spec.type === 'single' && values.length > 1) {
      throw Object.assign(new Error(`${spec.name}只能选择一项`), { code: 'INVALID_INPUT' })
    }
    if (values.some(value => !spec.options.includes(value))) {
      throw Object.assign(new Error(`${spec.name}中包含无效选项`), { code: 'INVALID_INPUT' })
    }
    if (values.length) normalized[spec.name] = values
  }
  const knownNames = new Set((specs || []).map(spec => spec.name))
  if (Object.keys(selections).some(name => !knownNames.has(name))) {
    throw Object.assign(new Error('订单包含已经失效的规格'), { code: 'INVALID_INPUT' })
  }
  return normalized
}

/**
 * 整理订单条目基础字段。
 * @param {Array<object>} items 原始条目
 * @returns {Array<object>} 安全条目
 */
function normalizeItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 60) {
    throw Object.assign(new Error('请至少选择一道菜'), { code: 'INVALID_INPUT' })
  }
  const seen = new Set()
  return items.map(item => {
    const dishId = String(item.dishId || '').trim()
    const quantity = Number(item.quantity)
    if (!dishId || seen.has(dishId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw Object.assign(new Error('菜品数量不正确或存在重复菜品'), { code: 'INVALID_INPUT' })
    }
    seen.add(dishId)
    return {
      dishId,
      quantity,
      selectedSpecs: item.selectedSpecs || {},
      note: String(item.note || '').trim().slice(0, 80)
    }
  })
}

/**
 * 校验订单必须包含主食且不能包含未分类菜品。
 * @param {Array<object>} items 订单条目
 * @param {Array<object>} dishes 当前菜品
 * @param {string} stapleCategoryId 主食分类标识
 * @param {string} uncategorizedId 未分类标识
 */
function assertStapleSelection(items, dishes, stapleCategoryId, uncategorizedId) {
  const dishMap = new Map((dishes || []).map(dish => [dish._id, dish]))
  if ((items || []).some(item => dishMap.get(item.dishId) && dishMap.get(item.dishId).categoryId === uncategorizedId)) {
    throw Object.assign(new Error('未分类菜品不能下单'), { code: 'INVALID_INPUT' })
  }
  if (!(items || []).some(item => dishMap.get(item.dishId) && dishMap.get(item.dishId).categoryId === stapleCategoryId)) {
    throw Object.assign(new Error('请选择一种主食'), { code: 'INVALID_INPUT' })
  }
}

/**
 * 计算改单前后每道菜应归还或扣减的有限库存差额。
 * @param {Array<object>} oldItems 原订单条目
 * @param {Array<object>} newItems 新订单条目
 * @returns {Array<object>} 正数为归还，负数为扣减
 */
function inventoryDeltas(oldItems, newItems) {
  const oldMap = new Map((oldItems || []).filter(item => item.stockReserved).map(item => [item.dishId, Number(item.quantity || 0)]))
  const newMap = new Map((newItems || []).filter(item => item.stockReserved).map(item => [item.dishId, Number(item.quantity || 0)]))
  return [...new Set([...oldMap.keys(), ...newMap.keys()])].map(dishId => ({
    dishId,
    delta: Number(oldMap.get(dishId) || 0) - Number(newMap.get(dishId) || 0)
  })).filter(item => item.delta)
}

module.exports = {
  MEAL_TYPES,
  TRANSITIONS,
  assertOrderWindow,
  assertTransition,
  assertStapleSelection,
  validateSelectedSpecs,
  normalizeItems,
  inventoryDeltas
}
