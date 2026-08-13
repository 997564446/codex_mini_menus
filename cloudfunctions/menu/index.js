const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const { normalizeDish, assertMealKey } = require('./domain')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function ok(data, requestId) { return { ok: true, data, error: null, requestId } }
function fail(code, message, requestId) { return { ok: false, data: null, error: { code, message }, requestId } }
function cleanText(value, max) { return String(value || '').trim().slice(0, max) }

async function getDocument(collection, id) {
  try { return (await db.collection(collection).doc(id).get()).data } catch (error) {
    if (String(error.errMsg || error.message).includes('does not exist')) return null
    throw error
  }
}

async function requireUser(openid, role) {
  const user = await getDocument('users', openid)
  if (!user || user.status !== 'active' || !user.familyId || (role && user.role !== role)) {
    throw Object.assign(new Error(role === 'chef' ? '只有厨师可以管理菜单' : '请先加入家庭'), { code: 'FORBIDDEN' })
  }
  return user
}

/**
 * 获取或创建家庭的系统“未分类”分类。
 * @param {string} familyId 家庭标识
 * @returns {Promise<object>} 默认分类
 */
async function ensureDefaultCategory(familyId) {
  const categoryId = `uncat_${crypto.createHash('sha256').update(familyId).digest('hex').slice(0, 24)}`
  const existing = await getDocument('categories', categoryId)
  if (existing) return existing
  const now = db.serverDate()
  const data = {
    familyId,
    name: '未分类',
    isDefault: true,
    sort: 9999999999999,
    createdAt: now,
    updatedAt: now
  }
  await db.collection('categories').doc(categoryId).set({ data })
  return { _id: categoryId, ...data }
}

async function getDishesByIds(familyId, ids) {
  const uniqueIds = [...new Set(ids)].slice(0, 60)
  const result = []
  for (let index = 0; index < uniqueIds.length; index += 20) {
    const part = uniqueIds.slice(index, index + 20)
    const response = await db.collection('dishes').where({ familyId, _id: _.in(part) }).get()
    result.push(...response.data)
  }
  return result
}

/**
 * 返回厨师的分类与菜品库。
 * @param {string} openid 厨师微信标识
 * @returns {Promise<object>} 菜品库
 */
async function chefCatalog(openid) {
  const chef = await requireUser(openid, 'chef')
  await ensureDefaultCategory(chef.familyId)
  const [categories, dishes] = await Promise.all([
    db.collection('categories').where({ familyId: chef.familyId }).orderBy('sort', 'asc').get(),
    db.collection('dishes').where({ familyId: chef.familyId }).orderBy('updatedAt', 'desc').get()
  ])
  return { categories: categories.data, dishes: dishes.data }
}

/**
 * 新建或重命名菜品分类。
 * @param {string} openid 厨师微信标识
 * @param {object} payload 分类表单
 * @returns {Promise<object>} 分类数据
 */
async function saveCategory(openid, payload) {
  const chef = await requireUser(openid, 'chef')
  const name = cleanText(payload.name, 16)
  if (!name) throw Object.assign(new Error('分类名称不能为空'), { code: 'INVALID_INPUT' })
  const now = db.serverDate()
  if (payload.categoryId) {
    const existing = await getDocument('categories', payload.categoryId)
    if (!existing || existing.familyId !== chef.familyId) throw Object.assign(new Error('分类不存在'), { code: 'NOT_FOUND' })
    if (existing.isDefault) throw Object.assign(new Error('“未分类”是系统默认分类，不能修改'), { code: 'INVALID_INPUT' })
    await db.collection('categories').doc(existing._id).update({ data: { name, updatedAt: now } })
    return { _id: existing._id, name }
  }
  const result = await db.collection('categories').add({
    data: { familyId: chef.familyId, name, sort: Number(payload.sort || Date.now()), createdAt: now, updatedAt: now }
  })
  return { _id: result._id, name }
}

