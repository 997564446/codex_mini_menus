const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const { assertTransition, validateSelectedSpecs, normalizeItems } = require('./domain')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const STATUS_LABELS = { pending: '待确认', confirmed: '已确认', cooking: '制作中', ready: '可取餐', completed: '已完成', cancelled: '已取消' }
const MEAL_TYPE_LABELS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' }

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
    throw Object.assign(new Error(role === 'chef' ? '只有厨师可以处理订单' : '请先加入家庭'), { code: 'FORBIDDEN' })
  }
  return user
}

async function getDishesByIds(familyId, ids) {
  const uniqueIds = [...new Set(ids)]
  const result = []
  for (let index = 0; index < uniqueIds.length; index += 20) {
    const response = await db.collection('dishes').where({ familyId, _id: _.in(uniqueIds.slice(index, index + 20)) }).get()
    result.push(...response.data)
  }
  return result
}

function snapshotItems(rawItems, dishes, meal) {
  const dishMap = Object.fromEntries(dishes.map(dish => [dish._id, dish]))
  const allowed = new Set(meal.dishIds || [])
  let totalCents = 0
  const items = rawItems.map(item => {
    const dish = dishMap[item.dishId]
    if (!dish || !dish.enabled || !allowed.has(dish._id)) {
      throw Object.assign(new Error('订单中有菜品已下架或不在当前菜单'), { code: 'INVALID_INPUT' })
    }
    const selectedSpecs = validateSelectedSpecs(dish.specs || [], item.selectedSpecs)
    const subtotalCents = dish.priceCents * item.quantity
    totalCents += subtotalCents
    return {
      dishId: dish._id,
      name: dish.name,
      imageFileId: dish.imageFileId || '',
      priceCents: dish.priceCents,
      quantity: item.quantity,
      subtotalCents,
      selectedSpecs,
      note: item.note
    }
  })
  return { items, totalCents }
}

async function createOrderNotification(transaction, familyId, chefId, orderId, dinerName, meal) {
  await transaction.collection('notifications').add({
    data: {
      familyId,
      recipientId: chefId,
      type: 'new_order',
      title: '收到一份新订单',
      content: `${dinerName} 点了 ${meal.date} 的家庭餐`,
      targetId: orderId,
      read: false,
      createdAt: db.serverDate()
    }
  })
}

async function sendChefSubscription(familyId, orderId, dinerName, meal, totalCents) {
  const [family, config] = await Promise.all([
    getDocument('families', familyId),
    getDocument('system_config', 'global')
  ])
  if (!family || !config || !config.chefOrderTemplateId) return
  const chef = await getDocument('users', family.chefId)
  if (!chef || !chef.chefSubscribeEnabled) return
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: family.chefId,
      page: `pages/order-detail/index?id=${orderId}`,
      lang: 'zh_CN',
      miniprogramState: config.miniprogramState || 'formal',
      templateId: config.chefOrderTemplateId,
      data: {
        // 微信模板 461：预约人、预约时间、预约项目、订单编号、备注。
        name1: { value: dinerName.slice(0, 10) },
        date3: { value: meal.date },
        thing13: { value: `${MEAL_TYPE_LABELS[meal.mealType] || '家庭餐'}点餐`.slice(0, 20) },
        character_string54: { value: orderId.slice(0, 32) },
        thing7: { value: `参考总额￥${(totalCents / 100).toFixed(2)}`.slice(0, 20) }
      }
    })
    await db.collection('users').doc(family.chefId).update({ data: { chefSubscribeEnabled: false, updatedAt: db.serverDate() } })
    await db.collection('notification_logs').add({
      data: { familyId, recipientId: family.chefId, targetId: orderId, channel: 'subscribe', status: 'sent', createdAt: db.serverDate() }
    })
  } catch (error) {
    console.error('subscribe message failed', orderId, error)
    await db.collection('notification_logs').add({
      data: {
        familyId,
        recipientId: family.chefId,
        targetId: orderId,
        channel: 'subscribe',
        status: 'failed',
        errorCode: cleanText(error.errCode || error.code, 40),
        errorMessage: cleanText(error.errMsg || error.message, 200),
        createdAt: db.serverDate()
      }
    }).catch(() => {})
  }
}

