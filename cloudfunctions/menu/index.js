const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const {
  WEEKDAY_LABELS,
  MEAL_TYPES,
  normalizeDishSettings,
  normalizeCategoryChanges,
  normalizeCategoryOrder,
  assertWeeklyMenu,
  assertMealType,
  assertMealDishCategories
} = require('./domain')
const PRESET_DISHES = require('./preset-dishes')
const PRESET_DISH_VERSION = '1.2.2-5'

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
  if (existing) {
    if (existing.systemType !== 'uncategorized' || existing.sort !== 9999999999999) {
      await db.collection('categories').doc(categoryId).update({
        data: { systemType: 'uncategorized', isDefault: true, sort: 9999999999999, updatedAt: db.serverDate() }
      })
    }
    return { ...existing, systemType: 'uncategorized', isDefault: true, sort: 9999999999999 }
  }
  const now = db.serverDate()
  const data = {
    familyId,
    name: '未分类',
    isDefault: true,
    systemType: 'uncategorized',
    sort: 9999999999999,
    createdAt: now,
    updatedAt: now
  }
  await db.collection('categories').doc(categoryId).set({ data })
  return { _id: categoryId, ...data }
}

/**
 * 获取或创建家庭的系统“主食”分类。
 * @param {string} familyId 家庭标识
 * @returns {Promise<object>} 主食分类
 */
async function ensureStapleCategory(familyId) {
  const categoryId = `staple_${crypto.createHash('sha256').update(familyId).digest('hex').slice(0, 24)}`
  const existing = await getDocument('categories', categoryId)
  const sort = 9999999999998
  if (existing) {
    if (existing.name !== '主食' || existing.systemType !== 'staple' || existing.sort !== sort) {
      await db.collection('categories').doc(categoryId).update({
        data: { name: '主食', systemType: 'staple', isDefault: true, sort, updatedAt: db.serverDate() }
      })
    }
    return { ...existing, name: '主食', systemType: 'staple', isDefault: true, sort }
  }
  const now = db.serverDate()
  const data = { familyId, name: '主食', isDefault: true, systemType: 'staple', sort, createdAt: now, updatedAt: now }
  await db.collection('categories').doc(categoryId).set({ data })
  return { _id: categoryId, ...data }
}

/**
 * 获取或创建主食分类中的“不要主食”系统菜品。
 * @param {string} familyId 家庭标识
 * @param {string} categoryId 主食分类标识
 * @returns {Promise<object>} 不要主食菜品
 */
async function ensureNoStapleDish(familyId, categoryId) {
  const dishId = `no_staple_${crypto.createHash('sha256').update(familyId).digest('hex').slice(0, 24)}`
  const existing = await getDocument('dishes', dishId)
  const now = db.serverDate()
  if (existing) {
    const expected = {
      name: '不要主食',
      presetName: '不要主食',
      isPreset: true,
      isSystemDish: true,
      systemDishType: 'no_staple',
      categoryId,
      priceCents: 0,
      stockUnlimited: true,
      stock: 0,
      enabled: true,
      deletedAt: null,
      sort: -1
    }
    const updates = Object.fromEntries(Object.entries(expected).filter(([key, value]) => existing[key] !== value))
    if (Object.keys(updates).length) {
      updates.updatedAt = now
      await db.collection('dishes').doc(dishId).update({ data: updates })
    }
    return { ...existing, ...expected }
  }
  const data = {
    familyId,
    name: '不要主食',
    presetName: '不要主食',
    isPreset: true,
    isSystemDish: true,
    systemDishType: 'no_staple',
    categoryId,
    description: '',
    imageFileId: '',
    priceCents: 0,
    specs: [],
    stockUnlimited: true,
    stock: 0,
    enabled: true,
    sort: -1,
    version: 1,
    createdAt: now,
    updatedAt: now
  }
  await db.collection('dishes').doc(dishId).set({ data })
  return { _id: dishId, ...data }
}

/**
 * 按当前版本重新初始化家庭预置菜品；只在版本变化时重置分类、库存和单价。
 * @param {string} familyId 家庭标识
 * @param {string} categoryId 默认分类标识
 */
