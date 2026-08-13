const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function ok(data, requestId) { return { ok: true, data, error: null, requestId } }
function fail(code, message, requestId) { return { ok: false, data: null, error: { code, message }, requestId } }
function cleanText(value, max) { return String(value || '').trim().slice(0, max) }
function hash(value) { return crypto.createHash('sha256').update(String(value || '').trim().toUpperCase()).digest('hex') }

async function getDocument(collection, id) {
  try { return (await db.collection(collection).doc(id).get()).data } catch (error) {
    if (String(error.errMsg || error.message).includes('does not exist')) return null
    throw error
  }
}

async function requireChef(openid) {
  const user = await getDocument('users', openid)
  if (!user || user.role !== 'chef' || user.status !== 'active' || !user.familyId) {
    throw Object.assign(new Error('只有当前厨师可以进行这个操作'), { code: 'FORBIDDEN' })
  }
  return user
}

/**
 * 生成新的家庭邀请码，旧邀请码立即失效，明文仅在本次响应中返回。
 * @param {string} openid 厨师微信标识
 * @returns {Promise<object>} 新邀请码
 */
async function refreshInvite(openid) {
  const chef = await requireChef(openid)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  const bytes = crypto.randomBytes(8)
  for (let index = 0; index < 8; index += 1) code += alphabet[bytes[index] % alphabet.length]
  const now = db.serverDate()
  await db.collection('families').doc(chef.familyId).update({
    data: { inviteCodeHash: hash(code), inviteUpdatedAt: now, updatedAt: now }
  })
  await db.collection('audit_logs').add({
    data: { familyId: chef.familyId, actorId: openid, action: 'invite.refresh', targetId: chef.familyId, createdAt: now }
  })
  return { inviteCode: code, tip: '邀请码只展示这一次，请立即分享给家人' }
}

/**
 * 为当前有效邀请码生成可分享的小程序码并存入云存储。
 * @param {string} openid 厨师微信标识
 * @param {object} payload 当前邀请码
 * @returns {Promise<object>} 小程序码云文件标识
 */
async function createInviteQr(openid, payload) {
  const chef = await requireChef(openid)
  const inviteCode = cleanText(payload.inviteCode, 16).toUpperCase()
  const family = await getDocument('families', chef.familyId)
  if (!inviteCode || !family || family.inviteCodeHash !== hash(inviteCode)) {
    throw Object.assign(new Error('邀请码已经失效，请重新生成'), { code: 'CONFLICT' })
  }
  const config = await getDocument('system_config', 'global')
  const response = await cloud.openapi.wxacode.getUnlimited({
    scene: `invite=${inviteCode}`,
    page: 'pages/entry/index',
    checkPath: false,
    envVersion: config && config.qrEnvVersion ? config.qrEnvVersion : 'release',
    width: 430
  })
  const cloudPath = `invite-codes/${chef.familyId}-${Date.now()}.png`
  const upload = await cloud.uploadFile({ cloudPath, fileContent: response.buffer })
  return { fileId: upload.fileID }
}

/**
 * 食客使用邀请码提交加入申请，重复的待审批申请不会重复创建。
 * @param {string} openid 食客微信标识
 * @param {object} payload 邀请码与食客资料
 * @returns {Promise<object>} 申请状态
 */
async function applyJoin(openid, payload) {
  const inviteCode = cleanText(payload.inviteCode, 16).toUpperCase()
  const displayName = cleanText(payload.displayName, 16)
  const relation = cleanText(payload.relation, 12)
  if (!inviteCode || !displayName) {
    throw Object.assign(new Error('请填写邀请码和家中称呼'), { code: 'INVALID_INPUT' })
  }
  const current = await getDocument('users', openid)
  if (current && current.role === 'chef') throw Object.assign(new Error('厨师不能申请成为食客'), { code: 'CONFLICT' })
  if (current && current.status === 'active') throw Object.assign(new Error('你已经加入家庭'), { code: 'CONFLICT' })

  const familyResult = await db.collection('families').where({ inviteCodeHash: hash(inviteCode) }).limit(1).get()
  const family = familyResult.data[0]
  if (!family) throw Object.assign(new Error('邀请码不正确或已经失效'), { code: 'FORBIDDEN' })

  const existingResult = await db.collection('join_applications').where({
    applicantId: openid,
    familyId: family._id,
    status: 'pending'
  }).limit(1).get()
  if (existingResult.data.length) return { applicationId: existingResult.data[0]._id, status: 'pending' }

  const transaction = await db.startTransaction()
  try {
    const now = db.serverDate()
    if (current) {
      await transaction.collection('users').doc(openid).update({
        data: { familyId: family._id, role: 'diner', status: 'pending', displayName, relation, updatedAt: now }
      })
    } else {
      await transaction.collection('users').add({
        data: {
          _id: openid,
          openid,
          familyId: family._id,
          role: 'diner',
          status: 'pending',
          displayName,
          relation,
          createdAt: now,
          updatedAt: now
        }
      })
    }
    const applicationId = `join_${crypto.randomBytes(12).toString('hex')}`
    await transaction.collection('join_applications').add({
      data: {
        _id: applicationId,
        familyId: family._id,
        applicantId: openid,
        displayName,
        relation,
        status: 'pending',
        createdAt: now,
        updatedAt: now
      }
    })
    await transaction.collection('notifications').add({
      data: {
        familyId: family._id,
        recipientId: family.chefId,
        type: 'join_application',
        title: '有家人申请加入',
        content: `${displayName} 正在等待你的同意`,
        targetId: applicationId,
        read: false,
        createdAt: now
      }
    })
    await transaction.commit()
    return { applicationId, status: 'pending' }
  } catch (error) {
    await transaction.rollback().catch(() => {})
    throw error
  }
}

