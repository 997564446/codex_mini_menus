const WEEKDAY_LABELS = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' }

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max)
}

/**
 * 校验厨师为预置菜品设置的分类和库存。
 * @param {object} payload 菜品设置
 * @returns {object} 安全设置
 */
function normalizeDishSettings(payload) {
  const categoryId = cleanText(payload.categoryId, 80)
  const stockUnlimited = Boolean(payload.stockUnlimited)
  const stock = Number(payload.stock)
  if (!categoryId || (!stockUnlimited && (!Number.isInteger(stock) || stock < 0 || stock > 9999))) {
    throw Object.assign(new Error('请正确填写分类和库存'), { code: 'INVALID_INPUT' })
  }
  return { categoryId, stockUnlimited, stock: stockUnlimited ? 0 : stock }
}

/**
 * 整理批量归类时提交的菜品标识，拒绝重复和超量数据。
 * @param {Array<string>} dishIds 菜品标识列表
 * @returns {Array<string>} 去空后的菜品标识
 */
function normalizeDishSelection(dishIds) {
  if (!Array.isArray(dishIds) || dishIds.length > 100) {
    throw Object.assign(new Error('批量归类的菜品数量不正确'), { code: 'INVALID_INPUT' })
  }
  const normalized = dishIds.map(id => cleanText(id, 80))
  if (normalized.some(id => !id) || new Set(normalized).size !== normalized.length) {
    throw Object.assign(new Error('批量归类包含无效或重复菜品'), { code: 'INVALID_INPUT' })
  }
  return normalized
}

/**
 * 校验星期菜单序号。
 * @param {number} weekday 星期序号，周一为 1
 */
function assertWeeklyMenu(weekday) {
  if (!WEEKDAY_LABELS[weekday]) throw Object.assign(new Error('请选择周一到周日'), { code: 'INVALID_INPUT' })
}

module.exports = {
  WEEKDAY_LABELS,
  normalizeDishSettings,
  normalizeDishSelection,
  assertWeeklyMenu
}
