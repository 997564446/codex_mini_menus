const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

function walk(directory, extension, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(file, extension, output)
    else if (file.endsWith(extension)) output.push(file)
  }
  return output
}

test('客户端显式调用的云函数动作都存在服务端路由', () => {
  const clientSource = walk(path.join(root, 'miniprogram'), '.js').map(file => fs.readFileSync(file, 'utf8')).join('\n')
  const calls = [...clientSource.matchAll(/api\.call\(['"](identity|family|menu|order)['"],\s*['"]([\w]+)['"]/g)]
  assert.ok(calls.length > 10, '应识别到主要客户端接口调用')

  const routeCache = {}
  for (const [, functionName, action] of calls) {
    if (!routeCache[functionName]) {
      const serverSource = fs.readFileSync(path.join(root, `cloudfunctions/${functionName}/index.js`), 'utf8')
      routeCache[functionName] = new Set([...serverSource.matchAll(/case ['"]([\w]+)['"]:/g)].map(match => match[1]))
    }
    assert.equal(routeCache[functionName].has(action), true, `${functionName}.${action} 缺少服务端路由`)
  }
})

test('四个云函数都使用微信上下文身份且返回统一响应字段', () => {
  for (const name of ['identity', 'family', 'menu', 'order']) {
    const source = fs.readFileSync(path.join(root, `cloudfunctions/${name}/index.js`), 'utf8')
    assert.match(source, /cloud\.getWXContext\(\)/, `${name} 必须从微信上下文取身份`)
    assert.match(source, /requestId/, `${name} 必须返回问题编号`)
    assert.match(source, /error:\s*\{\s*code,\s*message\s*\}/, `${name} 必须使用统一错误结构`)
  }
})

test('新订单订阅消息使用预约通知模板的五个固定字段', () => {
  const source = fs.readFileSync(path.join(root, 'cloudfunctions/order/index.js'), 'utf8')
  for (const key of ['name1', 'date3', 'thing13', 'character_string54', 'thing7']) {
    assert.match(source, new RegExp(`\\b${key}\\s*:`), `订阅消息缺少字段 ${key}`)
  }
  for (const obsoleteKey of ['thing1', 'thing2', 'thing3', 'amount4']) {
    assert.doesNotMatch(source, new RegExp(`\\b${obsoleteKey}\\s*:`), `仍在使用旧模板字段 ${obsoleteKey}`)
  }
})

test('三餐订单按餐别唯一并配置提前订单定时提醒', () => {
  const menuSource = fs.readFileSync(path.join(root, 'cloudfunctions/menu/index.js'), 'utf8')
  const orderSource = fs.readFileSync(path.join(root, 'cloudfunctions/order/index.js'), 'utf8')
  const orderConfig = JSON.parse(fs.readFileSync(path.join(root, 'cloudfunctions/order/config.json'), 'utf8'))
  assert.match(menuSource, /weekly_\$\{familyKey\}_\$\{weekday\}_\$\{mealType\}/)
  assert.match(orderSource, /\$\{orderDate\}\|\$\{meal\.mealType\}/)
  assert.match(orderSource, /event\.Type === 'Timer'/)
  assert.match(orderSource, /客户端不能触发定时提醒/)
  assert.equal(orderConfig.triggers[0].type, 'timer')
  assert.equal(orderConfig.triggers[0].config, '0 0,5 2,9,22 * * * *')
})

test('厨师和食客页面包含分类双列与当前分类全选入口', () => {
  const menuSource = fs.readFileSync(path.join(root, 'cloudfunctions/menu/index.js'), 'utf8')
  const manageSource = fs.readFileSync(path.join(root, 'miniprogram/pages/manage/index.js'), 'utf8')
  const mealEdit = fs.readFileSync(path.join(root, 'miniprogram/pages/meal-edit/index.wxml'), 'utf8')
  const orderEdit = fs.readFileSync(path.join(root, 'miniprogram/pages/order-edit/index.wxml'), 'utf8')
  const orderEditLogic = fs.readFileSync(path.join(root, 'miniprogram/pages/order-edit/index.js'), 'utf8')
  assert.match(menuSource, /系统菜品不能移动分类/)
  assert.match(manageSource, /addDishIds:\s*this\.data\.categoryAddedDishIds/)
  assert.match(manageSource, /removeDishIds:\s*this\.data\.categoryRemovedDishIds/)
  assert.match(mealEdit, /category-sidebar/)
  assert.match(mealEdit, /toggleSelectAll/)
  assert.match(orderEdit, /order-category-sidebar/)
  assert.match(orderEdit, /order-dish-panel/)
  assert.match(orderEditLogic, /不吃主食会低血糖的噢/)
})

test('手动添加菜品要求填写名称、库存和单价', () => {
  const dishEdit = fs.readFileSync(path.join(root, 'miniprogram/pages/dish-edit/index.wxml'), 'utf8')
  const dishEditLogic = fs.readFileSync(path.join(root, 'miniprogram/pages/dish-edit/index.js'), 'utf8')
  const menuSource = fs.readFileSync(path.join(root, 'cloudfunctions/menu/index.js'), 'utf8')
  assert.match(dishEdit, /菜品名称（必填）/)
  assert.match(dishEdit, /库存数量（必填）/)
  assert.match(dishEdit, /单价（必填）/)
  assert.match(dishEditLogic, /priceCents/)
  assert.match(menuSource, /PRESET_DISH_VERSION = '1\.2\.2-5'/)
})
