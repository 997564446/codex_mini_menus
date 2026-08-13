const api = require('../../utils/api')
const { requireActiveSession, syncTabBar } = require('../../utils/session')
const { MEAL_LABELS, ORDER_LABELS, money, dateOptions } = require('../../utils/format')

Page({
  data: {
    loading: true,
    role: '',
    session: { user: {}, family: { name: '' } },
    dates: dateOptions(7),
    selectedDate: dateOptions(7)[0].value,
    meals: []
  },

  async onShow() {
    const session = await requireActiveSession().catch(error => api.showError(error))
    if (!session) return
    this.setData({ session, role: session.user.role })
    syncTabBar(this, 0)
    await this.loadData()
  },

  async onPullDownRefresh() {
    await this.loadData()
    wx.stopPullDownRefresh()
  },

  /** 切换查看的用餐日期。 */
  selectDate(event) {
    this.setData({ selectedDate: event.currentTarget.dataset.date })
    this.loadData()
  },

  /** 按当前角色读取开放菜单或厨房看板。 */
  async loadData() {
    this.setData({ loading: true })
    try {
      const { role, selectedDate } = this.data
      const action = role === 'chef' ? 'chefKitchen' : 'openMeals'
      const functionName = role === 'chef' ? 'order' : 'menu'
      const data = await api.call(functionName, action, { startDate: selectedDate, endDate: selectedDate })
      const meals = data.map(meal => ({
        ...meal,
        mealLabel: MEAL_LABELS[meal.mealType],
        dishes: (meal.dishes || []).map(dish => ({ ...dish, priceText: money(dish.priceCents) })),
        orders: (meal.orders || []).map(order => ({ ...order, statusLabel: ORDER_LABELS[order.status], totalText: money(order.totalCents) }))
      }))
      this.setData({ meals, loading: false })
    } catch (error) {
      this.setData({ loading: false })
      api.showError(error)
    }
  },

  /** 进入食客点餐页面。 */
  openMeal(event) {
    wx.navigateTo({ url: `/pages/order-edit/index?mealMenuId=${event.currentTarget.dataset.id}` })
  },

  /** 进入厨师的订单详情。 */
  openOrder(event) {
    wx.navigateTo({ url: `/pages/order-detail/index?id=${event.currentTarget.dataset.id}` })
  },

  /** 厨师将当前餐次中符合条件的订单批量推进一步。 */
  async batchStatus(event) {
    const { id, status } = event.currentTarget.dataset
    wx.showLoading({ title: '正在更新' })
    try {
      const result = await api.call('order', 'chefBatchStatus', { mealMenuId: id, status })
      wx.showToast({ title: result.updated ? `已更新 ${result.updated} 单` : '没有待更新订单', icon: 'none' })
      await this.loadData()
    } catch (error) {
      api.showError(error)
    } finally {
      wx.hideLoading()
    }
  }
})
