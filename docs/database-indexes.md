# 云数据库索引

上线前在微信云开发控制台为以下集合建立索引。`唯一`索引用于从数据库层阻止重复家庭订单和重复幂等请求。

| 集合 | 字段顺序 | 类型 | 用途 |
|---|---|---|---|
| `users` | `familyId`、`role`、`createdAt` | 普通 | 家庭成员列表 |
| `join_applications` | `familyId`、`status`、`createdAt`（倒序） | 普通 | 待审批申请 |
| `categories` | `familyId`、`sort` | 普通 | 分类顺序 |
| `dishes` | `familyId`、`updatedAt`（倒序） | 普通 | 厨师菜品库 |
| `dishes` | `familyId`、`categoryId` | 普通 | 删除分类时迁移关联菜品 |
| `families` | `inviteCodeHash` | 唯一 | 邀请码定位家庭 |
| `meal_menus` | `familyId`、`date`、`mealType` | 唯一 | 一个家庭同一餐次只有一份菜单 |
| `meal_menus` | `familyId`、`status`、`date` | 普通 | 食客开放菜单 |
| `orders` | `familyId`、`dinerId`、`mealMenuId` | 唯一 | 每名食客每餐只有一单 |
| `orders` | `familyId`、`dinerId`、`clientRequestId` | 唯一 | 下单幂等控制 |
| `orders` | `familyId`、`mealDate`、`createdAt` | 普通 | 厨房餐次看板 |
| `orders` | `familyId`、`dinerId`、`createdAt`（倒序） | 普通 | 食客历史订单 |
| `notifications` | `recipientId`、`createdAt`（倒序） | 普通 | 站内消息 |

所有集合均由云函数写入。索引建立前，部分复合查询可能在控制台提示缺失索引；按上表一次建齐后再进行真机验收。
