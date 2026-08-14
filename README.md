# 鲨鱼妹妹运营管理后台

基于 Vue 3、Vite、TypeScript、Element Plus、Pinia、Vue Router、ECharts 和 ExcelJS 的纯前端静态后台。数据通过版本化 `localStorage` 持久化，接口形状兼容若依，后续可直接将 service 层替换为真实 API。

## 启动与构建

```bash
pnpm install
pnpm sync:assets
pnpm dev
pnpm build
```

开发地址：`http://127.0.0.1:4174/#/login`。构建产物位于 `dist/`，可部署到任意静态文件服务，也可直接验证：

```bash
pnpm preview
```

## 演示账号

| 角色 | 账号 | 密码 | 数据范围 |
| --- | --- | --- | --- |
| 平台管理员 | `admin@shark.cn` | `Admin123!` | 全部数据，可切换国内/海外 |
| 一级经销商 | `tier1@dealer.cn` | `Dealer123!` | 自身及二级经销商 |
| 二级经销商 | `tier2@dealer.cn` | `Dealer123!` | 自身数据，首次登录需改密 |

登录页验证码默认已填入；点击验证码可刷新。连续输错密码 5 次会在本地锁定账号 30 分钟。

## 数据与接口

- 数据库：`shark-sister-admin.db.v7`（首次启动自动迁移 v1-v6 数据，不清空已有 CRUD 记录）
- 会话：`shark-sister-admin.session.v1`
- 偏好：`shark-sister-admin.prefs.v1`
- 列表接口：`{ code, msg, rows, total }`
- 单体接口：`{ code, msg, data }`
- 查询参数：`pageNum`、`pageSize`、`orderByColumn`、`isAsc` 和业务筛选字段

页面只调用 `src/services/`。管理员和经销商账号来自本地数据库，角色页面保存的权限会直接影响登录会话、菜单、路由和按钮。新增、编辑、审批、分配、出入库、调货、启停、解绑、换 SN、发布、数据范围过滤、通知和日志均会真实更新本地数据；设备远程控制、支付、真实物流查询、消息推送、CDN 和服务器部署只执行可追踪的确定性静态模拟或标记为非前端范围，不宣称已经连接真实外部系统。

Banner 使用受控 `targetKey` 和适用用户下拉，不保存任意 URL。当前交付只修改后台，APP 读取这组配置属于后续集成范围。

## 验证

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

运行 `node scripts/capture-screens.mjs` 可根据 `screen-manifest.ts` 重新生成 152 个页面、Tab、抽屉和弹窗状态。需求覆盖矩阵位于 `docs/requirements-coverage.md`。
