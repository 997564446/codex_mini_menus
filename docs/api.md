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
| `deleteCategory` | `categoryId` | 厨师 | 删除分类并将菜品移入“未分类” |
| `saveDish` | 菜品、规格、版本号 | 厨师 | 新建或修改菜品 |
| `setDishEnabled` | `dishId`、`enabled` | 厨师 | 上下架菜品 |
| `chefMeals` | 日期范围 | 厨师 | 查询餐次菜单 |
| `saveMeal` | 日期、餐次、菜品和版本号 | 厨师 | 新建或修改餐次 |
| `setMealStatus` | `mealMenuId`、`status` | 厨师 | 开放或关闭点餐 |
| `openMeals` | 日期范围 | 活跃食客 | 查询开放菜单 |
| `mealDetail` | `mealMenuId` | 家庭成员 | 餐次详情 |

## `order`

| action | 主要 payload | 权限 | 说明 |
|---|---|---|---|
| `submit` | 餐次、条目、`clientRequestId`、版本号 | 活跃食客 | 新建或修改唯一订单 |
| `myOrders` | 无 | 活跃食客 | 本人订单列表 |
| `detail` | `orderId` | 家庭成员 | 权限范围内订单详情 |
| `cancelMine` | `orderId`、版本号 | 活跃食客 | 取消待确认订单 |
| `chefKitchen` | 日期范围 | 厨师 | 厨房餐次聚合 |
| `chefSetStatus` | 订单、目标状态、版本号 | 厨师 | 逐单推进或取消 |
| `chefBatchStatus` | 餐次与目标状态 | 厨师 | 批量推进紧邻状态 |
| `notifications` | 无 | 家庭成员 | 本人站内通知 |
| `readNotifications` | 可选通知 ID | 家庭成员 | 标记已读 |
