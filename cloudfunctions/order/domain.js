const TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['cooking', 'cancelled'],
  cooking: ['ready', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  cancelled: []
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

module.exports = { TRANSITIONS, assertTransition, validateSelectedSpecs, normalizeItems }
