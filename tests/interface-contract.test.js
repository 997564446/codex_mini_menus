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
