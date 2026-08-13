# AGENTS.md

本文件适用于仓库根目录及全部子目录，供在本项目中工作的 Codex 或其他自动化开发代理使用。

## 项目目标

“今儿吃啥捏”是一个原生微信小程序。单个家庭中，一名厨师负责维护菜品库存、星期菜单、审批成员和处理订单，多名食客按具体日期对应的星期菜单点餐。当前界面只面向一个家庭，但数据模型必须始终保留多家庭隔离能力。

修改前先阅读与任务直接相关的代码和文档；只改完成任务所必需的文件，不顺手重构、不增加未要求的功能、不覆盖用户已有修改。

## 目录与职责

- `miniprogram/`：原生微信小程序客户端，不使用前端框架。
  - `pages/`：页面逻辑、结构、页面配置和样式；每个页面由同名的 `.js`、`.json`、`.wxml`、`.wxss` 四个文件组成。
  - `utils/api.js`：云函数调用和统一错误展示入口。
  - `utils/session.js`：会话检查、业务页准入和自定义导航同步。
  - `utils/format.js`：日期、星期和订单状态等展示格式。
  - `config/env.js`：微信云环境与订阅消息模板配置。
  - `custom-tab-bar/`：按厨师/食客角色变化的底部导航。
- `cloudfunctions/identity/`：会话、厨师认领、个人资料和订阅授权。
- `cloudfunctions/family/`：邀请码、入群申请、审批和成员状态。
- `cloudfunctions/menu/`：分类、菜品、规格和餐次菜单。
- `cloudfunctions/order/`：下单、订单快照、状态流转、厨房聚合和通知。
- `cloudfunctions/*/domain.js`：不依赖微信运行环境的业务规则，优先在这里承载可单元测试的纯逻辑。
- `tests/`：Node.js 内置测试运行器执行的业务规则与接口契约测试。
- `docs/`：接口、数据库安全、索引、隐私/订阅消息和真机验收资料。
- `scripts/check-project.js`：页面配套文件、云函数文件、JSON、JavaScript 语法和 WXML 标签检查。

## 开发环境与常用命令

仓库根目录要求 Node.js 18 或更高版本，本地检查不需要安装第三方根依赖。

```bash
npm test
npm run check
```

- `npm test`：运行 `tests/*.test.js`。
- `npm run check`：检查项目结构、JSON、JavaScript 语法与 WXML 标签。
- 项目没有配置 lint、格式化或本地完整构建命令，不要声称已运行这些检查。
- 微信端编译、云函数上传和真机流程必须使用微信开发者工具；云函数运行时要求 Node.js 16 或更高版本。
- 只有修改初始化口令配置时，才使用 `node scripts/hash-passphrase.js "口令"`；不要把明文口令写入仓库、日志或文档。

## 代码风格

- 使用现有 CommonJS 风格：`require()`、`module.exports`，不要自行改成 ESM。
- JavaScript 保持现有风格：两空格缩进、单引号、通常不写分号、优先使用 `const`，仅在需要重新赋值时使用 `let`。
- 沿用微信原生的 `App()`、`Page()`、WXML 和 WXSS 写法，不引入框架或第三方依赖，除非任务明确要求。
- 面向用户的文案、错误提示和代码注释使用自然、明确的中文。
- 新增或修改对外接口、云函数 action、公共工具函数时，补充中文注释，说明参数、权限/用途和返回值；公共 JavaScript 函数优先沿用现有 JSDoc 格式。
- 保持命名与现有领域一致：`chef`、`diner`、`familyId`、`mealMenuId`、`mealDate`、`clientRequestId`、`version` 等，不创建含义重复的别名。
- 金额在业务数据中一律使用整数分 `priceCents`/`totalCents`；仅在客户端展示层格式化为元。

## 客户端约束

- 所有服务端请求都通过 `miniprogram/utils/api.js` 调用，传输格式固定为 `{ action, payload }`。页面不要直接重复封装 `wx.cloud.callFunction`。
- 客户端不得直接读写云数据库，也不得把客户端传入的 `openid`、角色或 `familyId` 当作可信身份。
- 业务页面进入时沿用 `requireActiveSession()`；需要自定义底部导航的 tab 页面应调用 `syncTabBar()`。
- 异步操作必须处理 loading、成功反馈和失败反馈；失败优先交给 `api.showError()`，并保留服务端 `requestId` 便于排障。
- 修改页面时同时检查 `.js`、`.wxml`、`.wxss`、`.json` 是否需要联动；新增页面还要更新 `miniprogram/app.json`。
- 调用相册、相机等隐私接口前使用 `miniprogram/utils/privacy.js` 中的授权流程。
- 保留 `touristappid` 对应的只读预览逻辑，不让预览模式误连云函数。

