const api = require('../../utils/api')
const { requireActiveSession } = require('../../utils/session')
const { requirePrivacyAuthorization } = require('../../utils/privacy')

Page({
  data: {
    dishId: '',
    version: 0,
    categories: [],
    categoryIndex: 0,
    name: '',
    description: '',
    priceYuan: '',
    imageFileId: '',
    specs: [],
    saving: false
  },

  onLoad(options) {
    this.setData({ dishId: options.id || '' })
    this.loadDish()
  },

  /** 加载分类与待编辑菜品。 */
  async loadDish() {
    try {
      const session = await requireActiveSession()
      if (!session || session.user.role !== 'chef') return wx.navigateBack()
      const catalog = await api.call('menu', 'chefCatalog')
      const dish = catalog.dishes.find(item => item._id === this.data.dishId)
      const categoryIndex = dish ? Math.max(0, catalog.categories.findIndex(item => item._id === dish.categoryId)) : 0
      this.setData({
        categories: catalog.categories,
        categoryIndex,
        version: dish ? dish.version : 0,
        name: dish ? dish.name : '',
        description: dish ? dish.description : '',
        priceYuan: dish ? (dish.priceCents / 100).toFixed(2) : '',
        imageFileId: dish ? dish.imageFileId : '',
        specs: dish ? (dish.specs || []).map(spec => ({ ...spec, optionText: spec.options.join('，') })) : []
      })
    } catch (error) { api.showError(error) }
  },

  /** 同步普通表单字段。 */
  onInput(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value })
  },

  /** 选择菜品分类。 */
  onCategoryChange(event) { this.setData({ categoryIndex: Number(event.detail.value) }) },

  /** 从相册选择菜品图片并上传云存储。 */
  async chooseImage() {
    try {
      await requirePrivacyAuthorization()
      const media = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'] })
      const file = media.tempFiles[0]
      const extension = (file.tempFilePath.match(/\.[a-zA-Z0-9]+$/) || ['.jpg'])[0]
      wx.showLoading({ title: '正在上传' })
      const result = await wx.cloud.uploadFile({
        cloudPath: `dish-images/${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`,
        filePath: file.tempFilePath
      })
      this.setData({ imageFileId: result.fileID })
    } catch (error) {
      if (!String(error.errMsg || '').includes('cancel')) api.showError(error)
    } finally { wx.hideLoading() }
  },

  /** 添加一组默认单选规格。 */
  addSpec() {
    this.setData({ specs: [...this.data.specs, { name: '', type: 'single', required: false, options: [], optionText: '' }] })
  },

  /** 修改规格名称或选项文本。 */
  onSpecInput(event) {
    const { index, field } = event.currentTarget.dataset
    const path = `specs[${index}].${field}`
    this.setData({ [path]: event.detail.value })
  },

  /** 切换规格为单选或多选。 */
  onSpecType(event) {
    this.setData({ [`specs[${event.currentTarget.dataset.index}].type`]: event.detail.value })
  },

  /** 设置规格是否必选。 */
  onSpecRequired(event) {
    this.setData({ [`specs[${event.currentTarget.dataset.index}].required`]: event.detail.value })
  },

  /** 删除一组规格。 */
  removeSpec(event) {
    const specs = this.data.specs.filter((_, index) => index !== Number(event.currentTarget.dataset.index))
    this.setData({ specs })
  },

  /** 保存菜品并返回菜品库。 */
  async save() {
    const category = this.data.categories[this.data.categoryIndex]
    const price = Number(this.data.priceYuan)
    if (!category || !this.data.name.trim() || !Number.isFinite(price) || price < 0) {
      wx.showToast({ title: '请填写菜名、分类和价格', icon: 'none' })
      return
    }
    const specs = this.data.specs.map(spec => ({
      name: spec.name,
      type: spec.type,
      required: spec.required,
      options: String(spec.optionText || '').split(/[，,]/).map(value => value.trim()).filter(Boolean)
    }))
    this.setData({ saving: true })
    try {
      await api.call('menu', 'saveDish', {
        dishId: this.data.dishId,
        version: this.data.version,
        name: this.data.name,
        description: this.data.description,
        priceCents: Math.round(price * 100),
        imageFileId: this.data.imageFileId,
        categoryId: category._id,
        specs
      })
      wx.showToast({ title: '菜品保存好了', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (error) { api.showError(error) } finally { this.setData({ saving: false }) }
  }
})