/**
 * 删除分类，并把其中的菜品自动移入系统“未分类”。
 * @param {string} openid 厨师微信标识
 * @param {object} payload 分类标识
 * @returns {Promise<object>} 删除结果
 */
async function deleteCategory(openid, payload) {
  const chef = await requireUser(openid, 'chef')
  const categoryId = cleanText(payload.categoryId, 80)
  if (!categoryId) throw Object.assign(new Error('请选择要删除的分类'), { code: 'INVALID_INPUT' })
  const existing = await getDocument('categories', categoryId)
  if (!existing || existing.familyId !== chef.familyId) throw Object.assign(new Error('分类不存在'), { code: 'NOT_FOUND' })
  if (existing.isDefault) throw Object.assign(new Error('“未分类”是系统默认分类，不能删除'), { code: 'INVALID_INPUT' })
  const defaultCategory = await ensureDefaultCategory(chef.familyId)
  await db.collection('dishes').where({ familyId: chef.familyId, categoryId }).update({
    data: { categoryId: defaultCategory._id, version: _.inc(1), updatedAt: db.serverDate() }
  })
  await db.collection('categories').doc(existing._id).remove()
  return { categoryId: existing._id, fallbackCategoryId: defaultCategory._id }
}

/**
 * 新建或修改菜品，版本号用于避免多人并发覆盖。
 * @param {string} openid 厨师微信标识
 * @param {object} payload 菜品表单
 * @returns {Promise<object>} 菜品标识与版本
 */
async function saveDish(openid, payload) {
  const chef = await requireUser(openid, 'chef')
  const normalized = normalizeDish(payload)
  const category = await getDocument('categories', normalized.categoryId)
  if (!category || category.familyId !== chef.familyId) throw Object.assign(new Error('菜品分类不存在'), { code: 'INVALID_INPUT' })
  const now = db.serverDate()
  if (payload.dishId) {
    const dish = await getDocument('dishes', payload.dishId)
    if (!dish || dish.familyId !== chef.familyId) throw Object.assign(new Error('菜品不存在'), { code: 'NOT_FOUND' })
    if (Number(payload.version) !== Number(dish.version)) throw Object.assign(new Error('菜品已被修改，请刷新后重试'), { code: 'CONFLICT' })
    const update = await db.collection('dishes').where({ _id: dish._id, familyId: chef.familyId, version: dish.version }).update({
      data: { ...normalized, version: _.inc(1), updatedAt: now }
    })
    if (!update.stats.updated) throw Object.assign(new Error('菜品已被修改，请刷新后重试'), { code: 'CONFLICT' })
    return { _id: dish._id, version: dish.version + 1 }
  }
  const result = await db.collection('dishes').add({
    data: { ...normalized, familyId: chef.familyId, enabled: true, version: 1, createdAt: now, updatedAt: now }
  })
  return { _id: result._id, version: 1 }
}

/**
 * 上架或下架菜品，不修改历史订单快照。
 * @param {string} openid 厨师微信标识
 * @param {object} payload 菜品与目标状态
 * @returns {Promise<object>} 更新结果
 */
async function setDishEnabled(openid, payload) {
  const chef = await requireUser(openid, 'chef')
  const dish = await getDocument('dishes', cleanText(payload.dishId, 80))
  if (!dish || dish.familyId !== chef.familyId) throw Object.assign(new Error('菜品不存在'), { code: 'NOT_FOUND' })
  await db.collection('dishes').doc(dish._id).update({ data: { enabled: Boolean(payload.enabled), updatedAt: db.serverDate() } })
  return { dishId: dish._id, enabled: Boolean(payload.enabled) }
}

/**
 * 返回厨师近期餐次菜单。
 * @param {string} openid 厨师微信标识
 * @param {object} payload 日期范围
 * @returns {Promise<Array<object>>} 餐次列表
 */
