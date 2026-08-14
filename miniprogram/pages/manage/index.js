const api = require('../../utils/api')
const { requireActiveSession, syncTabBar } = require('../../utils/session')
const { WEEKDAY_LABELS, MEAL_TYPE_LABELS, ORDER_LABELS } = require('../../utils/format')
Page({
  data: {
    loading: true,
    role: '',
    chefTab: 'dishes',
    categories: [],
    dishes: [],
    selectedCategoryId: '',
    selectedCategoryName: '',
    selectedCategoryIsDefault: true,
    selectedCategorySystemType: '',
    categoryDishes: [],
    categoryAddedDishIds: [],
    categoryRemovedDishIds: [],
    categoryDirty: false,
    categorySaving: false,
    categorySortMode: false,
    categoryOrderSaving: false,
    customCategories: [],
    fixedCategories: [],
    categorySortAreaHeight: 0,
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
    if (this.data.categoryDirty) {
      wx.showToast({ title: '请先保存当前勾选', icon: 'none' })
      wx.stopPullDownRefresh()
      return
    }
    await this.loadData()
    wx.stopPullDownRefresh()
  },

  /** 根据角色加载菜品、星期菜单或个人订单。 */
  async loadData(preferredCategoryId = '') {
    this.setData({ loading: true })
    try {
      if (this.data.role === 'chef') {
        const [catalog, meals] = await Promise.all([
          api.call('menu', 'chefCatalog'),
          api.call('menu', 'chefMeals')
        ])
        const categoryMap = Object.fromEntries(catalog.categories.map(category => [category._id, category.name]))
        const dishes = catalog.dishes.map(dish => ({
          ...dish,
          categoryName: categoryMap[dish.categoryId] || '未分类',
          stockText: dish.stockUnlimited ? '无限' : String(dish.stock || 0)
        }))
        const categories = catalog.categories.map(category => ({
          ...category,
          dishCount: dishes.filter(dish => dish.categoryId === category._id).length
        }))
        const groupedMeals = Array.from({ length: 7 }, (_, index) => {
          const weekday = index + 1
          const dayMeals = meals.filter(meal => Number(meal.weekday) === weekday)
          return {
            _id: `weekday-${weekday}`,
            weekday,
            weekdayLabel: WEEKDAY_LABELS[weekday],
            mealSummary: Object.keys(MEAL_TYPE_LABELS).map(mealType => {
              const meal = dayMeals.find(item => item.mealType === mealType)
              return `${MEAL_TYPE_LABELS[mealType]} ${(meal && meal.dishIds ? meal.dishIds.length : 0)} 道`
            }).join(' · ')
          }
        })
        const selectedCategoryId = categories.some(category => category._id === (preferredCategoryId || this.data.selectedCategoryId))
          ? preferredCategoryId || this.data.selectedCategoryId
          : (categories.find(category => category.systemType === 'uncategorized') || categories[0] || {})._id || ''
        const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
        const categoryRowHeight = windowInfo.windowWidth * 108 / 750
        const customCategories = categories.filter(category => !category.isDefault).map((category, index) => ({ ...category, dragY: index * categoryRowHeight }))
        const fixedCategories = categories.filter(category => category.isDefault)
          .sort((left, right) => Number(left.sort) - Number(right.sort))
        this.setData({
          categories,
          dishes,
          meals: groupedMeals,
          customCategories,
          fixedCategories,
          categorySortAreaHeight: customCategories.length * categoryRowHeight,
          loading: false
        })
        this.categoryRowHeight = categoryRowHeight
        this.categoryDragY = {}
        this.showCategory(selectedCategoryId)
      } else {
        const orders = await api.call('order', 'myOrders')
        this.setData({
          orders: orders.map(order => ({
            ...order,
            statusLabel: ORDER_LABELS[order.status],
            weekdayLabel: order.weekdayLabel || WEEKDAY_LABELS[order.weekday] || '历史菜单',
            mealTypeLabel: order.mealTypeLabel || MEAL_TYPE_LABELS[order.mealType] || ''
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
  async switchChefTab(event) {
    const chefTab = event.currentTarget.dataset.tab
    if (chefTab === this.data.chefTab) return
    let discardedCategorySelection = false
    if (this.data.categoryDirty) {
      const result = await wx.showModal({ title: '放弃未保存的勾选？', content: '切换页面后，本次勾选不会保存。' })
      if (!result.confirm) return
      discardedCategorySelection = true
    }
    this.setData({ chefTab })
    if (discardedCategorySelection) this.showCategory(this.data.selectedCategoryId)
  },

  /** 新建菜品分类。 */
  async addCategory() {
    if (this.data.categoryDirty) return wx.showToast({ title: '请先保存当前批量归类', icon: 'none' })
    const result = await wx.showModal({ title: '新增分类', editable: true, placeholderText: '例如：家常菜、汤羹' })
    if (!result.confirm || !result.content.trim()) return
    try {
      const category = await api.call('menu', 'saveCategory', { name: result.content })
      await this.loadData(category._id)
    } catch (error) { api.showError(error) }
  },

  /** 开启或关闭自定义分类拖动排序模式。 */
  toggleCategorySort() {
    if (this.data.categoryDirty) return wx.showToast({ title: '请先保存当前批量归类', icon: 'none' })
    this.setData({ categorySortMode: !this.data.categorySortMode })
  },

  /** 记录分类拖动中的纵向位置。 */
  onCategoryDrag(event) {
    if (event.detail.source === 'touch') this.categoryDragY[event.currentTarget.dataset.id] = event.detail.y
  },

  /** 保存拖动后的自定义分类顺序。 */
  async onCategoryDrop(event) {
    if (this.data.categoryOrderSaving) return
    const categoryId = event.currentTarget.dataset.id
    const fromIndex = this.data.customCategories.findIndex(category => category._id === categoryId)
    if (fromIndex < 0) return
    const y = this.categoryDragY[categoryId] === undefined
      ? fromIndex * this.categoryRowHeight
      : Number(this.categoryDragY[categoryId])
    const toIndex = Math.max(0, Math.min(this.data.customCategories.length - 1, Math.round(y / this.categoryRowHeight)))
    const reordered = [...this.data.customCategories]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    const customCategories = reordered.map((category, index) => ({ ...category, dragY: index * this.categoryRowHeight }))
    const categories = [...customCategories, ...this.data.fixedCategories]
    this.setData({ customCategories, categories, categoryOrderSaving: true })
    try {
      await api.call('menu', 'saveCategoryOrder', { categoryIds: customCategories.map(category => category._id) })
    } catch (error) {
      api.showError(error)
      await this.loadData(this.data.selectedCategoryId)
    } finally {
      this.setData({ categoryOrderSaving: false })
    }
  },

  /** 在左侧选择分类，并在右侧展示可批量归类的菜品。 */
  async selectCategory(event) {
    const categoryId = event.currentTarget.dataset.id
    if (categoryId === this.data.selectedCategoryId) return
    if (this.data.categoryDirty) {
      const result = await wx.showModal({ title: '放弃未保存的归类？', content: '切换分类后，本次勾选不会保存。' })
      if (!result.confirm) return
    }
    this.showCategory(categoryId)
  },

  /** 根据选中分类整理左右两列展示数据。 */
  showCategory(categoryId) {
    const category = this.data.categories.find(item => item._id === categoryId)
    if (!category) return
    const checkedIds = this.data.dishes.filter(dish => dish.categoryId === categoryId).map(dish => dish._id)
    const checkedSet = new Set(checkedIds)
    const defaultCategory = this.data.categories.find(item => item.systemType === 'uncategorized')
    const isUncategorized = category.systemType === 'uncategorized'
    const categoryDishes = (isUncategorized
      ? this.data.dishes.filter(dish => checkedSet.has(dish._id))
      : this.data.dishes
        .filter(dish => dish.categoryId === categoryId || (defaultCategory && dish.categoryId === defaultCategory._id))
        .sort((left, right) => Number(checkedSet.has(right._id)) - Number(checkedSet.has(left._id))
          || (Number.isFinite(Number(left.sort)) ? Number(left.sort) : 9999) - (Number.isFinite(Number(right.sort)) ? Number(right.sort) : 9999))
    ).map(dish => ({
      ...dish,
      checked: checkedSet.has(dish._id),
      categoryDisplay: checkedSet.has(dish._id) ? category.name : dish.categoryName
    }))
    this.setData({
      selectedCategoryId: categoryId,
      selectedCategoryName: category.name,
      selectedCategoryIsDefault: isUncategorized,
      selectedCategorySystemType: category.systemType || '',
      categoryDishes,
      categoryAddedDishIds: [],
      categoryRemovedDishIds: [],
      categoryDirty: false
    })
  },

  /** 记录用户明确勾选或取消的单道菜，避免从完整复选框列表推断其他菜品。 */
  toggleCategoryDish(event) {
    const dishId = event.currentTarget.dataset.id
    const dish = this.data.categoryDishes.find(item => item._id === dishId)
    if (!dish || dish.isSystemDish) return
    const checked = !dish.checked
    const originallyChecked = dish.categoryId === this.data.selectedCategoryId
    const addedSet = new Set(this.data.categoryAddedDishIds)
    const removedSet = new Set(this.data.categoryRemovedDishIds)
    addedSet.delete(dishId)
    removedSet.delete(dishId)
    if (checked !== originallyChecked) {
      if (checked) addedSet.add(dishId)
      else removedSet.add(dishId)
    }
    this.setData({
      categoryAddedDishIds: [...addedSet],
      categoryRemovedDishIds: [...removedSet],
      categoryDishes: this.data.categoryDishes.map(item => item._id === dishId
        ? {
          ...item,
          checked,
          categoryDisplay: checked
            ? this.data.selectedCategoryName
            : originallyChecked ? '保存后移回未分类' : item.categoryName
        }
        : item),
      categoryDirty: addedSet.size > 0 || removedSet.size > 0
    })
  },

  /** 只保存本次明确移入或移出的菜品。 */
  async saveCategoryDishes() {
    if (this.data.selectedCategoryIsDefault || !this.data.categoryDirty) return
    this.setData({ categorySaving: true })
    try {
      await api.call('menu', 'batchSetCategory', {
        categoryId: this.data.selectedCategoryId,
        addDishIds: this.data.categoryAddedDishIds,
        removeDishIds: this.data.categoryRemovedDishIds,
        versions: Object.fromEntries(this.data.dishes.map(dish => [dish._id, dish.version]))
      })
      wx.showToast({ title: '批量归类已保存', icon: 'success' })
      await this.loadData(this.data.selectedCategoryId)
    } catch (error) { api.showError(error) } finally { this.setData({ categorySaving: false }) }
  },

  /** 打开分类的修改或删除操作。 */
  async manageCategory(event) {
    if (this.data.categoryDirty) return wx.showToast({ title: '请先保存当前批量归类', icon: 'none' })
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
    await this.loadData(category._id)
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
    const defaultCategory = this.data.categories.find(item => item.systemType === 'uncategorized')
    await this.loadData(defaultCategory ? defaultCategory._id : '')
  },

  /** 打开预置菜品的分类与库存设置页。 */
  editDish(event) {
    if (this.data.categoryDirty) return wx.showToast({ title: '请先保存当前批量归类', icon: 'none' })
    const id = event.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/dish-edit/index?id=${id}` })
  },

  /** 仅在“未分类”中打开新增菜品页。 */
  addDish() {
    if (this.data.selectedCategorySystemType !== 'uncategorized') return
    wx.navigateTo({ url: '/pages/dish-edit/index' })
  },

  /** 删除“未分类”中的菜品。 */
  async removeDish(event) {
    const dish = this.data.dishes.find(item => item._id === event.currentTarget.dataset.id)
    if (!dish || this.data.selectedCategorySystemType !== 'uncategorized') return
    const result = await wx.showModal({ title: `删除“${dish.name}”？`, content: '删除后不会影响历史订单，但会从后续菜单中移除。' })
    if (!result.confirm) return
    try {
      await api.call('menu', 'deleteDish', { dishId: dish._id, version: dish.version })
      wx.showToast({ title: '菜品已删除', icon: 'success' })
      await this.loadData(this.data.selectedCategoryId)
    } catch (error) { api.showError(error) }
  },

  /** 打开指定星期的菜单编辑页。 */
  editMeal(event) {
    const weekday = event.currentTarget.dataset.weekday
    wx.navigateTo({ url: `/pages/meal-edit/index?weekday=${weekday}` })
  },

  /** 打开订单详情。 */
  openOrder(event) {
    wx.navigateTo({ url: `/pages/order-detail/index?id=${event.currentTarget.dataset.id}` })
  }
})
