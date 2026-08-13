const api = require('../../utils/api')
const { ensureSession } = require('../../utils/session')

Page({
  data: {
    loading: true,
    session: null,
    mode: 'join',
    familyName: '我的家',
    displayName: '',
    relation: '',
    passphrase: '',
    inviteCode: ''
  },

  onLoad(options) {
    let inviteCode = options.invite || ''
    if (!inviteCode && options.scene) {
      const scene = decodeURIComponent(options.scene)
      const match = scene.match(/(?:^|&)invite=([^&]+)/)
      inviteCode = match ? match[1] : ''
    }
    if (inviteCode) this.setData({ inviteCode: String(inviteCode).toUpperCase() })
    this.loadSession()
  },

  /** 获取身份状态并决定显示初始化、申请或等待页面。 */
  async loadSession() {
    this.setData({ loading: true })
    try {
      const session = await ensureSession(true)
      if (session.user && session.user.status === 'active') {
        wx.reLaunch({ url: '/pages/home/index' })
        return
      }
      this.setData({
        session,
        mode: session.initialized ? 'join' : 'claim',
        displayName: session.user ? session.user.displayName : this.data.displayName,
        relation: session.user ? session.user.relation : this.data.relation,
        loading: false
      })
    } catch (error) {
      this.setData({ loading: false })
      api.showError(error)
    }
  },

  /** 同步普通输入框的值。 */
  onInput(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value })
  },

  /** 使用一次性部署口令认领唯一厨师。 */
  async claimChef() {
    const { familyName, displayName, passphrase } = this.data
    if (!familyName.trim() || !displayName.trim() || !passphrase.trim()) {
      wx.showToast({ title: '请把三项都填好', icon: 'none' })
      return
    }
    wx.showLoading({ title: '正在开厨房' })
    try {
      await api.call('identity', 'claimChef', { familyName, displayName, passphrase })
      await ensureSession(true)
      wx.reLaunch({ url: '/pages/home/index' })
    } catch (error) {
      api.showError(error)
    } finally {
      wx.hideLoading()
    }
  },

  /** 使用家庭邀请码提交食客加入申请。 */
  async applyJoin() {
    const { inviteCode, displayName, relation } = this.data
    if (!inviteCode.trim() || !displayName.trim()) {
      wx.showToast({ title: '请填写邀请码和称呼', icon: 'none' })
      return
    }
    wx.showLoading({ title: '正在敲门' })
    try {
      await api.call('family', 'applyJoin', { inviteCode, displayName, relation })
      await this.loadSession()
      wx.showToast({ title: '申请已交给厨师', icon: 'success' })
    } catch (error) {
      api.showError(error)
    } finally {
      wx.hideLoading()
    }
  }
})
