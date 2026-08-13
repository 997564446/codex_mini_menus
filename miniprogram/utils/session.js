const api = require('./api')

/**
 * 获取最新会话并同步到全局状态。
 * @param {boolean} force 是否忽略当前内存会话
 * @returns {Promise<object>} 最新会话
 */
async function ensureSession(force = false) {
  const app = getApp()
  if (!force && app.globalData.session) return app.globalData.session
  if (app.globalData.previewMode) {
    const previewSession = {
      previewMode: true,
      initialized: false,
      configurationReady: false,
      user: null,
      family: null
    }
    app.setSession(previewSession)
    return previewSession
  }
  const session = await api.call('identity', 'session')
  app.setSession(session)
  return session
}

/**
 * 校验用户能否进入业务页，未完成身份流程时跳转到入口页。
 * @returns {Promise<object|null>} 可用会话或空值
 */
async function requireActiveSession() {
  const session = await ensureSession(true)
  const user = session.user
  if (!user || !['chef', 'diner'].includes(user.role) || user.status !== 'active') {
    wx.reLaunch({ url: '/pages/entry/index' })
    return null
  }
  return session
}

/**
 * 同步当前页面的自定义底部导航角色与选中项。
 * @param {WechatMiniprogram.Page.Instance<any, any>} page 当前页面
 * @param {number} selected 选中项序号
 */
function syncTabBar(page, selected) {
  const tabBar = page.getTabBar && page.getTabBar()
  if (!tabBar) return
  tabBar.setData({
    selected,
    role: getApp().globalData.role || 'diner'
  })
}

module.exports = { ensureSession, requireActiveSession, syncTabBar }
