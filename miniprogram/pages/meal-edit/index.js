const api = require('../../utils/api')
const { requireActiveSession } = require('../../utils/session')

const MEAL_TYPES = [
  { value: 'breakfast', label: '早餐' },
  { value: 'lunch', label: '中餐' },
  { value: 'dinner', label: '晚餐' }
]

Page({
  data: {
    loading: true,
    weekday: 0,
    weekdayLabel: '',
    mealMenuId: '',
    mealTypeIndex: 0,
    mealTypeLabel: '早餐',
    mealTypeOptions: MEAL_TYPES,
    meals: [],
    version: 0,
    categories: [],
    dishes: [],
    selectedCategoryId: '',
    selectedCategoryName: '',
    categoryDishes: [],
    categoryAllSelected: false,
    selectedDishIds: [],
    dirty: false,
    saving: false
  },

  onLoad(options) {
    this.setData({ weekday: Number(options.weekday || 0) })
    this.loadData()
  },

  /** 加载指定星期的三餐菜单与菜品库。 */
  async loadData() {
    try {
      const session = await requireActiveSession()
      if (!session || session.user.role !== 'chef' || this.data.weekday < 1 || this.data.weekday > 7) return wx.navigateBack()
      const [catalog, meals] = await Promise.all([
        api.call('menu', 'chefCatalog'),
        api.call('menu', 'chefMeals')
      ])
      const dayMeals = meals.filter(meal => Number(meal.weekday) === this.data.weekday)
      const categories = catalog.categories.filter(category => category.systemType !== 'uncategorized').map(category => ({
        ...category,
        dishCount: catalog.dishes.filter(dish => dish.categoryId === category._id).length
      }))
      const categoryMap = Object.fromEntries(categories.map(category => [category._id, category.name]))
      const dishes = catalog.dishes.filter(dish => categoryMap[dish.categoryId]).map(dish => ({
        ...dish,
        categoryName: categoryMap[dish.categoryId],
        stockText: dish.stockUnlimited ? '库存无限' : `库存 ${dish.stock || 0}`
      }))
      this.setData({ categories, dishes, meals: dayMeals, loading: false })
      this.applyMeal(0)
    } catch (error) {
      this.setData({ loading: false })
      api.showError(error)
    }
  },

  /** 切换早餐、中餐或晚餐，未保存时先让厨师确认。 */
  async onMealTypeChange(event) {
    const mealTypeIndex = Number(event.detail.value)
    if (mealTypeIndex === this.data.mealTypeIndex) return
    if (this.data.dirty) {
      const result = await wx.showModal({ title: '放弃未保存的菜单？', content: '切换餐别后，本次勾选不会保存。' })
      if (!result.confirm) return
    }
    this.applyMeal(mealTypeIndex)
  },

  /** 根据餐别载入当前菜单选择。 */
  applyMeal(mealTypeIndex) {
    const option = MEAL_TYPES[mealTypeIndex]
    const meal = option && this.data.meals.find(item => item.mealType === option.value)
    if (!meal) return
    const selectedDishIds = meal.dishIds || []
    const firstSelectedDish = this.data.dishes.find(dish => selectedDishIds.includes(dish._id))
    const stapleCategory = this.data.categories.find(category => category.systemType === 'staple')
    const selectedCategoryId = (firstSelectedDish && firstSelectedDish.categoryId)
      || (stapleCategory && stapleCategory._id)
      || (this.data.categories[0] || {})._id
      || ''
    this.setData({
      mealMenuId: meal._id,
      mealTypeIndex,
      mealTypeLabel: option.label,
      weekdayLabel: meal.weekdayLabel,
      version: meal.version,
      selectedDishIds,
      dirty: false
    })
    this.showCategory(selectedCategoryId)
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
    const selectedDishIds = this.data.categoryAllSelected ? [] : this.data.categoryDishes.map(dish => dish._id)
    this.setCategorySelection(selectedDishIds)
  },

  /** 合并当前分类与其他分类的菜单勾选结果。 */
  setCategorySelection(categorySelectedDishIds) {
    const categoryDishIdSet = new Set(this.data.categoryDishes.map(dish => dish._id))
    const selectedSet = new Set([
      ...this.data.selectedDishIds.filter(dishId => !categoryDishIdSet.has(dishId)),
      ...categorySelectedDishIds
    ])
    const selectedDishIds = this.data.dishes.filter(dish => selectedSet.has(dish._id)).map(dish => dish._id)
    this.setData({ selectedDishIds, dirty: true })
    this.showCategory(this.data.selectedCategoryId)
  },

  /** 保存当前星期和餐别的菜单，保存后可继续切换其他餐别。 */
  async save() {
    this.setData({ saving: true })
    try {
      const result = await api.call('menu', 'saveMeal', {
        mealMenuId: this.data.mealMenuId,
        version: this.data.version,
        dishIds: this.data.selectedDishIds
      })
      const meals = this.data.meals.map(meal => meal._id === this.data.mealMenuId
        ? { ...meal, dishIds: this.data.selectedDishIds, version: result.version }
        : meal)
      this.setData({ meals, version: result.version, dirty: false })
      wx.showToast({ title: `${this.data.mealTypeLabel}菜单已保存`, icon: 'success' })
    } catch (error) { api.showError(error) } finally { this.setData({ saving: false }) }
  }
})