/**
 * 创建或修改食客在某餐次的唯一订单。
 * @param {string} openid 食客微信标识
 * @param {object} payload 餐次、条目、幂等键和版本
 * @returns {Promise<object>} 订单摘要
 */
async function submitOrder(openid, payload) {
  const diner = await requireUser(openid, 'diner')
  const mealMenuId = cleanText(payload.mealMenuId, 80)
  const clientRequestId = cleanText(payload.clientRequestId, 80)
  if (!clientRequestId) throw Object.assign(new Error('缺少订单请求编号'), { code: 'INVALID_INPUT' })

  const duplicate = await db.collection('orders').where({ familyId: diner.familyId, dinerId: openid, clientRequestId }).limit(1).get()
  if (duplicate.data.length) {
    const order = duplicate.data[0]
    return { _id: order._id, status: order.status, version: order.version, totalCents: order.totalCents, idempotent: true }
  }

  const meal = await getDocument('meal_menus', mealMenuId)
  if (!meal || meal.familyId !== diner.familyId || meal.status !== 'open') {
    throw Object.assign(new Error('这顿饭已经停止点餐'), { code: 'MENU_CLOSED' })
  }
  const rawItems = normalizeItems(payload.items)
  const dishes = await getDishesByIds(diner.familyId, rawItems.map(item => item.dishId))
  const snapshot = snapshotItems(rawItems, dishes, meal)
  const note = cleanText(payload.note, 200)
  const existingResult = await db.collection('orders').where({ familyId: diner.familyId, dinerId: openid, mealMenuId }).limit(1).get()
  const existing = existingResult.data[0]
  if (existing && existing.status !== 'pending') throw Object.assign(new Error('厨师已经确认，订单不能再修改'), { code: 'ORDER_LOCKED' })
  if (existing && Number(payload.version) !== Number(existing.version)) {
    throw Object.assign(new Error('订单已被修改，请刷新后重试'), { code: 'CONFLICT' })
  }

  const family = await getDocument('families', diner.familyId)
  const transaction = await db.startTransaction()
  let orderId = existing ? existing._id : `order_${crypto.randomBytes(12).toString('hex')}`
  let version = existing ? existing.version + 1 : 1
  let committedSnapshot = snapshot
  try {
    const latestMeal = (await transaction.collection('meal_menus').doc(mealMenuId).get()).data
    if (!latestMeal || latestMeal.status !== 'open' || latestMeal.familyId !== diner.familyId) {
      throw Object.assign(new Error('这顿饭已经停止点餐'), { code: 'MENU_CLOSED' })
    }
    const latestDishes = []
    const requestedIds = rawItems.map(item => item.dishId)
    for (let index = 0; index < requestedIds.length; index += 20) {
      const response = await transaction.collection('dishes').where({
        familyId: diner.familyId,
        _id: _.in(requestedIds.slice(index, index + 20))
      }).get()
      latestDishes.push(...response.data)
    }
    const latestSnapshot = snapshotItems(rawItems, latestDishes, latestMeal)
    committedSnapshot = latestSnapshot
    const now = db.serverDate()
    if (existing) {
      const update = await transaction.collection('orders').where({
        _id: existing._id,
        familyId: diner.familyId,
        dinerId: openid,
        status: 'pending',
        version: existing.version
      }).update({
        data: { items: latestSnapshot.items, totalCents: latestSnapshot.totalCents, note, clientRequestId, version: _.inc(1), updatedAt: now }
      })
      if (!update.stats.updated) throw Object.assign(new Error('订单已被修改，请刷新后重试'), { code: 'CONFLICT' })
      await transaction.collection('notifications').add({
        data: {
          familyId: diner.familyId,
          recipientId: family.chefId,
          type: 'order_updated',
          title: '食客修改了订单',
          content: `${diner.displayName} 修改了 ${meal.date} 的点餐内容`,
          targetId: existing._id,
          read: false,
          createdAt: now
        }
      })
    } else {
      await transaction.collection('orders').add({
        data: {
          _id: orderId,
          familyId: diner.familyId,
          dinerId: openid,
          dinerName: diner.displayName,
          mealMenuId,
          mealDate: meal.date,
          mealType: meal.mealType,
          items: latestSnapshot.items,
          totalCents: latestSnapshot.totalCents,
          note,
          status: 'pending',
          cancelReason: '',
          clientRequestId,
          version: 1,
          createdAt: now,
          updatedAt: now
        }
      })
      await createOrderNotification(transaction, diner.familyId, family.chefId, orderId, diner.displayName, meal)
    }
    await transaction.commit()
  } catch (error) {
    await transaction.rollback().catch(() => {})
    throw error
  }
  if (!existing) await sendChefSubscription(diner.familyId, orderId, diner.displayName, meal, committedSnapshot.totalCents)
  return { _id: orderId, status: 'pending', version, totalCents: committedSnapshot.totalCents, idempotent: false }
}

