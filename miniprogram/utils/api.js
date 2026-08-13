const ERROR_TEXT = {
  UNAUTHORIZED: '请先登录',
  FORBIDDEN: '你没有权限进行这个操作',
  NOT_FOUND: '相关内容不存在或已被删除',
  INVALID_INPUT: '请检查填写内容',
  CONFLICT: '内容已经发生变化，请刷新后重试',
  MENU_CLOSED: '这顿饭已经停止点餐',
  ORDER_LOCKED: '厨师已经确认，订单不能再修改',
  NETWORK_ERROR: '网络开小差了，请稍后重试'
}

/**
 * 调用云函数并统一处理后端响应格式。
 * @param {'identity'|'family'|'menu'|'order'} name 云函数名称
 * @param {string} action 接口动作
 * @param {object} payload 请求数据
 * @returns {Promise<any>} 接口数据
 */
async function call(name, action, payload = {}) {
  try {
    const result = await wx.cloud.callFunction({
      name,
      data: { action, payload }
    })
    const response = result.result || {}
    if (!response.ok) {
      const error = new Error(response.error && response.error.message
        ? response.error.message
        : ERROR_TEXT[response.error && response.error.code] || '操作失败，请重试')
      error.code = response.error && response.error.code
      error.requestId = response.requestId
      throw error
    }
    return response.data
  } catch (error) {
    if (!error.code) {
      error.code = 'NETWORK_ERROR'
      error.message = ERROR_TEXT.NETWORK_ERROR
    }
    throw error
  }
}

/**
 * 显示统一错误提示，并保留 requestId 方便排查线上问题。
 * @param {Error} error 接口错误
 */
function showError(error) {
  wx.showModal({
    title: '没办成',
    content: error.requestId
      ? `${error.message}\n问题编号：${error.requestId}`
      : error.message || '操作失败，请稍后重试',
    showCancel: false
  })
}

module.exports = { call, showError }