async function ensurePresetDishes(familyId, categoryId) {
  const result = await db.collection('dishes').where({ familyId }).limit(100).get()
  const byName = new Map(result.data.map(dish => [String(dish.name || '').trim().toLowerCase(), dish]))
  const presetNames = new Set(PRESET_DISHES.map(dish => dish.name.toLowerCase()))
  const tasks = PRESET_DISHES.map((preset, sort) => async () => {
    const { name, priceCents, stockUnlimited, stock } = preset
    const key = name.toLowerCase()
    const existing = byName.get(key)
    const now = db.serverDate()
    if (existing) {
      const updates = {}
      if (existing.presetVersion !== PRESET_DISH_VERSION) {
        Object.assign(updates, {
          name,
          presetName: name,
          presetVersion: PRESET_DISH_VERSION,
          isPreset: true,
          categoryId,
          priceCents,
          stockUnlimited,
          stock,
          enabled: true,
          deletedAt: null,
          sort,
          version: Number.isInteger(existing.version) ? _.inc(1) : 1
        })
      } else {
        if (!existing.isPreset) updates.isPreset = true
        if (existing.presetName !== name) updates.presetName = name
        if (!existing.enabled && !existing.deletedAt) updates.enabled = true
        if (typeof existing.stockUnlimited !== 'boolean') updates.stockUnlimited = stockUnlimited
        if (!Number.isInteger(existing.stock)) updates.stock = stock
        if (!Number.isInteger(existing.priceCents)) updates.priceCents = priceCents
        if (!Number.isInteger(existing.sort)) updates.sort = sort
        if (!Number.isInteger(existing.version)) updates.version = 1
      }
      if (Object.keys(updates).length) {
        updates.updatedAt = now
        await db.collection('dishes').doc(existing._id).update({ data: updates })
      }
      return
    }
    const dishId = `dish_${crypto.createHash('sha256').update(`${familyId}|${key}`).digest('hex').slice(0, 24)}`
    await db.collection('dishes').doc(dishId).set({
      data: {
        familyId,
        name,
        presetName: name,
        presetVersion: PRESET_DISH_VERSION,
        isPreset: true,
        categoryId,
        description: '',
        imageFileId: '',
        priceCents,
        specs: [],
        stockUnlimited,
        stock,
        enabled: true,
        sort,
        version: 1,
        createdAt: now,
        updatedAt: now
      }
    })
  })
  for (let index = 0; index < tasks.length; index += 10) await Promise.all(tasks.slice(index, index + 10).map(task => task()))
  const obsoletePresets = result.data.filter(dish => dish.isPreset && !dish.isSystemDish
    && !presetNames.has(String(dish.presetName || dish.name || '').trim().toLowerCase())
    && dish.enabled !== false && !dish.deletedAt)
  for (const dish of obsoletePresets) {
    await db.collection('dishes').doc(dish._id).update({
      data: {
        enabled: false,
        deletedAt: db.serverDate(),
        version: Number.isInteger(dish.version) ? _.inc(1) : 1,
        updatedAt: db.serverDate()
      }
    })
  }
}

/**
 * 返回日期对应的星期序号，周一为 1、周日为 7。
 * @param {string} date YYYY-MM-DD 日期
 * @returns {number} 星期序号
 */
function weekdayOf(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Object.assign(new Error('请选择正确日期'), { code: 'INVALID_INPUT' })
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw Object.assign(new Error('请选择正确日期'), { code: 'INVALID_INPUT' })
  }
  const day = parsed.getUTCDay()
  return day || 7
}

/**
 * 为家庭建立周一至周日、早餐中餐晚餐共 21 份固定菜单。
 * @param {string} familyId 家庭标识
 * @returns {Promise<Array<object>>} 星期菜单
 */