## 云函数与数据安全

- 所有云函数身份必须来自 `cloud.getWXContext()`；禁止接受客户端提供的 `openid` 作为身份依据。
- 每次读取或修改家庭业务数据都必须校验当前用户状态、角色和 `familyId`。查询、更新及事务条件中不能省略必要的家庭隔离字段。
- 客户端无数据库权限；不要为实现便利放宽 `docs/database-security.md` 规定的集合权限。
- 云函数响应保持统一：

  ```js
  { ok: true, data, error: null, requestId }
  { ok: false, data: null, error: { code, message }, requestId }
  ```

- 可预期业务错误应使用稳定错误码，如 `UNAUTHORIZED`、`FORBIDDEN`、`NOT_FOUND`、`INVALID_INPUT`、`CONFLICT`、`MENU_CLOSED`、`ORDER_LOCKED`；不要把内部异常、凭据或数据库细节暴露给客户端。
- 涉及“先检查再写入”、唯一性、版本号或多文档一致性的操作，继续使用数据库事务和条件更新，不能只依赖客户端校验。
- 使用 `db.serverDate()` 写服务端时间。自由文本先去空格并限制长度；ID、枚举、数量、日期和规格在服务端再次校验。
- 云函数使用 `cloud.DYNAMIC_CURRENT_ENV`。不要硬编码新的环境 ID、AppID、口令、模板 ID 或其他凭据。
- 修改云函数依赖时，只更新对应 `cloudfunctions/<name>/package.json`，并说明需要重新“上传并部署：云端安装依赖”；不要在根目录添加无关依赖。

## 不可破坏的业务规则

- 一个家庭只能有一名厨师，厨师认领必须保持事务与防并发保护。
- 所有核心数据保留 `familyId`，不同家庭之间不能互相读取或修改数据。
- 每名食客每天只能有一张订单；订单使用“家庭 + 食客 + 日期”的确定性文档 ID 保证唯一，`clientRequestId` 继续用于下单幂等。
- 菜单和订单更新使用 `version` 做并发控制；遇到旧版本应返回冲突，而不是静默覆盖。
- 订单只允许按 `pending → confirmed → cooking → ready → completed` 向前流转；取消范围以 `cloudfunctions/order/domain.js` 中的状态机为准。
- 订单保存菜品名称、价格、规格等快照，后续菜品修改不能改变历史订单。
- 必选/可选、单选/多选规格必须由服务端按当前菜品定义验证。
- 订阅消息发送失败不能回滚或阻断已经成功提交的订单；站内通知仍是基础通知渠道。
- 参考价格只用于展示和汇总，本项目不包含微信支付、退款或结算。

## 接口与文档联动

新增或修改云函数 action 时，至少同步检查以下位置：

1. 对应 `cloudfunctions/<name>/index.js` 的路由、权限校验、参数校验与统一响应。
2. 客户端 `api.call()` 的调用名称、payload 和返回值处理。
3. `docs/api.md` 中的 action、主要参数、权限与说明。
4. `tests/interface-contract.test.js` 是否需要扩充契约检查。

修改集合、查询条件或唯一性规则时，同步检查 `docs/database-security.md` 和 `docs/database-indexes.md`。修改订阅消息、隐私接口或平台权限时，同步检查相应云函数的 `config.json` 与 `docs/privacy-and-message.md`。

## 测试与完成标准

根据改动范围做最小但充分的验证：

- 修改纯业务规则：在 `tests/domain.test.js` 增加成功、非法输入和边界测试，并运行 `npm test`。
- 修改客户端/云函数接口：运行 `npm test`，并确认接口文档和契约测试已同步。
- 修改页面、配置或项目结构：运行 `npm run check`。
- 修改订单、权限、家庭隔离、事务、索引、隐私或订阅消息：除自动检查外，按 `docs/acceptance-checklist.md` 列出需要在微信开发者工具或真机复验的场景。
- 通常在交付前同时运行 `npm test` 和 `npm run check`。若受微信平台、云环境或账号限制无法验证，必须明确说明未验证项与原因。

任务完成时应满足：改动只覆盖明确需求；相关文档和测试已同步；没有泄露或硬编码新的敏感配置；自动检查通过；需要部署或真机验证的剩余步骤已清楚列出。