async function chefMeals(openid, payload) {
  const chef = await requireUser(openid, 'chef')
  const start = cleanText(payload.startDate || '0000-00-00', 10)
  const end = cleanText(payload.endDate || '9999-99-99', 10)
  const result = await db.collection('meal_menus').where({
    familyId: chef.familyId,
    date: _.gte(start).and(_.lte(end))
  }).orderBy('date', 'asc').get()
  return result.data
}

/**
 * 新建或修改具体日期餐次菜单。
 * @param {string} openid 厨师微信标识
 * @param {object} payload 餐次表单
 * @returns {Promise<object>} 餐次结果
 */
async function saveMeal(openid, payload) {
  const chef = await requireUser(openid, 'chef')
  const date = cleanText(payload.date, 10)
  const mealType = cleanText(payload.mealType, 12)
  assertMealKey(date, mealType)
  const dishIds = [...new Set(Array.isArray(payload.dishIds) ? payload.dishIds.map(id => cleanText(id, 80)).filter(Boolean) : [])]
  if (!dishIds.length || dishIds.length > 60) throw Object.assign(new Error('每餐请选择 1 至 60 道菜'), { code: 'INVALID_INPUT' })
  const dishes = await getDishesByIds(chef.familyId, dishIds)
  if (dishes.length !== dishIds.length || dishes.some(dish => !dish.enabled)) {
    throw Object.assign(new Error('餐次中包含不存在或已下架的菜品'), { code: 'INVALID_INPUT' })
  }
  const now = db.serverDate()
  if (payload.mealMenuId) {
    const existing = await getDocument('meal_menus', cleanText(payload.mealMenuId, 80))
    if (!existing || existing.familyId !== chef.familyId) throw Object.assign(new Error('餐次不存在'), { code: 'NOT_FOUND' })
    if (Number(payload.version) !== Number(existing.version)) throw Object.assign(new Error('餐次已被修改，请刷新后重试'), { code: 'CONFLICT' })
    const duplicateResult = await db.collection('meal_menus').where({
      familyId: chef.familyId,
      date,
      mealType,
      _id: _.neq(existing._id)
    }).limit(1).get()
    if (duplicateResult.data.length) throw Object.assign(new Error('这个日期和餐次已经安排过菜单'), { code: 'CONFLICT' })
    const update = await db.collection('meal_menus').where({ _id: existing._id, familyId: chef.familyId, version: existing.version }).update({
      data: { date, mealType, dishIds, version: _.inc(1), updatedAt: now }
    })
    if (!update.stats.updated) throw Object.assign(new Error('餐次已被修改，请刷新后重试'), { code: 'CONFLICT' })
    return { _id: existing._id, version: existing.version + 1, status: existing.status }
  }
  const duplicateResult = await db.collection('meal_menus').where({ familyId: chef.familyId, date, mealType }).limit(1).get()
  if (duplicateResult.data.length) throw Object.assign(new Error('这个日期和餐次已经安排过菜单'), { code: 'CONFLICT' })
  const result = await db.collection('meal_menus').add({
    data: { familyId: chef.familyId, date, mealType, dishIds, status: 'draft', version: 1, createdAt: now, updatedAt: now }
  })
  return { _id: result._id, version: 1, status: 'draft' }
}

/**
 * 手动开放或关闭餐次菜单。
 * @param {string} openid 厨师微信标识
 * @param {object} payload 餐次与目标状态
 * @returns {Promise<object>} 更新结果
 */