async function ensureWeeklyMenus(familyId) {
  const stapleCategory = await ensureStapleCategory(familyId)
  const noStapleDish = await ensureNoStapleDish(familyId, stapleCategory._id)
  const existingResult = await db.collection('meal_menus').where({ familyId, weekly: true }).limit(100).get()
  const legacyMenus = existingResult.data.filter(menu => !MEAL_TYPES[menu.mealType])
  for (const legacy of legacyMenus) {
    await db.collection('meal_menus').doc(legacy._id).update({
      data: { weekly: false, migratedVersion: '1.2.2', dishIds: [], updatedAt: db.serverDate() }
    })
  }
  const activeMenus = existingResult.data.filter(menu => MEAL_TYPES[menu.mealType])
  const existingMap = new Map(activeMenus.map(menu => [`${Number(menu.weekday)}|${menu.mealType}`, menu]))
  const familyKey = crypto.createHash('sha256').update(familyId).digest('hex').slice(0, 20)
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    for (const [mealType, config] of Object.entries(MEAL_TYPES)) {
      if (existingMap.has(`${weekday}|${mealType}`)) continue
      const menuId = `weekly_${familyKey}_${weekday}_${mealType}`
      const now = db.serverDate()
      await db.collection('meal_menus').doc(menuId).set({
        data: {
          familyId,
          weekly: true,
          weekday,
          weekdayLabel: WEEKDAY_LABELS[weekday],
          mealType,
          mealTypeLabel: config.label,
          dishIds: [noStapleDish._id],
          status: 'open',
          version: 1,
          createdAt: now,
          updatedAt: now
        }
      })
    }
  }
  const result = await db.collection('meal_menus').where({ familyId, weekly: true }).orderBy('weekday', 'asc').limit(100).get()
  return result.data.sort((left, right) => Number(left.weekday) - Number(right.weekday)
    || Object.keys(MEAL_TYPES).indexOf(left.mealType) - Object.keys(MEAL_TYPES).indexOf(right.mealType))
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
  const defaultCategory = await ensureDefaultCategory(chef.familyId)
  const stapleCategory = await ensureStapleCategory(chef.familyId)
  await Promise.all([
    ensurePresetDishes(chef.familyId, defaultCategory._id),
    ensureNoStapleDish(chef.familyId, stapleCategory._id)
  ])
  const [categories, dishes] = await Promise.all([
    db.collection('categories').where({ familyId: chef.familyId }).orderBy('sort', 'asc').get(),
    db.collection('dishes').where({ familyId: chef.familyId }).orderBy('updatedAt', 'desc').get()
  ])
  return {
    categories: categories.data.sort((left, right) => Number(left.sort) - Number(right.sort)),
    dishes: dishes.data
      .filter(dish => dish.enabled !== false && !dish.deletedAt)
      .sort((left, right) => (Number.isFinite(Number(left.sort)) ? Number(left.sort) : 9999)
        - (Number.isFinite(Number(right.sort)) ? Number(right.sort) : 9999)
        || left.name.localeCompare(right.name, 'zh-CN'))
  }
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
  if (['未分类', '主食'].includes(name)) throw Object.assign(new Error('该名称由系统分类使用'), { code: 'INVALID_INPUT' })
  const now = db.serverDate()
  if (payload.categoryId) {
    const existing = await getDocument('categories', payload.categoryId)
    if (!existing || existing.familyId !== chef.familyId) throw Object.assign(new Error('分类不存在'), { code: 'NOT_FOUND' })
    if (existing.isDefault) throw Object.assign(new Error('系统默认分类不能修改'), { code: 'INVALID_INPUT' })
    await db.collection('categories').doc(existing._id).update({ data: { name, updatedAt: now } })
    return { _id: existing._id, name }
  }
  const result = await db.collection('categories').add({
    data: { familyId: chef.familyId, name, sort: Number(payload.sort || Date.now()), createdAt: now, updatedAt: now }
  })
  return { _id: result._id, name }
}

/**
 * 保存厨师拖动后的自定义分类顺序，系统分类始终固定在底部。
 * @param {string} openid 厨师微信标识
 * @param {object} payload 自定义分类标识顺序
 * @returns {Promise<object>} 保存数量
 */
