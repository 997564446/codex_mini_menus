const crypto = require('crypto')

/**
 * 计算口令摘要，数据库只保存摘要而不保存明文。
 * @param {string} value 明文口令
 * @returns {string} SHA-256 摘要
 */
function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value || '').trim()).digest('hex')
}

/**
 * 使用恒定时间比较摘要，降低口令比较的时序泄露风险。
 * @param {string} actual 实际摘要
 * @param {string} expected 预期摘要
 * @returns {boolean} 是否一致
 */
function safeEqual(actual, expected) {
  const left = Buffer.from(String(actual || ''))
  const right = Buffer.from(String(expected || ''))
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

module.exports = { hashSecret, safeEqual }
