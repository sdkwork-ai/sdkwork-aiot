# @sdkwork/aiot-pc-console-hardware — 智能硬件（用户控制台能力）

用户控制台的「智能硬件」分组，由 **sdkwork-aiot 拥有**：数据模型、数据库归属、管理逻辑与 PC 界面都在本仓库，Cloud Router 只做挂载。每个登录用户维护自己的终端设备，下载固件，并为每台设备关联一个智能体。

## 1. 数据库设计

设备归属关系复用 `iot_device` 已有的所有权列，不新建冗余表：

| 关系 | 存储 | 语义 |
| --- | --- | --- |
| 用户拥有设备 | `iot_device.owner_type = 'user'`, `owner_id = <iam user id>` | 用户控制台注册的终端设备 |
| 管理面预置设备 | `iot_device.owner_type = 'device'`, `owner_id = '<tenant>:<org>:<deviceId>'` | 原有自持有语义，保持不变 |

新增索引（`database/migrations/postgres/0002_user_hardware_ownership.up.sql`，含 `.down.sql`）：

```sql
CREATE INDEX IF NOT EXISTS idx_iot_device_tenant_owner
    ON iot_device (tenant_id, owner_type, owner_id);
```

- 该索引让「按用户分页列出我的设备」与租户级列表走两条互不干扰的路径；否则用户页会退化为租户全表扫描。
- 基线 DDL（`database/ddl/baseline/postgres/0001_aiot_baseline.sql`）同步新增该索引，`pnpm db:materialize:contract` 已重新生成 `database/contract/*`。
- 设备与智能体的绑定落盘在设备 `metadata` 的 `agentId` / `agentName` 两个键：绑定是"每设备一条、随设备读写"的小对象，随 `iot_device` 一次更新即完成，避免为单一关系引入新表与新仓储；`iot_device_binding`（关系表，含 `binding_type/target_type/target_id/role`）保留为 P1 目标，一旦需要"按智能体反查设备/多智能体协作"再迁移，届时只需替换仓储实现。

## 2. 逻辑设计（app 面新增操作）

四个操作全部在 **app 面**（`/app/v3/api/iot/...`），使用登录用户会话，权限由 IAM 的 `iot.*` 授予裁决：

| 能力 | 操作 | 权限 | 归属校验 |
| --- | --- | --- | --- |
| 我的设备 | `GET /app/v3/api/iot/devices` | `iot.devices.read` | 只返回 `owner = 当前用户` |
| 设备详情 | `GET /app/v3/api/iot/devices/{deviceId}` | `iot.devices.read` | 非本人设备 → 404 |
| 注册设备 | `POST /app/v3/api/iot/devices` | `iot.devices.write` | 强制 `owner_type='user'`，`Idempotency-Key` |
| 关联智能体 | `PUT /app/v3/api/iot/devices/{deviceId}` | `iot.devices.write` | 仅允许更新 `metadata`，先校验归属 |
| 产品目录 | `GET /app/v3/api/iot/products` | `iot.products.read` | 租户内产品 |
| 固件下载 | `GET /app/v3/api/iot/firmware_artifacts` | `iot.firmware.read` | 租户内固件目录 |

实现要点：

