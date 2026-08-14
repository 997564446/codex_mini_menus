const api = require('../../utils/api')
const { requireActiveSession } = require('../../utils/session')

Page({
  data: {
    loading: true,
    mealMenuId: '',
    version: 0,
    weekdayLabel: '',
    categories: [],
    dishes: [],
    selectedCategoryId: '',
    selectedCategoryName: '',
    categoryDishes: [],
    categoryAllSelected: false,
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
      const dishes = catalog.dishes.map(dish => ({
        ...dish,
        categoryName: categoryMap[dish.categoryId] || '未分类',
        stockText: dish.stockUnlimited ? '库存无限' : `库存 ${dish.stock || 0}`
      }))
      const categories = catalog.categories.map(category => ({
        ...category,
        dishCount: dishes.filter(dish => dish.categoryId === category._id).length
      }))
      const firstSelectedDish = dishes.find(dish => selectedDishIds.includes(dish._id))
      const selectedCategoryId = firstSelectedDish
        ? firstSelectedDish.categoryId
        : ((categories.find(category => category.dishCount) || categories[0] || {})._id || '')
      this.setData({
        categories,
        dishes,
        selectedDishIds,
        weekdayLabel: meal.weekdayLabel,
        version: meal.version,
        loading: false
      })
      this.showCategory(selectedCategoryId)
    } catch (error) {
      this.setData({ loading: false })
      api.showError(error)
    }
  },

  /** 切换左侧分类，仅在右侧展示该分类的菜品。 */
  selectCategory(event) {
    this.showCategory(event.currentTarget.dataset.id)
  },

  /** 按分类整理右侧菜品及其勾选状态。 */
  showCategory(categoryId) {
    const category = this.data.categories.find(item => item._id === categoryId)
    if (!category) return
    const selectedSet = new Set(this.data.selectedDishIds)
    const categoryDishes = this.data.dishes
      .filter(dish => dish.categoryId === categoryId)
      .map(dish => ({ ...dish, checked: selectedSet.has(dish._id) }))
    this.setData({
      selectedCategoryId: categoryId,
      selectedCategoryName: category.name,
      categoryDishes,
      categoryAllSelected: Boolean(categoryDishes.length) && categoryDishes.every(dish => dish.checked)
    })
  },

  /** 记录右侧当前分类的勾选结果，并保留其他分类已经勾选的菜品。 */
  onDishes(event) {
    this.setCategorySelection(event.detail.value)
  },

  /** 全选或取消全选右侧当前分类的菜品。 */
  toggleSelectAll() {
    const selectedDishIds = this.data.categoryAllSelected
      ? []
      : this.data.categoryDishes.map(dish => dish._id)
    this.setCategorySelection(selectedDishIds)
  },

  /** 合并当前分类与其他分类的菜单勾选结果。 */
  setCategorySelection(categorySelectedDishIds) {
    const categoryDishIdSet = new Set(this.data.categoryDishes.map(dish => dish._id))
    const selectedSet = new Set([
      ...this.data.selectedDishIds.filter(dishId => !categoryDishIdSet.has(dishId)),
      ...categorySelectedDishIds
    ])
    const selectedDishIds = this.data.dishes
      .filter(dish => selectedSet.has(dish._id))
      .map(dish => dish._id)
    this.setData({ selectedDishIds })
    this.showCategory(this.data.selectedCategoryId)
  },

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
