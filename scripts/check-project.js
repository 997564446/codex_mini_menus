const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const appJsonPath = path.join(root, 'miniprogram/app.json')
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'))
const failures = []

/** 检查文件是否存在，并把缺失项加入失败列表。 */
function expectFile(relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) failures.push(`缺少文件：${relativePath}`)
}

for (const page of appJson.pages) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) expectFile(`miniprogram/${page}.${extension}`)
}

for (const name of ['identity', 'family', 'menu', 'order']) {
  expectFile(`cloudfunctions/${name}/index.js`)
  expectFile(`cloudfunctions/${name}/package.json`)
  expectFile(`cloudfunctions/${name}/config.json`)
}

function collectFiles(directory, extension, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory() && entry.name !== 'node_modules') collectFiles(target, extension, output)
    else if (entry.isFile() && target.endsWith(extension)) output.push(target)
  }
  return output
}

for (const file of collectFiles(root, '.json')) {
  try { JSON.parse(fs.readFileSync(file, 'utf8')) } catch (error) { failures.push(`JSON 无效：${path.relative(root, file)} - ${error.message}`) }
}

for (const file of collectFiles(root, '.js')) {
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }) } catch (error) {
    failures.push(`JavaScript 语法错误：${path.relative(root, file)} - ${String(error.stderr || error.message).trim()}`)
  }
}

const voidTags = new Set(['input', 'image', 'switch', 'radio', 'checkbox', 'icon', 'progress'])
for (const file of collectFiles(path.join(root, 'miniprogram'), '.wxml')) {
  const content = fs.readFileSync(file, 'utf8')
  const stack = []
  const tagPattern = /<\s*(\/?)\s*([\w-]+)([^>]*)>/g
  let match
  while ((match = tagPattern.exec(content))) {
    const [, closing, tag, tail] = match
    if (closing) {
      if (stack.pop() !== tag) {
        failures.push(`WXML 标签未配对：${path.relative(root, file)} 的 </${tag}>`)
        break
      }
    } else if (!voidTags.has(tag) && !tail.trimEnd().endsWith('/')) {
      stack.push(tag)
    }
  }
  if (stack.length) failures.push(`WXML 标签未闭合：${path.relative(root, file)} 的 <${stack.at(-1)}>`)
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`结构检查通过：${appJson.pages.length} 个页面，4 个云函数，JSON、JavaScript 与 WXML 结构有效。`)
