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
 * 校验星期菜单序号。
 * @param {number} weekday 星期序号，周一为 1
 */
function assertWeeklyMenu(weekday) {
  if (!WEEKDAY_LABELS[weekday]) throw Object.assign(new Error('请选择周一到周日'), { code: 'INVALID_INPUT' })
}

module.exports = {
  WEEKDAY_LABELS,
  normalizeDishSettings,
  assertWeeklyMenu
}