- **失败关闭**：请求没有解析出用户身份时，列表/详情/注册直接返回 `403 api.context.user.missing`，绝不回退到租户级列表（否则会泄露同租户其他用户的设备）。
- **归属前置**：`PUT` 先用 `get_device_by_owner` 校验归属，再走既有 `update_device`；`status` 等生命周期字段在该路径被忽略，`displayName`（用户改名，非空、≤120）与 `metadata`（必须是 JSON 对象）允许更新。
- **注册可信**：`POST` 校验目标产品存在且未下线（`archived/disabled/inactive/deleted/retired` 一律拒绝，返回 `404`/`409 aiot.product.registration_closed`），用户面产品目录同样在分页前过滤，避免"可选项能选、提交必失败"。
- **固件只发已发布**：用户面固件目录只返回 `published` 制品，草稿永不出现在下载列表；过滤在分页前完成，保证页密度和总数可信。
- **仓储层**：`AiotDeviceRepository` 新增 `list_devices_by_owner` / `get_device_by_owner`，内存实现与 SQLite/PostgreSQL 仓储均已实现；未实现归属模型的仓储默认失败关闭（返回 `PersistenceFailure` / `None`），不会退化为全量列表。
- **生成物**：`apis/app-api/iot/sdkwork-aiot-app-api.openapi.json` 增补上述操作与 `AiotDeviceCreateRequest`/`AiotDeviceUpdateRequest`，`pnpm sdk:generate` 已重新生成 `@sdkwork/aiot-app-sdk`（`sdk:check` 通过）；`sdks/_route-manifests/app-api/*.json` 与 `standard_api_route_contracts()` 同步为 10 条 app 操作（由 `cargo test -p sdkwork-aiot-architecture committed_route_manifests_match_http_api_contracts` 校验）。

## 3. PC 设计

`sdkwork-aiot-pc-console-hardware` 提供可组合的控制台组件：

```tsx
import { SdkworkHardwareConsole } from '@sdkwork/aiot-pc-console-hardware';

<SdkworkHardwareConsole canManage initialScreen="devices" />
```

- **界面**：我的硬件（统计、检索、设备卡片、设备详情面板 + 智能体绑定 + 设备改名、分页加载）、固件下载（校验值、目标芯片、直链下载 / 受管下发、分页加载）。
- **组合契约**：`canManage`（是否有 `iot.devices.write`，决定注册与绑定入口）、`copy`（宿主语言包）、`initialScreen`（深链）、`service`（宿主注入的端口实现）。
- **依赖倒置**：`. ` 入口不引用 AIoT PC 运行时；默认服务绑定在 `./service-default`，由界面按需 `import()`。宿主注入自己的 `ConsoleHardwareService` 时不会把 AIoT 应用运行时打进宿主包。
- **AIoT 应用内**：`apps/sdkwork-aiot-pc/src/App.tsx` 已挂载 `/hardware` 导航项，直接使用默认服务（`getAiotAppSdkClient()`）。

## 4. 宿主组合（Cloud Router 用户控制台）

`@sdkwork/cloudrouter-pc-console-hardware` 只保留：侧边栏分组与路由（记忆下方）、Cloud Router 会话客户端适配、以及把 i18n 文案映射成 `HardwareConsoleCopy` 的视图。设备领域只有一份实现。

## 5. 验证

```bash
# 数据库契约与迁移
pnpm db:validate                                   # Database framework standard passed
# app-api 契约与 SDK 生成物
pnpm sdk:check                                     # [aiot_sdk_generate] check passed for 2 SDK families
# Rust 编译（含测试目标）
cargo check -p sdkwork-iot-platform-service -p sdkwork-aiot-storage-sqlx --tests
# PC 控制台
cd apps/sdkwork-aiot-pc && pnpm typecheck && pnpm exec vitest run packages/sdkwork-aiot-pc-console-hardware
# 工作区标准
pnpm test:workspace-standard                       # 12 passed
```

> 本机 Rust 校验需要 `OPUS_LIB_DIR` 指向一个 `libopus.a`（本机 GNU 工具链下 `audiopus_sys` 构建脚本要求 MSYS2 `cp/sh`）。本次以临时目录空静态库 + `OPUS_LIB_DIR` 完成了 `cargo check`（含测试目标）验证；链接与真实设备链路的端到端验证需在具备 opus 原生工具链的环境执行。

## 6. 后续（P1）

1. 绑定迁移到 `iot_device_binding`（`binding_type='agent'`）并增加按智能体反查，支撑"一个智能体操作多台设备"。
2. 固件目录只返回已发布版本并按设备产品过滤；受管对象存储签发下载 URL。
3. 设备分组/空间与批量绑定。
