# 云数据库索引

上线前在微信云开发控制台为以下集合建立索引。`唯一`索引用于从数据库层阻止重复邀请码和重复幂等请求；同一天订单由确定性文档 ID 保证唯一。

| 集合 | 字段顺序 | 类型 | 用途 |
|---|---|---|---|
| `users` | `familyId`、`role`、`createdAt` | 普通 | 家庭成员列表 |
| `join_applications` | `familyId`、`status`、`createdAt`（倒序） | 普通 | 待审批申请 |
| `categories` | `familyId`、`sort` | 普通 | 分类顺序 |
| `dishes` | `familyId`、`updatedAt`（倒序） | 普通 | 厨师菜品库 |
| `dishes` | `familyId`、`categoryId` | 普通 | 删除分类时迁移关联菜品 |
| `families` | `inviteCodeHash` | 唯一 | 邀请码定位家庭 |
| `meal_menus` | `familyId`、`weekly`、`weekday` | 普通 | 查询家庭的固定星期菜单 |
| `orders` | `familyId`、`dinerId`、`mealDate` | 普通 | 查询食客当天订单；唯一性由确定性文档 ID 保证 |
| `orders` | `familyId`、`dinerId`、`clientRequestId` | 唯一 | 下单幂等控制 |
| `orders` | `familyId`、`mealDate`、`createdAt` | 普通 | 厨房餐次看板 |
| `orders` | `familyId`、`mealMenuId`、`mealDate`、`status` | 普通 | 当天订单批量推进 |
| `orders` | `familyId`、`dinerId`、`createdAt`（倒序） | 普通 | 食客历史订单 |
| `notifications` | `recipientId`、`createdAt`（倒序） | 普通 | 站内消息 |

所有集合均由云函数写入。索引建立前，部分复合查询可能在控制台提示缺失索引；按上表一次建齐后再进行真机验收。

## 从餐次菜单升级

部署本版本前，先删除旧的唯一索引 `orders(familyId, dinerId, mealMenuId)`，否则同一个星期菜单在下一周会因为旧索引而无法再次下单。随后建立普通索引 `orders(familyId, dinerId, mealDate)`。旧的 `meal_menus(familyId, date, mealType)` 索引不再使用，可以在新星期菜单完成真机验收后删除。历史菜单和历史订单不需要删除，新代码只读取带 `weekly: true` 的星期菜单；新订单使用“家庭 + 食客 + 日期”生成固定文档 ID，防止同一天产生重复订单。
