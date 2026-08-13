const api = require('../../utils/api')
const { requireActiveSession } = require('../../utils/session')

Page({
  data: {
    mealMenuId: '',
    version: 0,
    weekdayLabel: '',
    categories: [],
    dishes: [],
    selectedDishIds: [],
    saving: false
  },

  onLoad(options) {
    this.setData({ mealMenuId: options.id || '' })
    this.loadData()
  },

  /** 加载菜品库和指定星期菜单。 */
  async loadData() {
    try {
      const session = await requireActiveSession()
      if (!session || session.user.role !== 'chef' || !this.data.mealMenuId) return wx.navigateBack()
      const [catalog, meal] = await Promise.all([
        api.call('menu', 'chefCatalog'),
        api.call('menu', 'mealDetail', { mealMenuId: this.data.mealMenuId })
      ])
      const selectedDishIds = meal.dishIds || []
      const categoryMap = Object.fromEntries(catalog.categories.map(category => [category._id, category.name]))
      this.setData({
        categories: catalog.categories,
        dishes: catalog.dishes.map(dish => ({
          ...dish,
          checked: selectedDishIds.includes(dish._id),
          categoryName: categoryMap[dish.categoryId] || '未分类',
          stockText: dish.stockUnlimited ? '库存无限' : `库存 ${dish.stock || 0}`
        })),
        selectedDishIds,
        weekdayLabel: meal.weekdayLabel,
        version: meal.version
      })
    } catch (error) { api.showError(error) }
  },

  /** 选择该星期供应的菜品。 */
  onDishes(event) { this.setData({ selectedDishIds: event.detail.value }) },

  /** 保存星期菜单，未选择菜品表示清空当天菜单。 */
  async save() {
    this.setData({ saving: true })
    try {
      await api.call('menu', 'saveMeal', {
        mealMenuId: this.data.mealMenuId,
        version: this.data.version,
        dishIds: this.data.selectedDishIds
      })
      wx.showToast({ title: `${this.data.weekdayLabel}菜单已保存`, icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (error) { api.showError(error) } finally { this.setData({ saving: false }) }
  }
})
