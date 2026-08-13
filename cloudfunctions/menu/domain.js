const MEAL_TYPES = ['breakfast', 'lunch', 'dinner']

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max)
}

/**
 * 校验并整理菜品规格配置。
 * @param {Array<object>} specs 原始规格
 * @returns {Array<object>} 安全规格
 */
function normalizeSpecs(specs) {
  if (!Array.isArray(specs)) return []
  if (specs.length > 6) throw Object.assign(new Error('每道菜最多设置 6 组规格'), { code: 'INVALID_INPUT' })
  const seenNames = new Set()
  return specs.map((spec, index) => {
    const name = cleanText(spec.name, 12)
    const type = spec.type
    const options = Array.isArray(spec.options)
      ? [...new Set(spec.options.map(item => cleanText(item, 12)).filter(Boolean))]
      : []
    if (!name || !['single', 'multiple'].includes(type) || !options.length || options.length > 12) {
      throw Object.assign(new Error(`第 ${index + 1} 组规格填写不完整`), { code: 'INVALID_INPUT' })
    }
    if (seenNames.has(name)) throw Object.assign(new Error(`规格名称“${name}”重复了`), { code: 'INVALID_INPUT' })
    seenNames.add(name)
    return { name, type, required: Boolean(spec.required), options }
  })
}

/**
 * 校验菜品表单并转换价格为整数分。
 * @param {object} payload 菜品表单
 * @returns {object} 安全菜品数据
 */
function normalizeDish(payload) {
  const name = cleanText(payload.name, 30)
  const description = cleanText(payload.description, 200)
  const categoryId = cleanText(payload.categoryId, 80)
  const imageFileId = cleanText(payload.imageFileId, 500)
  const priceCents = Math.round(Number(payload.priceCents))
  if (!name || !categoryId || !Number.isInteger(priceCents) || priceCents < 0 || priceCents > 999999) {
    throw Object.assign(new Error('请正确填写菜名、分类和参考价格'), { code: 'INVALID_INPUT' })
  }
  return { name, description, categoryId, imageFileId, priceCents, specs: normalizeSpecs(payload.specs) }
}

/**
 * 校验餐次日期与类型。
 * @param {string} date 日期
 * @param {string} mealType 餐次类型
 */
function assertMealKey(date, mealType) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || !MEAL_TYPES.includes(mealType)) {
    throw Object.assign(new Error('请选择正确的日期和餐次'), { code: 'INVALID_INPUT' })
  }
}

module.exports = { MEAL_TYPES, normalizeSpecs, normalizeDish, assertMealKey }