/**
 * 返回当前食客的订单列表。
 * @param {string} openid 食客微信标识
 * @returns {Promise<Array<object>>} 订单列表
 */
async function myOrders(openid) {
  const diner = await requireUser(openid, 'diner')
  const result = await db.collection('orders').where({ familyId: diner.familyId, dinerId: openid }).orderBy('createdAt', 'desc').limit(100).get()
  return result.data
}

/**
 * 返回单张订单，厨师可查看全家订单，食客只能查看自己的订单。
 * @param {string} openid 当前微信标识
 * @param {object} payload 订单标识
 * @returns {Promise<object>} 订单详情
 */
async function orderDetail(openid, payload) {
  const user = await requireUser(openid)
  const order = await getDocument('orders', cleanText(payload.orderId, 80))
  if (!order || order.familyId !== user.familyId || (user.role === 'diner' && order.dinerId !== openid)) {
    throw Object.assign(new Error('订单不存在'), { code: 'NOT_FOUND' })
  }
  return order
}

/**
 * 食客仅可取消待确认订单，并使用版本号防止覆盖厨师操作。
 * @param {string} openid 食客微信标识
 * @param {object} payload 订单与版本
 * @returns {Promise<object>} 取消结果
 */
async function cancelMyOrder(openid, payload) {
  const diner = await requireUser(openid, 'diner')
  const order = await getDocument('orders', cleanText(payload.orderId, 80))
  if (!order || order.familyId !== diner.familyId || order.dinerId !== openid) throw Object.assign(new Error('订单不存在'), { code: 'NOT_FOUND' })
  if (order.status !== 'pending') throw Object.assign(new Error('厨师已经确认，订单不能再取消'), { code: 'ORDER_LOCKED' })
  if (Number(payload.version) !== Number(order.version)) throw Object.assign(new Error('订单状态已经变化'), { code: 'CONFLICT' })
  const family = await getDocument('families', diner.familyId)
  const transaction = await db.startTransaction()
  try {
    const update = await transaction.collection('orders').where({ _id: order._id, status: 'pending', version: order.version }).update({
      data: { status: 'cancelled', cancelReason: '食客取消', version: _.inc(1), updatedAt: db.serverDate() }
    })
    if (!update.stats.updated) throw Object.assign(new Error('订单状态已经变化'), { code: 'CONFLICT' })
    await transaction.collection('notifications').add({
      data: {
        familyId: diner.familyId,
        recipientId: family.chefId,
        type: 'order_cancelled',
        title: '食客取消了订单',
        content: `${diner.displayName} 取消了 ${order.mealDate} 的订单`,
        targetId: order._id,
        read: false,
        createdAt: db.serverDate()
      }
    })
    await transaction.commit()
    return { orderId: order._id, status: 'cancelled', version: order.version + 1 }
  } catch (error) {
    await transaction.rollback().catch(() => {})
    throw error
  }
}

function specText(selectedSpecs) {
  return Object.entries(selectedSpecs || {}).map(([name, values]) => `${name}:${values.join('/')}`).join('，')
}