async function saveCategoryOrder(openid, payload) {
  const chef = await requireUser(openid, 'chef')
  const categoryIds = normalizeCategoryOrder(payload.categoryIds)
  const result = await db.collection('categories').where({ familyId: chef.familyId }).limit(100).get()
  const customCategories = result.data.filter(category => !category.isDefault)
  if (categoryIds.length !== customCategories.length || categoryIds.some(id => !customCategories.some(category => category._id === id))) {
    throw Object.assign(new Error('分类已经变化，请刷新后重试'), { code: 'CONFLICT' })
  }
  const transaction = await db.startTransaction()
  try {
    const now = db.serverDate()
    for (let index = 0; index < categoryIds.length; index += 1) {
      await transaction.collection('categories').doc(categoryIds[index]).update({ data: { sort: index + 1, updatedAt: now } })
    }
    await transaction.commit()
    return { updated: categoryIds.length }
  } catch (error) {
    await transaction.rollback().catch(() => {})
    throw error
  }
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
  if (existing.isDefault) throw Object.assign(new Error('系统默认分类不能删除'), { code: 'INVALID_INPUT' })
  const defaultCategory = await ensureDefaultCategory(chef.familyId)
  await db.collection('dishes').where({ familyId: chef.familyId, categoryId }).update({
    data: { categoryId: defaultCategory._id, version: _.inc(1), updatedAt: db.serverDate() }
  })
  await db.collection('categories').doc(existing._id).remove()
  return { categoryId: existing._id, fallbackCategoryId: defaultCategory._id }
}

/**
 * 在事务中分批更新菜品分类，减少逐条写入造成的云函数超时风险。
 * @param {object} transaction 数据库事务
 * @param {string} familyId 家庭标识
 * @param {Array<object>} dishes 待更新菜品
 * @param {string} categoryId 目标分类标识
 * @param {object} now 服务端时间
 * @returns {Promise<number>} 更新数量
 */
async function updateDishCategories(transaction, familyId, dishes, categoryId, now) {
  let updated = 0
  for (let index = 0; index < dishes.length; index += 20) {
    const part = dishes.slice(index, index + 20)
    const result = await transaction.collection('dishes').where({
      familyId,
      _id: _.in(part.map(dish => dish._id))
    }).update({
      data: { categoryId, version: _.inc(1), updatedAt: now }
    })
    if (result.stats.updated !== part.length) {
      throw Object.assign(new Error('菜品库存或分类已经变化，请刷新后重试'), { code: 'CONFLICT' })
    }
    updated += result.stats.updated
  }
  return updated
}

/**
 * 按用户明确勾选或取消的增量变更调整分类，未提交的菜品保持原分类。
 * @param {string} openid 厨师微信标识
 * @param {object} payload 分类、移入/移出菜品和菜品版本
 * @returns {Promise<object>} 批量归类结果
 */
async function batchSetCategory(openid, payload) {
  const chef = await requireUser(openid, 'chef')
  const categoryId = cleanText(payload.categoryId, 80)
  const category = await getDocument('categories', categoryId)
  if (!category || category.familyId !== chef.familyId) throw Object.assign(new Error('分类不存在'), { code: 'NOT_FOUND' })
  if (category.systemType === 'uncategorized') throw Object.assign(new Error('“未分类”由系统自动管理'), { code: 'INVALID_INPUT' })
  const { addDishIds, removeDishIds } = normalizeCategoryChanges(payload.addDishIds, payload.removeDishIds)
  const versions = payload.versions && typeof payload.versions === 'object' ? payload.versions : {}
  const defaultCategory = await ensureDefaultCategory(chef.familyId)
  const transaction = await db.startTransaction()
  try {
    const result = await transaction.collection('dishes').where({ familyId: chef.familyId }).limit(100).get()
    const dishes = result.data.filter(dish => dish.enabled !== false && !dish.deletedAt)
    const dishMap = new Map(dishes.map(dish => [dish._id, dish]))
    const changedIds = [...addDishIds, ...removeDishIds]
    if (changedIds.some(id => !dishMap.has(id))) throw Object.assign(new Error('批量归类包含不存在的菜品'), { code: 'INVALID_INPUT' })
    if (changedIds.some(id => dishMap.get(id).isSystemDish)) {
      throw Object.assign(new Error('系统菜品不能移动分类'), { code: 'INVALID_INPUT' })
    }
    const movingIn = addDishIds.map(id => dishMap.get(id))
    const movingOut = removeDishIds.map(id => dishMap.get(id))
    if (movingIn.some(dish => dish.categoryId !== defaultCategory._id)
      || movingOut.some(dish => dish.categoryId !== categoryId)) {
      throw Object.assign(new Error('菜品分类已经变化，请刷新后重试'), { code: 'CONFLICT' })
    }
    const affected = [...movingIn, ...movingOut]
    if (affected.some(dish => Number(versions[dish._id]) !== Number(dish.version))) {
      throw Object.assign(new Error('菜品库存或分类已经变化，请刷新后重试'), { code: 'CONFLICT' })
    }
    const now = db.serverDate()
    const updated = await updateDishCategories(transaction, chef.familyId, movingIn, categoryId, now)
      + await updateDishCategories(transaction, chef.familyId, movingOut, defaultCategory._id, now)
    await transaction.commit()
    return { categoryId, added: movingIn.length, removed: movingOut.length, updated }
  } catch (error) {
    await transaction.rollback().catch(() => {})
    throw error
  }
}

