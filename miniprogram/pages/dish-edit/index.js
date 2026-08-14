const api = require('../../utils/api')
const { requireActiveSession } = require('../../utils/session')

Page({
  data: {
    dishId: '',
    isNew: false,
    version: 0,
    categories: [],
    categoryIndex: 0,
    name: '',
    stockUnlimited: false,
    stock: 0,
    saving: false
  },

  onLoad(options) {
    this.setData({ dishId: options.id || '', isNew: !options.id })
    if (!options.id) wx.setNavigationBarTitle({ title: '添加菜品' })
    this.loadDish()
  },

  /** 加载菜品设置；新增菜品时固定放入“未分类”。 */
  async loadDish() {
    try {
      const session = await requireActiveSession()
      if (!session || session.user.role !== 'chef') return wx.navigateBack()
      const catalog = await api.call('menu', 'chefCatalog')
      if (this.data.isNew) {
        const defaultIndex = catalog.categories.findIndex(item => item.systemType === 'uncategorized')
        this.setData({ categories: catalog.categories, categoryIndex: Math.max(0, defaultIndex) })
        return
      }
      const dish = catalog.dishes.find(item => item._id === this.data.dishId)
      if (!dish) throw new Error('菜品不存在')
      this.setData({
        categories: catalog.categories,
        categoryIndex: Math.max(0, catalog.categories.findIndex(item => item._id === dish.categoryId)),
        version: dish.version,
        name: dish.name,
        stockUnlimited: Boolean(dish.stockUnlimited),
        stock: Number(dish.stock || 0)
      })
    } catch (error) { api.showError(error) }
  },

  /** 选择菜品分类。 */
  onCategoryChange(event) { this.setData({ categoryIndex: Number(event.detail.value) }) },

  /** 在有限库存和无限库存之间切换。 */
  onStockMode(event) { this.setData({ stockUnlimited: event.detail.value === 'unlimited' }) },

  /** 修改有限库存数量。 */
  onStock(event) { this.setData({ stock: event.detail.value }) },

  /** 修改新增菜品名称。 */
  onName(event) { this.setData({ name: event.detail.value }) },

  /** 保存菜品分类和库存。 */
  async save() {
    const category = this.data.categories[this.data.categoryIndex]
    const stock = Number(this.data.stock)
    if (!category || (this.data.isNew && !this.data.name.trim()) || (!this.data.stockUnlimited && (!Number.isInteger(stock) || stock < 0))) {
      wx.showToast({ title: '请正确填写分类和库存', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      await api.call('menu', 'saveDish', {
        dishId: this.data.dishId,
        name: this.data.name,
        version: this.data.version,
        categoryId: category._id,
        stockUnlimited: this.data.stockUnlimited,
        stock
      })
      wx.showToast({ title: this.data.isNew ? '菜品已添加' : '菜品设置已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (error) { api.showError(error) } finally { this.setData({ saving: false }) }
  }
})
