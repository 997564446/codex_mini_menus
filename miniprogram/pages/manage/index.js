const api = require('../../utils/api')
const { requireActiveSession, syncTabBar } = require('../../utils/session')
const { WEEKDAY_LABELS, ORDER_LABELS } = require('../../utils/format')

Page({
  data: {
    loading: true,
    role: '',
    chefTab: 'dishes',
    categories: [],
    dishes: [],
    meals: [],
    orders: []
  },

  async onShow() {
    const session = await requireActiveSession().catch(error => api.showError(error))
    if (!session) return
    this.setData({ role: session.user.role })
    syncTabBar(this, 1)
    await this.loadData()
  },

  async onPullDownRefresh() {
    await this.loadData()
    wx.stopPullDownRefresh()
  },

  /** 根据角色加载菜品、星期菜单或个人订单。 */
  async loadData() {
    this.setData({ loading: true })
    try {
      if (this.data.role === 'chef') {
        const [catalog, meals] = await Promise.all([
          api.call('menu', 'chefCatalog'),
          api.call('menu', 'chefMeals')
        ])
        const categoryMap = Object.fromEntries(catalog.categories.map(category => [category._id, category.name]))
        this.setData({
          categories: catalog.categories,
          dishes: catalog.dishes.map(dish => ({
            ...dish,
            categoryName: categoryMap[dish.categoryId] || '未分类',
            stockText: dish.stockUnlimited ? '无限' : String(dish.stock || 0)
          })),
          meals,
          loading: false
        })
      } else {
        const orders = await api.call('order', 'myOrders')
        this.setData({
          orders: orders.map(order => ({
            ...order,
            statusLabel: ORDER_LABELS[order.status],
            weekdayLabel: order.weekdayLabel || WEEKDAY_LABELS[order.weekday] || '历史菜单'
          })),
          loading: false
        })
      }
    } catch (error) {
      this.setData({ loading: false })
      api.showError(error)
    }
  },

  /** 切换厨师的菜品库与星期菜单。 */
  switchChefTab(event) {
    this.setData({ chefTab: event.currentTarget.dataset.tab })
  },

  /** 新建菜品分类。 */
  async addCategory() {
    const result = await wx.showModal({ title: '新增分类', editable: true, placeholderText: '例如：家常菜、汤羹' })
    if (!result.confirm || !result.content.trim()) return
    try {
      await api.call('menu', 'saveCategory', { name: result.content })
      await this.loadData()
    } catch (error) { api.showError(error) }
  },

  /** 打开分类的修改或删除操作。 */
  async manageCategory(event) {
    const category = this.data.categories.find(item => item._id === event.currentTarget.dataset.id)
    if (!category || category.isDefault) return
    try {
      const result = await wx.showActionSheet({ itemList: ['修改名称', '删除分类'] })
      if (result.tapIndex === 0) await this.renameCategory(category)
      if (result.tapIndex === 1) await this.removeCategory(category)
    } catch (error) {
      if (!String(error.errMsg || '').includes('cancel')) api.showError(error)
    }
  },

  /** 修改已有分类名称。 */
  async renameCategory(category) {
    const result = await wx.showModal({
      title: '修改分类',
      editable: true,
      content: category.name,
      placeholderText: '分类名称'
    })
    const name = String(result.content || '').trim()
    if (!result.confirm || !name || name === category.name) return
    await api.call('menu', 'saveCategory', { categoryId: category._id, name })
    wx.showToast({ title: '分类已修改', icon: 'success' })
    await this.loadData()
  },

  /** 删除分类并把其中的菜品移入“未分类”。 */
  async removeCategory(category) {
    const result = await wx.showModal({
      title: `删除“${category.name}”？`,
      content: '该分类下的菜品会自动移入“未分类”。'
    })
    if (!result.confirm) return
    await api.call('menu', 'deleteCategory', { categoryId: category._id })
    wx.showToast({ title: '分类已删除', icon: 'success' })
    await this.loadData()
  },

  /** 打开预置菜品的分类与库存设置页。 */
  editDish(event) {
    const id = event.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/dish-edit/index?id=${id}` })
  },

  /** 打开指定星期的菜单编辑页。 */
  editMeal(event) {
    const id = event.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/meal-edit/index${id ? `?id=${id}` : ''}` })
  },

  /** 打开订单详情。 */
  openOrder(event) {
    wx.navigateTo({ url: `/pages/order-detail/index?id=${event.currentTarget.dataset.id}` })
  }
})
