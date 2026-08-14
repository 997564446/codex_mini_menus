# 云数据库索引

上线前在微信云开发控制台为以下集合建立索引。`唯一`索引用于从数据库层阻止重复邀请码和重复幂等请求；同一天同一餐的订单由确定性文档 ID 保证唯一。

| 集合 | 字段顺序 | 类型 | 用途 |
|---|---|---|---|
| `users` | `familyId`、`role`、`createdAt` | 普通 | 家庭成员列表 |
| `join_applications` | `familyId`、`status`、`createdAt`（倒序） | 普通 | 待审批申请 |
| `categories` | `familyId`、`sort` | 普通 | 分类顺序 |
| `dishes` | `familyId`、`updatedAt`（倒序） | 普通 | 厨师菜品库 |
| `dishes` | `familyId`、`categoryId` | 普通 | 删除分类时迁移关联菜品 |
| `families` | `inviteCodeHash` | 唯一 | 邀请码定位家庭 |
| `meal_menus` | `familyId`、`weekly`、`weekday`、`mealType` | 普通 | 查询家庭的固定星期三餐菜单 |
| `orders` | `familyId`、`dinerId`、`mealDate`、`mealType` | 普通 | 查询食客当天该餐订单；唯一性由确定性文档 ID 保证 |
| `orders` | `familyId`、`dinerId`、`clientRequestId` | 唯一 | 下单幂等控制 |
| `orders` | `familyId`、`mealDate`、`createdAt` | 普通 | 厨房餐次看板 |
| `orders` | `familyId`、`mealMenuId`、`mealDate`、`status` | 普通 | 当天订单批量推进 |
| `orders` | `familyId`、`dinerId`、`createdAt`（倒序） | 普通 | 食客历史订单 |
| `orders` | `reminderPending`、`reminderDueAt` | 普通 | 扫描提前订单的到点提醒 |
| `notifications` | `recipientId`、`createdAt`（倒序） | 普通 | 站内消息 |

所有集合均由云函数写入。索引建立前，部分复合查询可能在控制台提示缺失索引；按上表一次建齐后再进行真机验收。

## 升级与索引迁移

部署本版本前，必须先删除以下两个旧的唯一索引：

1. `orders(familyId, dinerId, mealMenuId)`：否则同一个星期菜单在下一周会因为旧索引而无法再次下单。
2. `meal_menus(familyId, date, mealType)`（控制台索引名通常为 `familyDateMealUnique`）：新的星期菜单没有 `date` 字段，同一餐别会有 7 份菜单；保留该唯一索引会把它们判定为重复，导致初始化时报 `E11000 duplicate key`。

如果 `orders(familyId, dinerId, mealDate)` 曾被手动设置成唯一索引，也必须删除；三餐模式允许同一食客同一天分别创建三张订单。

建立普通索引 `orders(familyId, dinerId, mealDate, mealType)`、`meal_menus(familyId, weekly, weekday, mealType)` 和 `orders(reminderPending, reminderDueAt)` 后，再部署 `menu`、`order` 云函数并上传小程序前端。首次读取菜单时，新代码会停用并清空旧的 7 份单日菜单，再初始化 21 份早中晚菜单；历史订单仍保留，新订单使用“家庭 + 食客 + 日期 + 餐别”生成固定文档 ID。
