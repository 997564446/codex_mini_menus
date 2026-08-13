const WEEKDAY_LABELS = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' }
const ORDER_LABELS = {
  pending: '待确认',
  confirmed: '已确认',
  cooking: '制作中',
  ready: '可取餐',
  completed: '已完成',
  cancelled: '已取消'
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
 * 返回本周周一至周日的日期选项。
 * @returns {Array<object>} 本周日期选项
 */
function weekOptions() {
  const today = new Date()
  const monday = new Date(today)
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + index)
    return {
      value: dateKey(date),
      weekday: index + 1,
      day: WEEKDAY_LABELS[index + 1],
      short: `${date.getMonth() + 1}/${date.getDate()}`,
      isToday: dateKey(date) === dateKey(today),
      isPast: dateKey(date) < dateKey(today)
    }
  })
}

module.exports = { WEEKDAY_LABELS, ORDER_LABELS, dateKey, weekOptions }
