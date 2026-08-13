const MEAL_LABELS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' }
const ORDER_LABELS = {
  pending: '待确认',
  confirmed: '已确认',
  cooking: '制作中',
  ready: '可取餐',
  completed: '已完成',
  cancelled: '已取消'
}

/**
 * 将分转换为带两位小数的元展示文本。
 * @param {number} cents 金额（分）
 * @returns {string} 金额文本
 */
function money(cents) {
  return (Number(cents || 0) / 100).toFixed(2)
}

/**
 * 生成本地日期 YYYY-MM-DD，避免 UTC 日期跨天。
 * @param {Date} date 日期对象
 * @returns {string} 日期文本
 */
function dateKey(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 返回未来若干天的日期选项。
 * @param {number} count 天数
 * @returns {Array<object>} 日期选项
 */
function dateOptions(count = 7) {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return Array.from({ length: count }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() + index)
    return {
      value: dateKey(date),
      day: index === 0 ? '今天' : index === 1 ? '明天' : weekdays[date.getDay()],
      short: `${date.getMonth() + 1}/${date.getDate()}`
    }
  })
}

module.exports = { MEAL_LABELS, ORDER_LABELS, money, dateKey, dateOptions }
