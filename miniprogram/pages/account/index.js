const api = require('../../utils/api')
const { requireActiveSession, syncTabBar, ensureSession } = require('../../utils/session')
const env = require('../../config/env')
const { requirePrivacyAuthorization } = require('../../utils/privacy')

Page({
  data: {
    loading: true,
    role: '',
    session: { user: {}, family: { name: '' } },
    overview: { family: {}, applications: [], members: [] },
    inviteCode: '',
    inviteQr: '',
    notifications: [],
    unreadCount: 0
  },

  async onShow() {
    const session = await requireActiveSession().catch(error => api.showError(error))
    if (!session) return
    this.setData({ role: session.user.role, session })
    syncTabBar(this, 2)
    await this.loadData()
  },

  async onPullDownRefresh() {
    await this.loadData()
    wx.stopPullDownRefresh()
  },

  /** 加载家庭管理信息和当前用户通知。 */
  async loadData() {
    this.setData({ loading: true })
    try {
      const requests = [api.call('order', 'notifications')]
      if (this.data.role === 'chef') requests.push(api.call('family', 'overview'))
      const [notificationData, overview] = await Promise.all(requests)
      getApp().globalData.unreadCount = notificationData.unreadCount
      this.setData({
        notifications: notificationData.items,
        unreadCount: notificationData.unreadCount,
        overview: overview || this.data.overview,
        loading: false
      })
    } catch (error) {
      this.setData({ loading: false })
      api.showError(error)
    }
  },

  /** 生成并只在当前页面保留新的家庭邀请码。 */
  async refreshInvite() {
    const confirmed = await wx.showModal({ title: '生成新邀请码？', content: '之前的邀请码会立即失效。' })
    if (!confirmed.confirm) return
    try {
      const result = await api.call('family', 'refreshInvite')
      this.setData({ inviteCode: result.inviteCode, inviteQr: '' })
      wx.showToast({ title: '已生成，请及时分享', icon: 'none' })
    } catch (error) { api.showError(error) }
  },

  /** 复制当前邀请码。 */
  copyInvite() {
    if (!this.data.inviteCode) return
    wx.setClipboardData({ data: this.data.inviteCode })
  },

  /** 生成当前邀请码对应的小程序码。 */
  async createInviteQr() {
    if (!this.data.inviteCode) {
      wx.showToast({ title: '请先生成邀请码', icon: 'none' })
      return
    }
    wx.showLoading({ title: '正在生成' })
    try {
      const result = await api.call('family', 'createInviteQr', { inviteCode: this.data.inviteCode })
      this.setData({ inviteQr: result.fileId })
    } catch (error) { api.showError(error) } finally { wx.hideLoading() }
  },

  /** 保存小程序码到系统相册。 */
  async saveInviteQr() {
    try {
      await requirePrivacyAuthorization()
      const result = await wx.cloud.downloadFile({ fileID: this.data.inviteQr })
      await wx.saveImageToPhotosAlbum({ filePath: result.tempFilePath })
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (error) {
      if (!String(error.errMsg || '').includes('cancel')) api.showError(error)
    }
  },

  /** 审批食客加入申请。 */
  async review(event) {
    const { id, decision } = event.currentTarget.dataset
    try {
      await api.call('family', 'reviewApplication', { applicationId: id, decision })
      wx.showToast({ title: decision === 'approve' ? '已经同意' : '已经拒绝', icon: 'none' })
      await this.loadData()
    } catch (error) { api.showError(error) }
  },

  /** 停用或恢复食客权限。 */
  async toggleMember(event) {
    const { id, status } = event.currentTarget.dataset
    const target = status === 'active' ? 'suspended' : 'active'
    const result = await wx.showModal({ title: target === 'active' ? '恢复成员？' : '暂停成员？', content: target === 'active' ? '恢复后可以继续点餐。' : '暂停后不能查看菜单或下单。' })
    if (!result.confirm) return
    try {
      await api.call('family', 'setMemberStatus', { memberId: id, status: target })
      await this.loadData()
    } catch (error) { api.showError(error) }
  },

  /** 厨师主动请求一次新订单微信订阅提醒。 */
  async subscribeChef() {
    if (!env.chefOrderTemplateId) {
      wx.showModal({ title: '还未配置模板', content: '请先在 config/env.js 与 system_config 中填写相同的订阅消息模板 ID。', showCancel: false })
      return
    }
    try {
      const result = await wx.requestSubscribeMessage({ tmplIds: [env.chefOrderTemplateId] })
      const enabled = result[env.chefOrderTemplateId] === 'accept'
      await api.call('identity', 'markSubscription', { enabled })
      const session = await ensureSession(true)
      this.setData({ session })
      wx.showToast({ title: enabled ? '下一份新订单会微信提醒' : '未开启提醒', icon: 'none' })
    } catch (error) { api.showError(error) }
  },

  /** 修改当前用户称呼和家庭关系。 */
  async editProfile() {
    const nameResult = await wx.showModal({ title: '修改家中称呼', editable: true, content: this.data.session.user.displayName, placeholderText: '称呼' })
    if (!nameResult.confirm || !nameResult.content.trim()) return
    const relationResult = await wx.showModal({ title: '家庭关系', editable: true, content: this.data.session.user.relation || '', placeholderText: '例如：女儿（可留空）' })
    if (!relationResult.confirm) return
    try {
      await api.call('identity', 'updateProfile', { displayName: nameResult.content, relation: relationResult.content })
      const session = await ensureSession(true)
      this.setData({ session })
    } catch (error) { api.showError(error) }
  },

  /** 将全部站内通知标为已读。 */
  async readAll() {
    try {
      await api.call('order', 'readNotifications')
      await this.loadData()
    } catch (error) { api.showError(error) }
  },

  /** 分享当前家庭邀请入口。 */
  onShareAppMessage() {
    return {
      title: `${this.data.session.family.name} 邀请你来点餐`,
      path: `/pages/entry/index?invite=${this.data.inviteCode || ''}`
    }
  }
})
