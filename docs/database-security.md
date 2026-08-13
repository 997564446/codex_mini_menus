# 云数据库安全配置

本项目不允许小程序客户端直接读写云数据库，所有访问必须经过 `identity`、`family`、`menu`、`order` 四个云函数。

在云开发控制台依次创建以下集合，并把每个集合的数据权限设置为“所有用户不可读写”或等价的自定义安全规则：

`system_config`、`families`、`users`、`join_applications`、`categories`、`dishes`、`meal_menus`、`orders`、`notifications`、`notification_logs`、`audit_logs`。

这样设置不会阻止云函数使用服务端权限访问，但可以阻止客户端绕过角色、`familyId`、订单版本号和状态机校验。

## 初始化记录

先运行：

```bash
node scripts/hash-passphrase.js "仅厨师知道的一次性口令"
```

把输出 JSON 原样添加到 `system_config` 集合，文档 ID 必须是 `global`。厨师认领成功后，云函数会在同一事务中把 `initialized` 改为 `true`、清空口令摘要，并记录唯一 `familyId`。