/**
 * 返回厨师可管理的申请、成员和家庭信息。
 * @param {string} openid 厨师微信标识
 * @returns {Promise<object>} 家庭管理数据
 */
async function overview(openid) {
  const chef = await requireChef(openid)
  const [family, applications, members] = await Promise.all([
    getDocument('families', chef.familyId),
    db.collection('join_applications').where({ familyId: chef.familyId, status: 'pending' }).orderBy('createdAt', 'desc').get(),
    db.collection('users').where({ familyId: chef.familyId, role: 'diner' }).orderBy('createdAt', 'asc').get()
  ])
  return {
    family: { _id: family._id, name: family.name, inviteReady: Boolean(family.inviteCodeHash) },
    applications: applications.data.map(item => ({
      _id: item._id,
      displayName: item.displayName,
      relation: item.relation,
      createdAt: item.createdAt
    })),
    members: members.data.map(item => ({
      _id: item._id,
      displayName: item.displayName,
      relation: item.relation,
      status: item.status
    }))
  }
}

/**
 * 审批加入申请并同步成员状态。
 * @param {string} openid 厨师微信标识
 * @param {object} payload 申请编号与审批决定
 * @returns {Promise<object>} 审批结果
 */
async function reviewApplication(openid, payload) {
  const chef = await requireChef(openid)
  const applicationId = cleanText(payload.applicationId, 80)
  const decision = payload.decision
  if (!['approve', 'reject'].includes(decision)) {
    throw Object.assign(new Error('审批决定不正确'), { code: 'INVALID_INPUT' })
  }
  const transaction = await db.startTransaction()
  try {
    const result = await transaction.collection('join_applications').doc(applicationId).get()
    const application = result.data
    if (!application || application.familyId !== chef.familyId) {
      throw Object.assign(new Error('申请不存在'), { code: 'NOT_FOUND' })
    }
    if (application.status !== 'pending') throw Object.assign(new Error('申请已经处理过'), { code: 'CONFLICT' })
    const now = db.serverDate()
    const status = decision === 'approve' ? 'active' : 'rejected'
    await transaction.collection('join_applications').doc(applicationId).update({
      data: { status, reviewedBy: openid, reviewedAt: now, updatedAt: now }
    })
    await transaction.collection('users').doc(application.applicantId).update({ data: { status, updatedAt: now } })
    await transaction.collection('notifications').add({
      data: {
        familyId: chef.familyId,
        recipientId: application.applicantId,
        type: 'join_result',
        title: decision === 'approve' ? '欢迎加入咱家饭桌' : '加入申请未通过',
        content: decision === 'approve' ? '厨师已经同意，现在可以开始点餐了' : '可以向厨师确认后，用新邀请码再次申请',
        targetId: applicationId,
        read: false,
        createdAt: now
      }
    })
    await transaction.collection('audit_logs').add({
      data: { familyId: chef.familyId, actorId: openid, action: `member.${decision}`, targetId: application.applicantId, createdAt: now }
    })
    await transaction.commit()
    return { applicationId, status }
  } catch (error) {
    await transaction.rollback().catch(() => {})
    throw error
  }
}

/**
 * 停用或恢复食客，厨师身份不能通过此接口修改。
 * @param {string} openid 厨师微信标识
 * @param {object} payload 成员与目标状态
 * @returns {Promise<object>} 更新结果
 */
async function setMemberStatus(openid, payload) {
  const chef = await requireChef(openid)
  const memberId = cleanText(payload.memberId, 80)
  const status = payload.status
  if (!['active', 'suspended'].includes(status)) throw Object.assign(new Error('成员状态不正确'), { code: 'INVALID_INPUT' })
  const member = await getDocument('users', memberId)
  if (!member || member.familyId !== chef.familyId || member.role !== 'diner') {
    throw Object.assign(new Error('成员不存在'), { code: 'NOT_FOUND' })
  }
  const now = db.serverDate()
  await db.collection('users').doc(memberId).update({ data: { status, updatedAt: now } })
  await db.collection('audit_logs').add({
    data: { familyId: chef.familyId, actorId: openid, action: `member.${status}`, targetId: memberId, createdAt: now }
  })
  return { memberId, status }
}

/**
 * 家庭云函数统一入口。
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
      case 'refreshInvite': data = await refreshInvite(openid); break
      case 'createInviteQr': data = await createInviteQr(openid, payload); break
      case 'applyJoin': data = await applyJoin(openid, payload); break
      case 'overview': data = await overview(openid); break
      case 'reviewApplication': data = await reviewApplication(openid, payload); break
      case 'setMemberStatus': data = await setMemberStatus(openid, payload); break
      default: throw Object.assign(new Error('未知家庭接口'), { code: 'NOT_FOUND' })
    }
    return ok(data, requestId)
  } catch (error) {
    console.error('family failed', requestId, error)
    return fail(error.code || 'INTERNAL_ERROR', error.code ? error.message : '家庭服务暂时不可用', requestId)
  }
}
