const api = require('../../utils/api')
const { requireActiveSession, syncTabBar } = require('../../utils/session')
const { ORDER_LABELS, weekOptions, orderDateOptions, mealAvailability } = require('../../utils/format')

const currentWeek = weekOptions()

Page({
  data: {
    loading: true,
    role: '',
    session: { user: {}, family: { name: '' } },
    dates: currentWeek,
    selectedDate: currentWeek.find(item => item.isToday).value,
    meals: []
  },

  async onShow() {
    const session = await requireActiveSession().catch(error => api.showError(error))
    if (!session) return
    const dates = session.user.role === 'diner' ? orderDateOptions() : weekOptions()
    const selectedDate = dates.some(item => item.value === this.data.selectedDate)
      ? this.data.selectedDate
      : (dates.find(item => item.isToday) || dates[0]).value
    this.setData({ session, role: session.user.role, dates, selectedDate })
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
        weekdayLabel: meal.weekdayLabel,
        ...(role === 'diner' ? mealAvailability(selectedDate, meal.mealType) : {}),
        dishes: [...(meal.dishes || [])].sort((left, right) => Number(!left.stockUnlimited && left.stock <= 0) - Number(!right.stockUnlimited && right.stock <= 0)),
        orders: (meal.orders || []).map(order => ({ ...order, statusLabel: ORDER_LABELS[order.status] }))
      }))
      this.setData({ meals, loading: false })
    } catch (error) {
      this.setData({ loading: false })
      api.showError(error)
    }
  },

  /** 进入食客点餐页面。 */
  openMeal(event) {
    const selected = this.data.dates.find(item => item.value === this.data.selectedDate)
    if (selected && selected.isPast) return wx.showToast({ title: '过去的日期不能再点餐', icon: 'none' })
    const meal = this.data.meals.find(item => item._id === event.currentTarget.dataset.id)
    if (!meal || meal.closed) return wx.showToast({ title: meal ? `${meal.mealTypeLabel}已截止点餐` : '菜单不可用', icon: 'none' })
    if (!meal.dishes.length) return wx.showToast({ title: '这餐还没有设置菜单', icon: 'none' })
    wx.navigateTo({ url: `/pages/order-edit/index?mealMenuId=${event.currentTarget.dataset.id}&date=${this.data.selectedDate}` })
  },

  /** 进入厨师的订单详情。 */
  openOrder(event) {
    wx.navigateTo({ url: `/pages/order-detail/index?id=${event.currentTarget.dataset.id}` })
  },

  /** 厨师将当天菜单中符合条件的订单批量推进一步。 */
  async batchStatus(event) {
    const { id, status } = event.currentTarget.dataset
    wx.showLoading({ title: '正在更新' })
    try {
      const result = await api.call('order', 'chefBatchStatus', { mealMenuId: id, date: this.data.selectedDate, status })
      wx.showToast({ title: result.updated ? `已更新 ${result.updated} 单` : '没有待更新订单', icon: 'none' })
      await this.loadData()
    } catch (error) {
      api.showError(error)
    } finally {
      wx.hideLoading()
    }
  }
})
