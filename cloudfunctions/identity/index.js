const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const { hashSecret, safeEqual } = require('./domain')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function ok(data, requestId) {
  return { ok: true, data, error: null, requestId }
}

function fail(code, message, requestId) {
  return { ok: false, data: null, error: { code, message }, requestId }
}

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength)
}

async function getDocument(collection, id) {
  try {
    const result = await db.collection(collection).doc(id).get()
    return result.data
  } catch (error) {
    if (String(error.errMsg || error.message).includes('does not exist')) return null
    throw error
  }
}

/**
 * 返回当前微信用户的身份、家庭和系统初始化状态。
 * @param {string} openid 微信用户标识
 * @returns {Promise<object>} 登录会话
 */
async function getSession(openid) {
  const [config, user] = await Promise.all([
    getDocument('system_config', 'global'),
    getDocument('users', openid)
  ])
  let family = null
  if (user && user.familyId) family = await getDocument('families', user.familyId)
  return {
    initialized: Boolean(config && config.initialized),
    configurationReady: Boolean(config),
    user: user ? {
      _id: user._id,
      familyId: user.familyId || '',
      role: user.role || '',
      status: user.status || 'pending',
      displayName: user.displayName || '',
      relation: user.relation || '',
      chefSubscribeEnabled: Boolean(user.chefSubscribeEnabled)
    } : null,
    family: family ? { _id: family._id, name: family.name } : null
  }
}

/**
 * 由首位用户使用部署口令认领唯一厨师，事务保证不会产生第二名厨师。
 * @param {string} openid 微信用户标识
 * @param {object} payload 厨师资料与初始化口令
 * @returns {Promise<object>} 新家庭信息
 */
async function claimChef(openid, payload) {
  const passphrase = cleanText(payload.passphrase, 128)
  const familyName = cleanText(payload.familyName, 24)
  const displayName = cleanText(payload.displayName, 16)
  if (!passphrase || !familyName || !displayName) {
    throw Object.assign(new Error('请完整填写家庭名称、厨师称呼和初始化口令'), { code: 'INVALID_INPUT' })
  }

  const transaction = await db.startTransaction()
  try {
    const configResult = await transaction.collection('system_config').doc('global').get()
    const config = configResult.data
    if (config.initialized) throw Object.assign(new Error('厨师已经被认领'), { code: 'CONFLICT' })
    if (!config.chefPassphraseHash || !safeEqual(hashSecret(passphrase), config.chefPassphraseHash)) {
      throw Object.assign(new Error('初始化口令不正确'), { code: 'FORBIDDEN' })
    }
    const existing = await transaction.collection('users').doc(openid).get().catch(() => null)
    if (existing && existing.data) throw Object.assign(new Error('当前微信已经登记过身份'), { code: 'CONFLICT' })

    const familyId = `family_${crypto.randomBytes(12).toString('hex')}`
    const now = db.serverDate()
    await transaction.collection('families').add({
      data: {
        _id: familyId,
        name: familyName,
        chefId: openid,
        inviteCodeHash: '',
        inviteUpdatedAt: null,
        createdAt: now,
        updatedAt: now
      }
    })
    await transaction.collection('users').add({
      data: {
        _id: openid,
        openid,
        familyId,
        role: 'chef',
        status: 'active',
        displayName,
        relation: '厨师',
        chefSubscribeEnabled: false,
        createdAt: now,
        updatedAt: now
      }
    })
    await transaction.collection('system_config').doc('global').update({
      data: {
        initialized: true,
        chefPassphraseHash: '',
        familyId,
        initializedAt: now,
        updatedAt: now
      }
    })
    await transaction.collection('audit_logs').add({
      data: { familyId, actorId: openid, action: 'chef.claim', targetId: familyId, createdAt: now }
    })
    await transaction.commit()
    return { familyId, familyName }
  } catch (error) {
    await transaction.rollback().catch(() => {})
    throw error
  }
}

/**
 * 更新当前用户可公开展示的家庭资料。
 * @param {string} openid 微信用户标识
 * @param {object} payload 资料内容
 * @returns {Promise<object>} 更新结果
 */
async function updateProfile(openid, payload) {
  const displayName = cleanText(payload.displayName, 16)
  const relation = cleanText(payload.relation, 12)
  if (!displayName) throw Object.assign(new Error('称呼不能为空'), { code: 'INVALID_INPUT' })
  const user = await getDocument('users', openid)
  if (!user) throw Object.assign(new Error('请先完成身份登记'), { code: 'UNAUTHORIZED' })
  await db.collection('users').doc(openid).update({
    data: { displayName, relation, updatedAt: db.serverDate() }
  })
  return { displayName, relation }
}

/**
 * 记录厨师已主动允许新订单订阅消息。
 * @param {string} openid 微信用户标识
 * @param {object} payload 授权状态
 * @returns {Promise<object>} 更新结果
 */
async function markSubscription(openid, payload) {
  const user = await getDocument('users', openid)
  if (!user || user.role !== 'chef' || user.status !== 'active') {
    throw Object.assign(new Error('只有当前厨师可以设置订单提醒'), { code: 'FORBIDDEN' })
  }
  await db.collection('users').doc(openid).update({
    data: { chefSubscribeEnabled: Boolean(payload.enabled), updatedAt: db.serverDate() }
  })
  return { enabled: Boolean(payload.enabled) }
}

/**
 * 身份云函数统一入口。
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
      case 'session': data = await getSession(openid); break
      case 'claimChef': data = await claimChef(openid, payload); break
      case 'updateProfile': data = await updateProfile(openid, payload); break
      case 'markSubscription': data = await markSubscription(openid, payload); break
      default: throw Object.assign(new Error('未知身份接口'), { code: 'NOT_FOUND' })
    }
    return ok(data, requestId)
  } catch (error) {
    console.error('identity failed', requestId, error)
    return fail(error.code || 'INTERNAL_ERROR', error.code ? error.message : '身份服务暂时不可用', requestId)
  }
}
