const crypto = require('crypto')

const passphrase = process.argv[2]
if (!passphrase || !passphrase.trim()) {
  console.error('用法：node scripts/hash-passphrase.js "你的初始化口令"')
  process.exit(1)
}

const hash = crypto.createHash('sha256').update(passphrase.trim()).digest('hex')
console.log(JSON.stringify({
  _id: 'global',
  initialized: false,
  chefPassphraseHash: hash,
  chefOrderTemplateId: '',
  miniprogramState: 'formal',
  qrEnvVersion: 'release'
}, null, 2))