/**
 * 返回厨师厨房看板，按餐次聚合人数、份数、菜品规格和备注。
 * @param {string} openid 厨师微信标识
 * @param {object} payload 日期范围
 * @returns {Promise<Array<object>>} 厨房餐次汇总
 */
async function chefKitchen(openid, payload) {
  const chef = await requireUser(openid, 'chef')
  const startDate = cleanText(payload.startDate, 10)
  const endDate = cleanText(payload.endDate, 10)
  const [mealsResult, ordersResult] = await Promise.all([
    db.collection('meal_menus').where({ familyId: chef.familyId, date: _.gte(startDate).and(_.lte(endDate)) }).orderBy('date', 'asc').get(),
    db.collection('orders').where({ familyId: chef.familyId, mealDate: _.gte(startDate).and(_.lte(endDate)) }).orderBy('createdAt', 'asc').limit(500).get()
  ])
  return mealsResult.data.map(meal => {
    const orders = ordersResult.data.filter(order => order.mealMenuId === meal._id)
    const activeOrders = orders.filter(order => order.status !== 'cancelled')
    const dishMap = new Map()
    let totalQuantity = 0
    activeOrders.forEach(order => order.items.forEach(item => {
      totalQuantity += item.quantity
      const key = `${item.dishId}|${specText(item.selectedSpecs)}`
      const current = dishMap.get(key) || { name: item.name, specs: specText(item.selectedSpecs), quantity: 0 }
      current.quantity += item.quantity
      dishMap.set(key, current)
    }))
    return {
      ...meal,
      dinerCount: activeOrders.length,
      pendingCount: activeOrders.filter(order => order.status === 'pending').length,
      totalQuantity,
      dishSummary: [...dishMap.values()],
      notes: activeOrders.filter(order => order.note).map(order => ({ dinerName: order.dinerName, note: order.note })),
      orders
    }
  })
}

/**
 * 厨师更新单张订单状态，取消已确认订单时必须填写原因。
 * @param {string} openid 厨师微信标识
 * @param {object} payload 订单、目标状态、版本和取消原因
 * @returns {Promise<object>} 更新结果
 */
async function chefSetOrderStatus(openid, payload) {
  const chef = await requireUser(openid, 'chef')
  const order = await getDocument('orders', cleanText(payload.orderId, 80))
  const targetStatus = payload.status
  if (!order || order.familyId !== chef.familyId) throw Object.assign(new Error('订单不存在'), { code: 'NOT_FOUND' })
  assertTransition(order.status, targetStatus)
  const cancelReason = cleanText(payload.cancelReason, 100)
  if (targetStatus === 'cancelled' && order.status !== 'pending' && !cancelReason) {
    throw Object.assign(new Error('取消已确认订单必须填写原因'), { code: 'INVALID_INPUT' })
  }
  if (Number(payload.version) !== Number(order.version)) throw Object.assign(new Error('订单状态已经变化'), { code: 'CONFLICT' })
  const transaction = await db.startTransaction()
  try {
    const update = await transaction.collection('orders').where({ _id: order._id, familyId: chef.familyId, status: order.status, version: order.version }).update({
      data: { status: targetStatus, cancelReason: targetStatus === 'cancelled' ? cancelReason || '厨师取消' : '', version: _.inc(1), updatedAt: db.serverDate() }
    })
    if (!update.stats.updated) throw Object.assign(new Error('订单状态已经变化'), { code: 'CONFLICT' })
    await transaction.collection('notifications').add({
      data: {
        familyId: chef.familyId,
        recipientId: order.dinerId,
        type: 'order_status',
        title: targetStatus === 'ready' ? '开饭啦，可以取餐' : '订单状态有更新',
        content: `${order.mealDate} 的订单已更新为${STATUS_LABELS[targetStatus]}`,
        targetId: order._id,
        read: false,
        createdAt: db.serverDate()
      }
    })
    await transaction.commit()
    return { orderId: order._id, status: targetStatus, version: order.version + 1 }
  } catch (error) {
    await transaction.rollback().catch(() => {})
    throw error
  }
}