/**
 * 新增自定义菜品或修改已有菜品的分类、库存和单价。
 * @param {string} openid 厨师微信标识
 * @param {object} payload 菜品表单
 * @returns {Promise<object>} 菜品标识与版本
 */
async function saveDish(openid, payload) {
  const chef = await requireUser(openid, 'chef')
  const dishId = cleanText(payload.dishId, 80)
  if (!dishId) {
    const name = cleanText(payload.name, 30)
    if (!name) throw Object.assign(new Error('请输入菜品名称'), { code: 'INVALID_INPUT' })
    const defaultCategory = await ensureDefaultCategory(chef.familyId)
    const normalized = normalizeDishSettings({ ...payload, categoryId: defaultCategory._id })
    const existing = await db.collection('dishes').where({ familyId: chef.familyId }).limit(100).get()
    const sameName = existing.data.find(dish => String(dish.name).trim().toLowerCase() === name.toLowerCase())
    if (sameName && sameName.enabled !== false && !sameName.deletedAt) {
      throw Object.assign(new Error('已经有同名菜品'), { code: 'CONFLICT' })
    }
    const now = db.serverDate()
    if (sameName) {
      await db.collection('dishes').doc(sameName._id).update({
        data: { name, ...normalized, enabled: true, deletedAt: null, version: _.inc(1), updatedAt: now }
      })
      return { _id: sameName._id, version: Number(sameName.version || 0) + 1 }
    }
    const result = await db.collection('dishes').add({
      data: {
        familyId: chef.familyId,
        name,
        isPreset: false,
        categoryId: defaultCategory._id,
        description: '',
        imageFileId: '',
        specs: [],
        ...normalized,
        enabled: true,
        sort: Date.now(),
        version: 1,
        createdAt: now,
        updatedAt: now
      }
    })
    return { _id: result._id, version: 1 }
  }
  const normalized = normalizeDishSettings(payload)
  const category = await getDocument('categories', normalized.categoryId)
  if (!category || category.familyId !== chef.familyId) throw Object.assign(new Error('菜品分类不存在'), { code: 'INVALID_INPUT' })
  const dish = await getDocument('dishes', dishId)
  if (!dish || dish.familyId !== chef.familyId || dish.enabled === false || dish.deletedAt) throw Object.assign(new Error('菜品不存在'), { code: 'NOT_FOUND' })
  if (dish.isSystemDish) throw Object.assign(new Error('系统菜品不能修改'), { code: 'INVALID_INPUT' })
  if (Number(payload.version) !== Number(dish.version)) throw Object.assign(new Error('菜品已被修改，请刷新后重试'), { code: 'CONFLICT' })
  const update = await db.collection('dishes').where({ _id: dish._id, familyId: chef.familyId, version: dish.version }).update({
    data: { ...normalized, enabled: true, version: _.inc(1), updatedAt: db.serverDate() }
  })
  if (!update.stats.updated) throw Object.assign(new Error('菜品已被修改，请刷新后重试'), { code: 'CONFLICT' })
  return { _id: dish._id, version: dish.version + 1 }
}

