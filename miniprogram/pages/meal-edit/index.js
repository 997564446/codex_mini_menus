const api = require('../../utils/api')
const { requireActiveSession } = require('../../utils/session')

const MEAL_TYPES = [
  { value: 'breakfast', label: '早餐' },
  { value: 'lunch', label: '中餐' },
  { value: 'dinner', label: '晚餐' }
]
const WEEKDAYS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' }
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
    allMeals: [],
    version: 0,
    categories: [],
    dishes: [],
    selectedCategoryId: '',
    selectedCategoryName: '',
    categoryDishes: [],
    categoryAllSelected: false,
    selectedDishIds: [],
    syncPanelVisible: false,
    syncWeekdayOptions: [],
    syncTargetWeekdays: [],
    syncAllSelected: false,
    dirty: false,
    saving: false,
    syncing: false
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
      this.setData({ categories, dishes, meals: dayMeals, allMeals: meals, loading: false })
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
    const requiredDishIds = this.data.dishes.filter(dish => dish.systemDishType === 'no_staple').map(dish => dish._id)
    const selectedDishIds = [...new Set([...(meal.dishIds || []), ...requiredDishIds])]
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
      syncPanelVisible: false,
      syncWeekdayOptions: [],
      syncTargetWeekdays: [],
      syncAllSelected: false,
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
      .map(dish => ({
        ...dish,
        checked: selectedSet.has(dish._id),
        isRequiredDish: dish.systemDishType === 'no_staple'
      }))
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
    const requiredDishIds = this.data.dishes.filter(dish => dish.systemDishType === 'no_staple').map(dish => dish._id)
    const selectedSet = new Set([
      ...this.data.selectedDishIds.filter(dishId => !categoryDishIdSet.has(dishId)),
      ...categorySelectedDishIds,
      ...requiredDishIds
    ])
    const selectedDishIds = this.data.dishes.filter(dish => selectedSet.has(dish._id)).map(dish => dish._id)
    this.setData({ selectedDishIds, dirty: true })
    this.showCategory(this.data.selectedCategoryId)
  },

  /** 打开同步面板；当前菜单有未保存修改时要求厨师先保存。 */
  openSyncPanel() {
    if (this.data.dirty) {
      wx.showToast({ title: '请先保存当前菜单', icon: 'none' })
      return
    }
    const syncWeekdayOptions = WEEKDAYS.filter(item => item.value !== this.data.weekday).map(item => ({ ...item, checked: false }))
    this.setData({ syncPanelVisible: true, syncWeekdayOptions, syncTargetWeekdays: [], syncAllSelected: false })
  },

  /** 关闭同步面板并清空本次目标星期。 */
  closeSyncPanel() {
    this.setData({ syncPanelVisible: false, syncWeekdayOptions: [], syncTargetWeekdays: [], syncAllSelected: false })
  },

  /** 记录厨师勾选的同步目标星期。 */
  onSyncWeekdays(event) {
    const syncTargetWeekdays = event.detail.value.map(Number)
    const syncWeekdayOptions = this.data.syncWeekdayOptions.map(item => ({ ...item, checked: syncTargetWeekdays.includes(item.value) }))
    this.setData({
      syncTargetWeekdays,
      syncWeekdayOptions,
      syncAllSelected: syncTargetWeekdays.length === syncWeekdayOptions.length
    })
  },

  /** 全选或清空同步目标星期。 */
  toggleSyncAll() {
    const shouldSelectAll = !this.data.syncAllSelected
    const syncWeekdayOptions = this.data.syncWeekdayOptions.map(item => ({ ...item, checked: shouldSelectAll }))
    this.setData({
      syncWeekdayOptions,
      syncTargetWeekdays: shouldSelectAll ? syncWeekdayOptions.map(item => item.value) : [],
      syncAllSelected: shouldSelectAll
    })
  },

  /** 将当前已保存菜单同步覆盖到所选星期的相同餐别。 */
  async syncCurrentMeal() {
    if (this.data.dirty) {
      wx.showToast({ title: '请先保存当前菜单', icon: 'none' })
      return
    }
    if (!this.data.syncTargetWeekdays.length) {
      wx.showToast({ title: '请选择要同步的星期', icon: 'none' })
      return
    }
    const mealType = MEAL_TYPES[this.data.mealTypeIndex].value
    const targetMenus = this.data.allMeals.filter(meal => meal.mealType === mealType && this.data.syncTargetWeekdays.includes(Number(meal.weekday)))
    const targetVersions = Object.fromEntries(targetMenus.map(meal => [meal._id, meal.version]))
    this.setData({ syncing: true })
    try {
      const result = await api.call('menu', 'syncMeals', {
        sourceMealMenuId: this.data.mealMenuId,
        sourceVersion: this.data.version,
        targetWeekdays: this.data.syncTargetWeekdays,
        targetVersions
      })
      const updatedMap = Object.fromEntries(result.updatedMenus.map(meal => [meal._id, meal]))
      const allMeals = this.data.allMeals.map(meal => updatedMap[meal._id]
        ? { ...meal, dishIds: result.dishIds, version: updatedMap[meal._id].version }
        : meal)
      const count = result.updatedMenus.length
      this.setData({ allMeals, syncing: false })
      this.closeSyncPanel()
      wx.showToast({ title: `已同步到 ${count} 天`, icon: 'success' })
    } catch (error) {
      this.setData({ syncing: false })
      api.showError(error)
    }
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
      const allMeals = this.data.allMeals.map(meal => meal._id === this.data.mealMenuId
        ? { ...meal, dishIds: this.data.selectedDishIds, version: result.version }
        : meal)
      this.setData({ meals, allMeals, version: result.version, dirty: false })
      wx.showToast({ title: `${this.data.mealTypeLabel}菜单已保存`, icon: 'success' })
    } catch (error) { api.showError(error) } finally { this.setData({ saving: false }) }
  }
})
