const api = require('../../utils/api')
const { requireActiveSession } = require('../../utils/session')
const { WEEKDAY_LABELS, MEAL_TYPE_LABELS, ORDER_LABELS } = require('../../utils/format')

const NEXT_STATUS = { pending: 'confirmed', confirmed: 'cooking', cooking: 'ready', ready: 'completed' }
const NEXT_LABEL = { confirmed: '确认订单', cooking: '开始制作', ready: '通知取餐', completed: '完成订单' }

Page({
  data: {
    orderId: '',
    role: '',
    loading: true,
    order: null,
    nextStatus: '',
    nextLabel: ''
  },

  onLoad(options) {
    this.setData({ orderId: options.id || '' })
    this.loadOrder()
  },

  /** 加载并格式化订单快照。 */
  async loadOrder() {
    try {
      const session = await requireActiveSession()
      if (!session) return
      const order = await api.call('order', 'detail', { orderId: this.data.orderId })
      const nextStatus = NEXT_STATUS[order.status] || ''
      this.setData({
        role: session.user.role,
        order: {
          ...order,
          weekdayLabel: order.weekdayLabel || WEEKDAY_LABELS[order.weekday] || '历史菜单',
          mealTypeLabel: order.mealTypeLabel || MEAL_TYPE_LABELS[order.mealType] || '',
          statusLabel: ORDER_LABELS[order.status],
          items: order.items.map(item => ({
            ...item,
            specText: Object.entries(item.selectedSpecs || {}).map(([name, values]) => `${name}：${values.join('、')}`).join('；')
          }))
        },
        nextStatus,
        nextLabel: NEXT_LABEL[nextStatus] || '',
        loading: false
      })
    } catch (error) {
      this.setData({ loading: false })
      api.showError(error)
    }
  },

  /** 食客返回原日期菜单修改待确认订单。 */
  editOrder() {
    wx.redirectTo({ url: `/pages/order-edit/index?mealMenuId=${this.data.order.mealMenuId}&date=${this.data.order.mealDate}` })
  },

  /** 食客取消待确认订单。 */
  async cancelMine() {
    const result = await wx.showModal({ title: '取消这份订单？', content: '取消后不能恢复，请确认。' })
    if (!result.confirm) return
    try {
      await api.call('order', 'cancelMine', { orderId: this.data.order._id, version: this.data.order.version })
      await this.loadOrder()
    } catch (error) { api.showError(error) }
  },

  /** 厨师将订单推进到下一制作状态。 */
  async moveNext() {
    try {
      await api.call('order', 'chefSetStatus', {
        orderId: this.data.order._id,
        version: this.data.order.version,
        status: this.data.nextStatus
      })
      await this.loadOrder()
    } catch (error) { api.showError(error) }
  },

  /** 厨师取消订单，已确认订单必须填写取消原因。 */
  async chefCancel() {
    let cancelReason = '厨师取消'
    if (this.data.order.status !== 'pending') {
      const result = await wx.showModal({ title: '取消原因', editable: true, placeholderText: '请告诉家人为什么取消' })
      if (!result.confirm) return
      cancelReason = result.content.trim()
      if (!cancelReason) return wx.showToast({ title: '请填写取消原因', icon: 'none' })
    } else {
      const result = await wx.showModal({ title: '取消这份订单？', content: '食客会在站内收到状态更新。' })
      if (!result.confirm) return
    }
    try {
      await api.call('order', 'chefSetStatus', {
        orderId: this.data.order._id,
        version: this.data.order.version,
        status: 'cancelled',
        cancelReason
      })
      await this.loadOrder()
    } catch (error) { api.showError(error) }
  }
})