/**
 * 删除“未分类”中的菜品，并从尚未使用的星期菜单中移除。
 * @param {string} openid 厨师微信标识
 * @param {object} payload 菜品标识和版本
 * @returns {Promise<object>} 删除结果
 */
async function deleteDish(openid, payload) {
  const chef = await requireUser(openid, 'chef')
  const dish = await getDocument('dishes', cleanText(payload.dishId, 80))
  const defaultCategory = await ensureDefaultCategory(chef.familyId)
  if (!dish || dish.familyId !== chef.familyId || dish.enabled === false || dish.deletedAt) throw Object.assign(new Error('菜品不存在'), { code: 'NOT_FOUND' })
  if (dish.categoryId !== defaultCategory._id || dish.isSystemDish) {
    throw Object.assign(new Error('只能删除“未分类”中的菜品'), { code: 'INVALID_INPUT' })
  }
  if (Number(payload.version) !== Number(dish.version)) throw Object.assign(new Error('菜品已被修改，请刷新后重试'), { code: 'CONFLICT' })
  const transaction = await db.startTransaction()
  try {
    const now = db.serverDate()
    const updated = await transaction.collection('dishes').where({
      _id: dish._id,
      familyId: chef.familyId,
      version: dish.version
    }).update({ data: { enabled: false, deletedAt: now, version: _.inc(1), updatedAt: now } })
    if (!updated.stats.updated) throw Object.assign(new Error('菜品已被修改，请刷新后重试'), { code: 'CONFLICT' })
    const meals = await transaction.collection('meal_menus').where({ familyId: chef.familyId, weekly: true }).limit(100).get()
    for (const meal of meals.data.filter(item => (item.dishIds || []).includes(dish._id))) {
      await transaction.collection('meal_menus').doc(meal._id).update({
        data: { dishIds: meal.dishIds.filter(id => id !== dish._id), version: _.inc(1), updatedAt: now }
      })
    }
    await transaction.commit()
    return { dishId: dish._id }
  } catch (error) {
    await transaction.rollback().catch(() => {})
    throw error
  }
}

/**
 * 返回厨师的周一至周日固定菜单。
 * @param {string} openid 厨师微信标识
 * @returns {Promise<Array<object>>} 星期菜单
 */
async function chefMeals(openid) {
  const chef = await requireUser(openid, 'chef')
  return ensureWeeklyMenus(chef.familyId)
}

/**
 * 保存某一天的星期菜单，允许清空当天菜单。
 * @param {string} openid 厨师微信标识
 * @param {object} payload 菜单、星期、菜品和版本
 * @returns {Promise<object>} 菜单结果
 */
async function saveMeal(openid, payload) {
  const chef = await requireUser(openid, 'chef')
  const meal = await getDocument('meal_menus', cleanText(payload.mealMenuId, 80))
  if (!meal || meal.familyId !== chef.familyId || !meal.weekly) throw Object.assign(new Error('星期菜单不存在'), { code: 'NOT_FOUND' })
  const weekday = Number(meal.weekday)
  assertWeeklyMenu(weekday)
  assertMealType(meal.mealType)
  const dishIds = [...new Set(Array.isArray(payload.dishIds) ? payload.dishIds.map(id => cleanText(id, 80)).filter(Boolean) : [])]
  if (dishIds.length > 60) throw Object.assign(new Error('每餐最多选择 60 道菜'), { code: 'INVALID_INPUT' })
  const dishes = await getDishesByIds(chef.familyId, dishIds)
  const [defaultCategory, stapleCategory] = await Promise.all([
    ensureDefaultCategory(chef.familyId),
    ensureStapleCategory(chef.familyId)
  ])
  if (dishes.length !== dishIds.length) {
    throw Object.assign(new Error('菜单中包含不可用菜品'), { code: 'INVALID_INPUT' })
  }
  assertMealDishCategories(dishes, defaultCategory._id, stapleCategory._id)
  if (Number(payload.version) !== Number(meal.version)) throw Object.assign(new Error('菜单已被修改，请刷新后重试'), { code: 'CONFLICT' })
  const update = await db.collection('meal_menus').where({ _id: meal._id, familyId: chef.familyId, version: meal.version }).update({
    data: { dishIds, version: _.inc(1), updatedAt: db.serverDate() }
  })
  if (!update.stats.updated) throw Object.assign(new Error('菜单已被修改，请刷新后重试'), { code: 'CONFLICT' })
  return { _id: meal._id, weekday, mealType: meal.mealType, version: meal.version + 1 }
}

