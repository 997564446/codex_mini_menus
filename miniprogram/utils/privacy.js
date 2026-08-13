/**
 * 在调用相册、相机等隐私接口前请求用户确认小程序隐私协议。
 * @returns {Promise<void>} 用户同意后完成
 */
function requirePrivacyAuthorization() {
  if (!wx.requirePrivacyAuthorize) return Promise.resolve()
  return new Promise((resolve, reject) => {
    wx.requirePrivacyAuthorize({ success: resolve, fail: reject })
  })
}

module.exports = { requirePrivacyAuthorization }