async function setMealStatus(openid, payload) {
  const chef = await requireUser(openid, 'chef')
  const status = payload.status
  if (!['open', 'closed'].includes(status)) throw Object.assign(new Error('餐次状态不正确'), { code: 'INVALID_INPUT' })
  const meal = await getDocument('meal_menus', cleanText(payload.mealMenuId, 80))
  if (!meal || meal.familyId !== chef.familyId) throw Object.assign(new Error('餐次不存在'), { code: 'NOT_FOUND' })
  if (status === 'open' && (!meal.dishIds || !meal.dishIds.length)) throw Object.assign(new Error('请先安排菜品'), { code: 'INVALID_INPUT' })
  await db.collection('meal_menus').doc(meal._id).update({
    data: { status, version: _.inc(1), updatedAt: db.serverDate() }
  })
  return { mealMenuId: meal._id, status, version: meal.version + 1 }
}

/**
 * 返回已审批食客可点的开放餐次与菜品详情。
 * @param {string} openid 食客微信标识
 * @param {object} payload 日期范围
 * @returns {Promise<Array<object>>} 开放菜单
 */
async function openMeals(openid, payload) {
  const diner = await requireUser(openid, 'diner')
  const start = cleanText(payload.startDate, 10)
  const end = cleanText(payload.endDate, 10)
  const result = await db.collection('meal_menus').where({
    familyId: diner.familyId,
    status: 'open',
    date: _.gte(start).and(_.lte(end))
  }).orderBy('date', 'asc').get()
  const allDishIds = result.data.flatMap(meal => meal.dishIds || [])
  const dishes = await getDishesByIds(diner.familyId, allDishIds)
  const dishMap = Object.fromEntries(dishes.map(dish => [dish._id, dish]))
  return result.data.map(meal => ({ ...meal, dishes: meal.dishIds.map(id => dishMap[id]).filter(Boolean) }))
}

/**
 * 返回单个餐次详情，食客只能查看开放菜单，厨师可查看本家庭任意菜单。
 * @param {string} openid 当前微信标识
 * @param {object} payload 餐次标识
 * @returns {Promise<object>} 餐次与菜品
 */
async function mealDetail(openid, payload) {
  const user = await requireUser(openid)
  const meal = await getDocument('meal_menus', cleanText(payload.mealMenuId, 80))
  if (!meal || meal.familyId !== user.familyId || (user.role === 'diner' && meal.status !== 'open')) {
    throw Object.assign(new Error('餐次不存在或已经关闭'), { code: 'NOT_FOUND' })
  }
  const dishes = await getDishesByIds(user.familyId, meal.dishIds || [])
  const dishMap = Object.fromEntries(dishes.map(dish => [dish._id, dish]))
  return { ...meal, dishes: meal.dishIds.map(id => dishMap[id]).filter(Boolean) }
}

/**
 * 菜单云函数统一入口。
 * @param {object} event 请求动作与数据
 * @param {object} context 云函数调用上下文
 * @returns {Promise<object>} 统一接口响应
 */
exports.main = async (event = {}, context = {}) => {
  const requestId = context.requestId || crypto.randomUUID()
  const { OPENID: openid } = cloud.getWXContext()
  try {
    const payload = event.payload || {}
    let data
    switch (event.action) {
      case 'chefCatalog': data = await chefCatalog(openid); break
      case 'saveCategory': data = await saveCategory(openid, payload); break
      case 'deleteCategory': data = await deleteCategory(openid, payload); break
      case 'saveDish': data = await saveDish(openid, payload); break
      case 'setDishEnabled': data = await setDishEnabled(openid, payload); break
      case 'chefMeals': data = await chefMeals(openid, payload); break
      case 'saveMeal': data = await saveMeal(openid, payload); break
      case 'setMealStatus': data = await setMealStatus(openid, payload); break
      case 'openMeals': data = await openMeals(openid, payload); break
      case 'mealDetail': data = await mealDetail(openid, payload); break
      default: throw Object.assign(new Error('未知菜单接口'), { code: 'NOT_FOUND' })
    }
    return ok(data, requestId)
  } catch (error) {
    console.error('menu failed', requestId, error)
    return fail(error.code || 'INTERNAL_ERROR', error.code ? error.message : '菜单服务暂时不可用', requestId)
  }
}
