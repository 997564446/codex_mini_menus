# 云函数接口

客户端统一通过 `wx.cloud.callFunction` 发送 `{ action, payload }`，响应固定为：

```js
{ ok: true, data: {}, error: null, requestId: '...' }
{ ok: false, data: null, error: { code: '...', message: '...' }, requestId: '...' }
```

`openid` 只使用云函数上下文中的值，任何接口都不接收客户端传入的用户身份。

## `identity`

| action | payload | 权限 | 说明 |
|---|---|---|---|
| `session` | 无 | 公开 | 初始化状态与当前会话 |
| `claimChef` | `familyName`、`displayName`、`passphrase` | 未初始化 | 事务认领唯一厨师 |
| `updateProfile` | `displayName`、`relation` | 已登记用户 | 修改本人资料 |
| `markSubscription` | `enabled` | 厨师 | 记录一次订阅授权 |

## `family`

| action | payload | 权限 | 说明 |
|---|---|---|---|
| `applyJoin` | `inviteCode`、`displayName`、`relation` | 非活跃食客 | 申请加入家庭 |
| `refreshInvite` | 无 | 厨师 | 刷新邀请码 |
| `createInviteQr` | `inviteCode` | 厨师 | 生成当前邀请码小程序码 |
| `overview` | 无 | 厨师 | 申请与成员列表 |
| `reviewApplication` | `applicationId`、`decision` | 厨师 | 同意或拒绝申请 |
| `setMemberStatus` | `memberId`、`status` | 厨师 | 暂停或恢复食客 |

## `menu`

| action | 主要 payload | 权限 | 说明 |
|---|---|---|---|
| `chefCatalog` | 无 | 厨师 | 分类和菜品库 |
| `saveCategory` | 分类名称与可选 ID | 厨师 | 新建或修改分类 |
| `saveCategoryOrder` | `categoryIds` | 厨师 | 保存自定义分类拖动顺序 |
| `deleteCategory` | `categoryId` | 厨师 | 删除分类并将菜品移入“未分类” |
| `batchSetCategory` | `categoryId`、`addDishIds`、`removeDishIds`、`versions` | 厨师 | 按明确增量批量归类，移出的菜品回到“未分类” |
| `saveDish` | 可选 `dishId`、名称、分类、库存、单价（整数分）、版本号 | 厨师 | 在未分类新增菜品或修改已有菜品；新增时名称、库存和单价必填 |
| `deleteDish` | `dishId`、版本号 | 厨师 | 删除未分类中的菜品 |
| `chefMeals` | 无 | 厨师 | 查询周一至周日的早中晚固定菜单 |
| `saveMeal` | `mealMenuId`、菜品和版本号 | 厨师 | 保存指定星期与餐别菜单，必须包含系统菜品“不要主食” |
| `syncMeals` | `sourceMealMenuId`、`sourceVersion`、`targetWeekdays`、`targetVersions` | 厨师 | 将已保存的来源菜单同步覆盖到所选星期的相同餐别 |
| `openMeals` | 具体日期 | 活跃食客 | 查询日期对应的早中晚菜单 |
| `mealDetail` | `mealMenuId`、食客需传日期 | 家庭成员 | 星期餐别菜单详情 |

## `order`

| action | 主要 payload | 权限 | 说明 |
|---|---|---|---|
| `submit` | 星期餐别菜单、日期、条目、`clientRequestId`、版本号 | 活跃食客 | 新建或修改当天该餐唯一订单并占用库存 |
| `myOrders` | 无 | 活跃食客 | 本人订单列表 |
| `detail` | `orderId` | 家庭成员 | 权限范围内订单详情 |
| `cancelMine` | `orderId`、版本号 | 活跃食客 | 取消待确认订单 |
| `chefKitchen` | 单个日期 | 厨师 | 厨房当天菜单聚合 |
| `chefSetStatus` | 订单、目标状态、版本号 | 厨师 | 逐单推进或取消 |
| `chefBatchStatus` | 菜单、日期与目标状态 | 厨师 | 批量推进当天紧邻状态 |
| `notifications` | 无 | 家庭成员 | 本人站内通知 |
| `readNotifications` | 可选通知 ID | 家庭成员 | 标记已读 |
