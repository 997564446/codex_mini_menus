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
    stock: '',
    price: '',
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
        stock: Number(dish.stock || 0),
        price: (Number(dish.priceCents || 0) / 100).toFixed(2).replace(/\.00$/, '')
      })
    } catch (error) { api.showError(error) }
  },

  /** 选择菜品分类。 */
  onCategoryChange(event) { this.setData({ categoryIndex: Number(event.detail.value) }) },

  /** 在有限库存和无限库存之间切换。 */
  onStockMode(event) { this.setData({ stockUnlimited: event.detail.value === 'unlimited' }) },

  /** 修改有限库存数量。 */
  onStock(event) { this.setData({ stock: event.detail.value }) },

  /** 修改菜品单价，页面使用元展示，提交时换算为整数分。 */
  onPrice(event) { this.setData({ price: event.detail.value }) },

  /** 修改新增菜品名称。 */
  onName(event) { this.setData({ name: event.detail.value }) },

  /** 保存菜品分类、库存和单价；新增时三项业务字段都必须填写。 */
  async save() {
    const category = this.data.categories[this.data.categoryIndex]
    const stockText = String(this.data.stock).trim()
    const priceText = String(this.data.price).trim()
    if (!category) {
      wx.showToast({ title: '请选择分类', icon: 'none' })
      return
    }
    if (this.data.isNew && !this.data.name.trim()) {
      wx.showToast({ title: '请输入菜品名称', icon: 'none' })
      return
    }
    if (!this.data.stockUnlimited && (!/^\d+$/.test(stockText) || Number(stockText) > 9999)) {
      wx.showToast({ title: '请输入 0 至 9999 的库存', icon: 'none' })
      return
    }
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(priceText)) {
      wx.showToast({ title: '请输入 0 至 9999.99 元的单价', icon: 'none' })
      return
    }
    const stock = this.data.stockUnlimited ? 0 : Number(stockText)
    const priceCents = Math.round(Number(priceText) * 100)
    this.setData({ saving: true })
    try {
      await api.call('menu', 'saveDish', {
        dishId: this.data.dishId,
        name: this.data.name,
        version: this.data.version,
        categoryId: category._id,
        stockUnlimited: this.data.stockUnlimited,
        stock,
        priceCents
      })
      wx.showToast({ title: this.data.isNew ? '菜品已添加' : '菜品设置已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (error) { api.showError(error) } finally { this.setData({ saving: false }) }
  }
})
