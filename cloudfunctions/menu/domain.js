const WEEKDAY_LABELS = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' }
const MEAL_TYPES = {
  breakfast: { label: '早餐', deadlineHour: 9, reminderHour: 6 },
  lunch: { label: '中餐', deadlineHour: 14, reminderHour: 10 },
  dinner: { label: '晚餐', deadlineHour: 21, reminderHour: 17 }
}

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max)
}

/**
 * 校验厨师设置的菜品分类、库存和单价。
 * @param {object} payload 菜品设置
 * @returns {object} 安全设置
 */
function normalizeDishSettings(payload) {
  const categoryId = cleanText(payload.categoryId, 80)
  const stockUnlimited = Boolean(payload.stockUnlimited)
  const stock = Number(payload.stock)
  const priceCents = Number(payload.priceCents)
  const hasStock = payload.stock !== '' && payload.stock !== null && typeof payload.stock !== 'undefined'
  const hasPrice = payload.priceCents !== '' && payload.priceCents !== null && typeof payload.priceCents !== 'undefined'
  if (!categoryId || (!stockUnlimited && (!hasStock || !Number.isInteger(stock) || stock < 0 || stock > 9999))) {
    throw Object.assign(new Error('请正确填写分类和库存'), { code: 'INVALID_INPUT' })
  }
  if (!hasPrice || !Number.isInteger(priceCents) || priceCents < 0 || priceCents > 999999) {
    throw Object.assign(new Error('请填写 0 至 9999.99 元的单价'), { code: 'INVALID_INPUT' })
  }
  return { categoryId, stockUnlimited, stock: stockUnlimited ? 0 : stock, priceCents }
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
 * 整理批量归类的增量变更，禁止同一道菜同时移入和移出。
 * @param {Array<string>} addDishIds 明确移入当前分类的菜品标识
 * @param {Array<string>} removeDishIds 明确移出当前分类的菜品标识
 * @returns {{addDishIds: Array<string>, removeDishIds: Array<string>}} 安全的增量变更
 */
function normalizeCategoryChanges(addDishIds, removeDishIds) {
  const normalizedAddIds = normalizeDishSelection(addDishIds)
  const normalizedRemoveIds = normalizeDishSelection(removeDishIds)
  const removeSet = new Set(normalizedRemoveIds)
  if (normalizedAddIds.some(id => removeSet.has(id))) {
    throw Object.assign(new Error('同一道菜不能同时移入和移出分类'), { code: 'INVALID_INPUT' })
  }
  return { addDishIds: normalizedAddIds, removeDishIds: normalizedRemoveIds }
}

/**
 * 校验星期菜单序号。
 * @param {number} weekday 星期序号，周一为 1
 */
function assertWeeklyMenu(weekday) {
  if (!WEEKDAY_LABELS[weekday]) throw Object.assign(new Error('请选择周一到周日'), { code: 'INVALID_INPUT' })
}

/**
 * 校验早餐、中餐、晚餐标识。
 * @param {string} mealType 餐别标识
 * @returns {object} 餐别配置
 */
function assertMealType(mealType) {
  const normalized = cleanText(mealType, 20)
  if (!MEAL_TYPES[normalized]) throw Object.assign(new Error('请选择早餐、中餐或晚餐'), { code: 'INVALID_INPUT' })
  return { mealType: normalized, ...MEAL_TYPES[normalized] }
}

/**
 * 校验菜单同步的目标星期，目标不能重复或包含来源星期。
 * @param {Array<number>} targetWeekdays 目标星期序号
 * @param {number} sourceWeekday 来源星期序号
 * @returns {Array<number>} 排序后的目标星期
 */
function normalizeSyncWeekdays(targetWeekdays, sourceWeekday) {
  assertWeeklyMenu(sourceWeekday)
  if (!Array.isArray(targetWeekdays) || !targetWeekdays.length || targetWeekdays.length > 6) {
    throw Object.assign(new Error('请至少选择一个要同步的星期'), { code: 'INVALID_INPUT' })
  }
  const normalized = targetWeekdays.map(Number)
  if (normalized.some(weekday => !WEEKDAY_LABELS[weekday] || weekday === sourceWeekday)
    || new Set(normalized).size !== normalized.length) {
    throw Object.assign(new Error('同步的目标星期不正确'), { code: 'INVALID_INPUT' })
  }
  return normalized.sort((left, right) => left - right)
}

/**
 * 校验厨师提交的自定义分类顺序。
 * @param {Array<string>} categoryIds 分类标识
 * @returns {Array<string>} 去重后的分类顺序
 */
function normalizeCategoryOrder(categoryIds) {
  if (!Array.isArray(categoryIds) || categoryIds.length > 50) {
    throw Object.assign(new Error('分类顺序不正确'), { code: 'INVALID_INPUT' })
  }
  const normalized = categoryIds.map(id => cleanText(id, 80))
  if (normalized.some(id => !id) || new Set(normalized).size !== normalized.length) {
    throw Object.assign(new Error('分类顺序包含无效或重复分类'), { code: 'INVALID_INPUT' })
  }
  return normalized
}

/**
 * 校验每餐菜单不能包含未分类菜品，且必须包含系统“不要主食”。
 * @param {Array<object>} dishes 菜单菜品
 * @param {string} uncategorizedId 未分类标识
 * @param {string} stapleCategoryId 主食分类标识
 */
function assertMealDishCategories(dishes, uncategorizedId, stapleCategoryId) {
  if ((dishes || []).some(dish => !dish.enabled || dish.deletedAt || dish.categoryId === uncategorizedId)) {
    throw Object.assign(new Error('菜单中包含不可用菜品'), { code: 'INVALID_INPUT' })
  }
  if (!(dishes || []).some(dish => dish.categoryId === stapleCategoryId)) {
    throw Object.assign(new Error('每餐菜单至少选择一种主食'), { code: 'INVALID_INPUT' })
  }
  if (!(dishes || []).some(dish => dish.systemDishType === 'no_staple' && dish.categoryId === stapleCategoryId)) {
    throw Object.assign(new Error('每餐菜单必须包含“不要主食”'), { code: 'INVALID_INPUT' })
  }
}

module.exports = {
  WEEKDAY_LABELS,
  MEAL_TYPES,
  normalizeDishSettings,
  normalizeDishSelection,
  normalizeCategoryChanges,
  assertWeeklyMenu,
  assertMealType,
  normalizeSyncWeekdays,
  assertMealDishCategories,
  normalizeCategoryOrder
}
