const env = require('./config/env')

App({
  onLaunch() {
    const accountInfo = wx.getAccountInfoSync ? wx.getAccountInfoSync() : null
    const appId = accountInfo && accountInfo.miniProgram ? accountInfo.miniProgram.appId : ''
    this.globalData.previewMode = appId === 'touristappid'
    if (this.globalData.previewMode) return
    if (!wx.cloud) {
      wx.showModal({
        title: '微信版本过低',
        content: '请升级微信后再使用家庭点餐。',
        showCancel: false
      })
      return
    }
    wx.cloud.init({
      env: env.cloudEnvId || undefined,
      traceUser: true
    })
  },

  globalData: {
    session: null,
    role: '',
    unreadCount: 0,
    previewMode: false
  },

  /**
   * 更新全局登录会话，供页面与自定义导航同步角色。
   * @param {object|null} session 登录会话
   */
  setSession(session) {
    this.globalData.session = session
    this.globalData.role = session && session.user ? session.user.role : ''
  }
})
