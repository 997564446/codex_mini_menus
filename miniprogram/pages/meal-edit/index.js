const api = require('../../utils/api')
const { requireActiveSession } = require('../../utils/session')
const { dateKey } = require('../../utils/format')

Page({
  data: {
    mealMenuId: '',
    version: 0,
    date: dateKey(),
    mealTypes: [
      { value: 'breakfast', label: '早餐', emoji: '🥛' },
      { value: 'lunch', label: '午餐', emoji: '🍱' },
      { value: 'dinner', label: '晚餐', emoji: '🍲' }
    ],
    mealType: 'dinner',
    categories: [],
    dishes: [],
    selectedDishIds: [],
    saving: false
  },

  onLoad(options) {
    this.setData({ mealMenuId: options.id || '' })
    this.loadData()
  },

  /** 加载菜品库和待编辑餐次。 */
  async loadData() {
    try {
      const session = await requireActiveSession()
      if (!session || session.user.role !== 'chef') return wx.navigateBack()
      const catalogPromise = api.call('menu', 'chefCatalog')
      const mealPromise = this.data.mealMenuId
        ? api.call('menu', 'mealDetail', { mealMenuId: this.data.mealMenuId })
        : Promise.resolve(null)
      const [catalog, meal] = await Promise.all([catalogPromise, mealPromise])
      const selectedDishIds = meal ? meal.dishIds : []
      this.setData({
        categories: catalog.categories,
        dishes: catalog.dishes.filter(dish => dish.enabled).map(dish => ({ ...dish, checked: selectedDishIds.includes(dish._id) })),
        selectedDishIds,
        date: meal ? meal.date : this.data.date,
        mealType: meal ? meal.mealType : this.data.mealType,
        version: meal ? meal.version : 0
      })
    } catch (error) { api.showError(error) }
  },

  /** 选择餐次日期。 */
  onDate(event) { this.setData({ date: event.detail.value }) },

  /** 选择早餐、午餐或晚餐。 */
  selectMealType(event) { this.setData({ mealType: event.currentTarget.dataset.value }) },

  /** 选择本餐供应的菜品。 */
  onDishes(event) { this.setData({ selectedDishIds: event.detail.value }) },

  /** 保存餐次草稿，开放点餐仍由菜单列表手动执行。 */
  async save() {
    if (!this.data.selectedDishIds.length) {
      wx.showToast({ title: '至少选一道菜', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      await api.call('menu', 'saveMeal', {
        mealMenuId: this.data.mealMenuId,
        version: this.data.version,
        date: this.data.date,
        mealType: this.data.mealType,
        dishIds: this.data.selectedDishIds
      })
      wx.showToast({ title: '餐次安排好了', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (error) { api.showError(error) } finally { this.setData({ saving: false }) }
  }
})
