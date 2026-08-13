Component({
  data: {
    selected: 0,
    role: 'diner',
    dinerTabs: [
      { pagePath: '/pages/home/index', text: '点餐', icon: '🍲' },
      { pagePath: '/pages/manage/index', text: '订单', icon: '🧾' },
      { pagePath: '/pages/account/index', text: '我的', icon: '🏠' }
    ],
    chefTabs: [
      { pagePath: '/pages/home/index', text: '厨房', icon: '👩‍🍳' },
      { pagePath: '/pages/manage/index', text: '菜单', icon: '📖' },
      { pagePath: '/pages/account/index', text: '家庭', icon: '👨‍👩‍👧' }
    ]
  },

  methods: {
    /**
     * 切换主导航页面。
     * @param {WechatMiniprogram.TouchEvent} event 点击事件
     */
    switchTab(event) {
      const tabs = this.data.role === 'chef' ? this.data.chefTabs : this.data.dinerTabs
      const index = Number(event.currentTarget.dataset.index)
      if (index === this.data.selected) return
      wx.switchTab({ url: tabs[index].pagePath })
    }
  }
})