/**
 * 返回食客在具体日期可查看的星期菜单。
 * @param {string} openid 食客微信标识
 * @param {object} payload 具体日期
 * @returns {Promise<Array<object>>} 当天菜单
 */
async function openMeals(openid, payload) {
  const diner = await requireUser(openid, 'diner')
  const date = cleanText(payload.startDate, 10)
  const weekday = weekdayOf(date)
  const menus = await ensureWeeklyMenus(diner.familyId)
  const dayMenus = menus.filter(item => Number(item.weekday) === weekday)
  const dishIds = dayMenus.flatMap(meal => meal.dishIds || [])
  const [dishes, categoriesResult] = await Promise.all([
    getDishesByIds(diner.familyId, dishIds),
    db.collection('categories').where({ familyId: diner.familyId }).orderBy('sort', 'asc').get()
  ])
  const dishMap = Object.fromEntries(dishes.map(dish => [dish._id, dish]))
  const uncategorized = categoriesResult.data.find(category => category.systemType === 'uncategorized')
  return dayMenus.map(meal => ({
    ...meal,
    date,
    categories: categoriesResult.data.filter(category => category.systemType !== 'uncategorized'),
    dishes: meal.dishIds.map(id => dishMap[id]).filter(dish => dish && dish.enabled && !dish.deletedAt && (!uncategorized || dish.categoryId !== uncategorized._id))
  }))
}

/**
 * 返回星期菜单详情；食客必须同时提供本周的实际日期。
 * @param {string} openid 当前微信标识
 * @param {object} payload 菜单标识和实际日期
 * @returns {Promise<object>} 菜单与菜品
 */
async function mealDetail(openid, payload) {
  const user = await requireUser(openid)
  const meal = await getDocument('meal_menus', cleanText(payload.mealMenuId, 80))
  if (!meal || meal.familyId !== user.familyId || !meal.weekly) throw Object.assign(new Error('星期菜单不存在'), { code: 'NOT_FOUND' })
  assertMealType(meal.mealType)
  const date = cleanText(payload.date, 10)
  if (user.role === 'diner' && weekdayOf(date) !== Number(meal.weekday)) {
    throw Object.assign(new Error('日期与星期菜单不一致'), { code: 'INVALID_INPUT' })
  }
  const [dishes, categoriesResult] = await Promise.all([
    getDishesByIds(user.familyId, meal.dishIds || []),
    db.collection('categories').where({ familyId: user.familyId }).orderBy('sort', 'asc').get()
  ])
  const dishMap = Object.fromEntries(dishes.map(dish => [dish._id, dish]))
  const uncategorized = categoriesResult.data.find(category => category.systemType === 'uncategorized')
  return {
    ...meal,
    date,
    categories: categoriesResult.data.filter(category => category.systemType !== 'uncategorized'),
    dishes: meal.dishIds.map(id => dishMap[id]).filter(dish => dish && dish.enabled && !dish.deletedAt && (!uncategorized || dish.categoryId !== uncategorized._id))
  }
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
      case 'saveCategoryOrder': data = await saveCategoryOrder(openid, payload); break
      case 'deleteCategory': data = await deleteCategory(openid, payload); break
      case 'batchSetCategory': data = await batchSetCategory(openid, payload); break
      case 'saveDish': data = await saveDish(openid, payload); break
      case 'deleteDish': data = await deleteDish(openid, payload); break
      case 'chefMeals': data = await chefMeals(openid, payload); break
      case 'saveMeal': data = await saveMeal(openid, payload); break
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