/**
 * 厨师按餐次批量推进订单，只更新处于紧邻前置状态的订单。
 * @param {string} openid 厨师微信标识
 * @param {object} payload 餐次与目标状态
 * @returns {Promise<object>} 更新数量
 */
async function chefBatchStatus(openid, payload) {
  const chef = await requireUser(openid, 'chef')
  const sources = { confirmed: 'pending', cooking: 'confirmed', ready: 'cooking', completed: 'ready' }
  const targetStatus = payload.status
  const sourceStatus = sources[targetStatus]
  if (!sourceStatus) throw Object.assign(new Error('批量目标状态不正确'), { code: 'INVALID_INPUT' })
  const meal = await getDocument('meal_menus', cleanText(payload.mealMenuId, 80))
  if (!meal || meal.familyId !== chef.familyId) throw Object.assign(new Error('餐次不存在'), { code: 'NOT_FOUND' })
  const transaction = await db.startTransaction()
  try {
    const candidates = await transaction.collection('orders').where({ familyId: chef.familyId, mealMenuId: meal._id, status: sourceStatus }).limit(100).get()
    const now = db.serverDate()
    for (const order of candidates.data) {
      await transaction.collection('orders').doc(order._id).update({
        data: { status: targetStatus, version: _.inc(1), updatedAt: now }
      })
      await transaction.collection('notifications').add({
        data: {
          familyId: chef.familyId,
          recipientId: order.dinerId,
          type: 'order_status',
          title: targetStatus === 'ready' ? '开饭啦，可以取餐' : '订单状态有更新',
          content: `${order.mealDate} 的订单已更新为${STATUS_LABELS[targetStatus]}`,
          targetId: order._id,
          read: false,
          createdAt: now
        }
      })
    }
    await transaction.commit()
    return { mealMenuId: meal._id, status: targetStatus, updated: candidates.data.length }
  } catch (error) {
    await transaction.rollback().catch(() => {})
    throw error
  }
}

/**
 * 返回当前用户的站内通知。
 * @param {string} openid 当前微信标识
 * @returns {Promise<object>} 通知与未读数
 */
async function notifications(openid) {
  await requireUser(openid)
  const result = await db.collection('notifications').where({ recipientId: openid }).orderBy('createdAt', 'desc').limit(50).get()
  return { items: result.data, unreadCount: result.data.filter(item => !item.read).length }
}

/**
 * 将属于当前用户的通知标为已读。
 * @param {string} openid 当前微信标识
 * @param {object} payload 通知标识，可为空表示全部
 * @returns {Promise<object>} 更新数量
 */
async function readNotifications(openid, payload) {
  await requireUser(openid)
  const where = payload.notificationId
    ? { _id: cleanText(payload.notificationId, 80), recipientId: openid, read: false }
    : { recipientId: openid, read: false }
  const result = await db.collection('notifications').where(where).update({ data: { read: true, readAt: db.serverDate() } })
  return { updated: result.stats.updated }
}

/**
 * 订单云函数统一入口。
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
      case 'submit': data = await submitOrder(openid, payload); break
      case 'myOrders': data = await myOrders(openid); break
      case 'detail': data = await orderDetail(openid, payload); break
      case 'cancelMine': data = await cancelMyOrder(openid, payload); break
      case 'chefKitchen': data = await chefKitchen(openid, payload); break
      case 'chefSetStatus': data = await chefSetOrderStatus(openid, payload); break
      case 'chefBatchStatus': data = await chefBatchStatus(openid, payload); break
      case 'notifications': data = await notifications(openid); break
      case 'readNotifications': data = await readNotifications(openid, payload); break
      default: throw Object.assign(new Error('未知订单接口'), { code: 'NOT_FOUND' })
    }
    return ok(data, requestId)
  } catch (error) {
    console.error('order failed', requestId, error)
    return fail(error.code || 'INTERNAL_ERROR', error.code ? error.message : '订单服务暂时不可用', requestId)
  }
}
