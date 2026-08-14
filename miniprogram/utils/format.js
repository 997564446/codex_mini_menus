const WEEKDAY_LABELS = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' }
const MEAL_TYPE_LABELS = { breakfast: '早餐', lunch: '中餐', dinner: '晚餐' }
const MEAL_DEADLINE_HOURS = { breakfast: 9, lunch: 14, dinner: 21 }
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

/**
 * 返回食客可下单的今天、明天和后天。
 * @returns {Array<object>} 三天日期选项
 */
function orderDateOptions() {
  const today = new Date()
  return Array.from({ length: 3 }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() + index)
    const weekday = date.getDay() || 7
    return {
      value: dateKey(date),
      weekday,
      day: WEEKDAY_LABELS[weekday],
      short: `${date.getMonth() + 1}/${date.getDate()}`,
      isToday: index === 0,
      relativeLabel: index === 0 ? '今天' : index === 1 ? '明天' : '后天'
    }
  })
}

/**
 * 计算客户端展示用的餐别截止状态，服务端仍会再次校验。
 * @param {string} date 用餐日期
 * @param {string} mealType 餐别
 * @param {Date} now 当前时间
 * @returns {object} 是否截止及文案
 */
function mealAvailability(date, mealType, now = new Date()) {
  const hour = MEAL_DEADLINE_HOURS[mealType]
  const label = MEAL_TYPE_LABELS[mealType] || ''
  if (!hour || !date) return { closed: true, deadlineText: '不可点餐' }
  const deadline = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+08:00`)
  return { closed: now.getTime() >= deadline.getTime(), deadlineText: `${label}当天 ${hour}:00 截止` }
}

module.exports = {
  WEEKDAY_LABELS,
  MEAL_TYPE_LABELS,
  ORDER_LABELS,
  dateKey,
  weekOptions,
  orderDateOptions,
  mealAvailability
}
