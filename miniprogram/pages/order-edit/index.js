const api = require('../../utils/api')
const { requireActiveSession } = require('../../utils/session')

function decorateSpecs(specs, selectedSpecs) {
  return (specs || []).map(spec => ({
    ...spec,
    options: spec.options.map(value => ({ value, checked: (selectedSpecs[spec.name] || []).includes(value) }))
  }))
}

Page({
  data: {
    loading: true,
    mealMenuId: '',
    date: '',
    meal: null,
    categories: [],
    dishes: [],
    selectedCategoryId: '',
    selectedCategoryName: '',
    categoryDishes: [],
    existingOrder: null,
    note: '',
    selectedCount: 0,
    saving: false
  },

  onLoad(options) {
    this.setData({ mealMenuId: options.mealMenuId || '', date: options.date || '' })
    this.loadData()
  },

  /** 加载当天星期菜单与当前食客可能存在的待确认订单。 */
  async loadData() {
    try {
      const session = await requireActiveSession()
      if (!session || session.user.role !== 'diner') return wx.navigateBack()
      const [meal, orders] = await Promise.all([
        api.call('menu', 'mealDetail', { mealMenuId: this.data.mealMenuId, date: this.data.date }),
        api.call('order', 'myOrders')
      ])
      const existingOrder = orders.find(order => order.mealMenuId === meal._id && order.mealDate === this.data.date) || null
      const existingMap = Object.fromEntries(((existingOrder && existingOrder.items) || []).map(item => [item.dishId, item]))
      const dishes = meal.dishes.map(dish => {
        const old = existingMap[dish._id]
        const selectedSpecs = old ? old.selectedSpecs : {}
        return {
          ...dish,
          quantity: old ? old.quantity : 0,
          maxQuantity: dish.systemDishType === 'no_staple' ? 1 : dish.stockUnlimited ? 20 : Number(dish.stock || 0) + (old ? old.quantity : 0),
          itemNote: old ? old.note : '',
          selectedSpecs,
          specs: decorateSpecs(dish.specs, selectedSpecs)
        }
      }).sort((left, right) => Number(!left.stockUnlimited && left.maxQuantity <= 0) - Number(!right.stockUnlimited && right.maxQuantity <= 0))
      const categories = (meal.categories || [])
        .filter(category => dishes.some(dish => dish.categoryId === category._id))
        .sort((left, right) => Number(right.systemType === 'staple') - Number(left.systemType === 'staple') || Number(left.sort) - Number(right.sort))
      const firstSelectedDish = dishes.find(dish => dish.quantity > 0)
      const selectedCategoryId = (firstSelectedDish && firstSelectedDish.categoryId) || (categories[0] || {})._id || ''
      this.setData({
        meal,
        categories,
        dishes,
        existingOrder,
        note: existingOrder ? existingOrder.note : '',
        loading: false
      })
      this.showCategory(selectedCategoryId)
      this.recalculate()
    } catch (error) {
      this.setData({ loading: false })
      api.showError(error)
    }
  },

  /** 增减菜品份数，有限库存不能超过当前可用数量。 */
  async changeQuantity(event) {
    const { id, delta } = event.currentTarget.dataset
    const index = this.data.dishes.findIndex(dish => dish._id === id)
    if (index < 0) return
    const dish = this.data.dishes[index]
    const current = dish.quantity
    const next = Math.max(0, Math.min(dish.maxQuantity, current + Number(delta)))
    if (dish.systemDishType === 'no_staple' && current === 0 && next > 0) {
      const result = await wx.showModal({
        title: '确认不要主食？',
        content: '不吃主食会低血糖的噢。',
        confirmText: '确认不要',
        cancelText: '再想想'
      })
      if (!result.confirm) return
    }
    this.setData({ [`dishes[${index}].quantity`]: next })
    this.showCategory(this.data.selectedCategoryId)
    this.recalculate()
  },

  /** 切换左侧分类。 */
  selectCategory(event) {
    this.showCategory(event.currentTarget.dataset.id)
  },

  /** 展示当前分类菜品，零库存菜品固定排在最后。 */
  showCategory(categoryId) {
    const category = this.data.categories.find(item => item._id === categoryId)
    if (!category) return
    const categoryDishes = this.data.dishes
      .filter(dish => dish.categoryId === categoryId)
      .sort((left, right) => Number(!left.stockUnlimited && left.maxQuantity <= 0) - Number(!right.stockUnlimited && right.maxQuantity <= 0))
    this.setData({ selectedCategoryId: categoryId, selectedCategoryName: category.name, categoryDishes })
  },

  /** 修改单选规格。 */
  onSingleSpec(event) {
    this.updateSpecSelection(event.currentTarget.dataset.id, Number(event.currentTarget.dataset.spec), [event.detail.value])
  },

  /** 修改多选规格。 */
  onMultipleSpec(event) {
    this.updateSpecSelection(event.currentTarget.dataset.id, Number(event.currentTarget.dataset.spec), event.detail.value)
  },

  /** 更新规格选择和选项选中展示。 */
  updateSpecSelection(dishId, specIndex, values) {
    const dishIndex = this.data.dishes.findIndex(dish => dish._id === dishId)
    if (dishIndex < 0) return
    const dish = this.data.dishes[dishIndex]
    const spec = dish.specs[specIndex]
    const selectedSpecs = { ...dish.selectedSpecs, [spec.name]: values }
    const options = spec.options.map(option => ({ ...option, checked: values.includes(option.value) }))
    this.setData({
      [`dishes[${dishIndex}].selectedSpecs`]: selectedSpecs,
      [`dishes[${dishIndex}].specs[${specIndex}].options`]: options
    })
    this.showCategory(this.data.selectedCategoryId)
  },

  /** 修改菜品单独备注。 */
  onItemNote(event) {
    const index = this.data.dishes.findIndex(dish => dish._id === event.currentTarget.dataset.id)
    if (index >= 0) {
      const categoryIndex = this.data.categoryDishes.findIndex(dish => dish._id === event.currentTarget.dataset.id)
      const updates = { [`dishes[${index}].itemNote`]: event.detail.value }
      if (categoryIndex >= 0) updates[`categoryDishes[${categoryIndex}].itemNote`] = event.detail.value
      this.setData(updates)
    }
  },

  /** 修改整单备注。 */
  onNote(event) { this.setData({ note: event.detail.value }) },

  /** 重算选中菜品数。 */
  recalculate() {
    const selected = this.data.dishes.filter(dish => dish.quantity > 0)
    this.setData({ selectedCount: selected.length })
  },

  /** 校验必选规格并提交新订单或待确认订单修改。 */
  async submit() {
    if (this.data.existingOrder && this.data.existingOrder.status !== 'pending') {
      wx.showToast({ title: '这份订单已经不能修改', icon: 'none' })
      return
    }
    const selected = this.data.dishes.filter(dish => dish.quantity > 0)
    if (!selected.length) {
      wx.showToast({ title: '至少选一道菜', icon: 'none' })
      return
    }
    const stapleCategory = this.data.categories.find(category => category.systemType === 'staple')
    if (!stapleCategory || !selected.some(dish => dish.categoryId === stapleCategory._id)) {
      wx.showToast({ title: '请选择一种主食', icon: 'none' })
      return
    }
    for (const dish of selected) {
      const missing = dish.specs.find(spec => spec.required && !(dish.selectedSpecs[spec.name] || []).length)
      if (missing) {
        wx.showToast({ title: `${dish.name}还没选${missing.name}`, icon: 'none' })
        return
      }
    }
    this.setData({ saving: true })
    try {
      const result = await api.call('order', 'submit', {
        mealMenuId: this.data.mealMenuId,
        date: this.data.date,
        clientRequestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        version: this.data.existingOrder ? this.data.existingOrder.version : 0,
        note: this.data.note,
        items: selected.map(dish => ({
          dishId: dish._id,
          quantity: dish.quantity,
          selectedSpecs: dish.selectedSpecs,
          note: dish.itemNote
        }))
      })
      wx.showToast({ title: this.data.existingOrder ? '订单修改好了' : '已经告诉厨师啦', icon: 'success' })
      setTimeout(() => wx.redirectTo({ url: `/pages/order-detail/index?id=${result._id}` }), 500)
    } catch (error) { api.showError(error) } finally { this.setData({ saving: false }) }
  }
})
