# License 管理台可信应用接入手册

本手册定义 License Web 在 IAM 统一应用门户中的登记、授权和业务验收契约。PKCE 是浏览器用一次性校验材料交换授权码的流程；PAGE、API、DATA 分别表示页面可见性、接口操作权限和数据访问范围。示例域名 `portal.example.test` 与占位值由部署管理员替换，实际客户端编号、密钥和令牌不写入本仓。

## 1. 系统分工

| 系统 | 负责内容 |
| --- | --- |
| IAM | 统一登录、可信应用及公共客户端登记、应用准入、权限清单、角色规则与人员授权投影 |
| License Server | 授权、资格、激活、签发、吊销、期限及联动事实；执行 API 与 DATA 校验 |
| License Web | 自行完成本应用 PKCE，以人员 Bearer 访问 License；使用门户导航与主题 |
| KMS | 保管私钥、提供指定钥版本的公钥及签名服务 |
| CRM | 提供订单与履约事实；License 通过官方机器客户端拉取及回报 |

License 不读取其他系统数据库，不在浏览器放机器凭据，也不把人员令牌转发给 KMS、CRM 或 IAM 开放接口。

## 2. 登记值

| 字段 | 值或要求 |
| --- | --- |
| 应用编码 | `license` |
| 应用名称 | `产品授权管理台` |
| Portal entry | `/app/license/index.html`，统一入口公共路径 |
| Gateway targetOrigin | `http://license-web-nginx:80`，页面与 API 共用的 License 自有 Nginx |
| 路由前缀 | `/app/license` |
| apiBase | `/api/license/v1`；请求桥保证前缀只拼接一次 |
| 默认入口 | `pageMenuCode=license-issuers`、`entryPath=/issuers` |
| 公共客户端 | `<PUBLIC_CLIENT_ID>`，构建时注入 `VITE_LICENSE_PKCE_CLIENT_ID` |
| 客户端类型 | `PUBLIC`、`authenticationMethods=["none"]`，不配 Secret |
| 授权与回调 | `authorization_code`、`scopes=["openid","profile"]`、`https://portal.example.test/app/license/oauth-callback` |

`deploy/iam/portal-registration.example.json` 仅是字段对照，不是 IAM 创建请求体。浏览器授权入口 `/oauth2/authorize` 与令牌交换 `/oauth2/token` 走同源身份网关，使用 S256。

## 3. 页面与菜单

Portal 菜单使用 GROUP（目录）及 PAGE（页面）节点。组织绑定与应用绑定复用所属列表权限，模型、人员资格和激活使用自己的 PAGE。

| 页面 | 相对路由 | PAGE 权限码 |
| --- | --- | --- |
| 签发方 | `/issuers` | `license.page.issuers` |
| 客户及组织绑定 | `/customers`、`/customers/:customerId/organization-binding` | `license.page.customers` |
| 产品与应用绑定 | `/products`、`/products/:productId/application-bindings` | `license.page.products` |
| 产品模型 | `/products/:productId/models` | `license.page.models` |
| 授权方案 | `/plans` | `license.page.plans` |
| 客户授权 | `/grants` | `license.page.grants` |
| 人员资格 | `/grants/:grantId/subject-assignments` | `license.page.subject-assignments` |
| 部署激活 | `/grants/:grantId/activations` | `license.page.activations` |
| 凭据交付 | `/credentials` | `license.page.credentials` |
| 签发任务 | `/operations` | `license.page.operations` |
| 吊销管理 | `/revocations` | `license.page.revocations` |
| 签名档案 | `/signing-profiles` | `license.page.signing-profiles` |
| 角色联动 | `/integration-commands` | `license.page.integrations` |

详情页从所属列表进入，不将带动态编号的路径登记为固定菜单。`/oauth-callback` 是授权协议回调，不是业务 PAGE。根路径及 `index.html` 读取当前人员权限后进入首个获准的业务列表；没有页面权限进入无权页。菜单保存时提交完整 `menuTree`；GROUP 不填业务路由，空数组会清空现有菜单。隐藏菜单不能代替服务端拒绝。

PAGE 节点的官方结构如下；GROUP 使用相同基础字段并省略路由，把下级节点放入 `children`：

```json
{
  "code": "license-issuers",
  "name": "签发方",
  "nodeType": "PAGE",
  "route": "/issuers",
  "requiredPagePermission": "license.page.issuers",
  "sortOrder": 10,
  "children": []
}
```

## 4. API 权限

清单声明应用支持能力，实际授予以角色规则和人员投影为准：

| 业务域 | 精确权限码 |
| --- | --- |
| 当前身份 | `license.me.read` |
| 签发方 | `license.issuer.read`、`license.issuer.manage` |
| 客户 | `license.customer.read`、`license.customer.manage` |
| 产品 | `license.product.read`、`license.product.manage` |
| 模型 | `license.model.read`、`license.model.manage`、`license.model.publish` |
| 方案 | `license.plan.read`、`license.plan.manage` |
| 授权与凭据 | `license.grant.read`、`license.grant.manage`、`license.grant.issue`、`license.grant.deliver` |
| 人员资格 | `license.subject-assignment.read`、`license.subject-assignment.manage`、`license.subject-assignment.force-replace` |
| 部署激活 | `license.activation.read`、`license.activation.manage`、`license.activation.force-replace` |
| 吊销 | `license.revocation.read`、`license.revocation.manage`、`license.revocation.deliver` |
| 签名档案 | `license.signing-profile.read`、`license.signing-profile.manage` |
| 签发任务 | `license.operation.read`、`license.operation.recover` |
| 角色联动 | `license.integration.read`、`license.integration.manage` |
| 在线额度 | `license.quota.read`、`license.quota.use`、`license.quota.manage` |

机器在线判定另用 `license.decision.evaluate` 与 `license-grant/use` DATA，不授 PAGE。机器码同样需清单申报，人员角色无需因此获得机器能力；机器主体及授权遵循 AKSK 官方契约。

候选发现复用 `license.decision.evaluate`；在线额度元数据查询使用 `license.quota.read` 与 `license-grant/read` DATA，预占、释放及续期使用 `license.quota.use` 与 `license-grant/use` DATA，并核验真实主体与额度归属。`license.quota.manage` 仍是治理写能力声明，当前没有对应页面或状态写入；不得登记不存在的 quota PAGE 或菜单。

Runtime 的 AKSK 入站由 `LICENSE_AKSK_RESOURCE_ENABLED` 控制，默认 `false`。在线判定验收前须注入获准令牌内省的 `LICENSE_AKSK_INTROSPECT_URL`、`LICENSE_AKSK_INTROSPECT_CLIENT_ID/SECRET` 并显式开启；内省是服务端核验机器令牌的官方接口。入站内省凭据与出站机器凭据分别配置，缺少凭据不能记为已验证。

人员角色需要 `license.me.read` 才能读取 `/api/license/v1/me` 的 PAGE/API 快照。Web 据此控制业务路由和操作按钮，不从角色名、管理员名称或菜单推导权限；缺失或非法快照显示可重试错误，不按全量放行。

## 5. DATA 资源

以下维度来自服务端 `LicenseAccessScope` 实际校验。受限范围只接受一个 `IN` 约束，未知维度或无法完整翻译时拒绝：

| 资源 | 动作 | 维度 |
| --- | --- | --- |
| `license-issuer` | `read/manage` | `issuerId` |
| `license-customer` | `read/manage` | `customerId` |
| `license-product` | `read/manage/publish` | `productId` |
| `license-grant` | `read/manage/issue/deliver/use` | `grantId` |
| `license-signing-profile` | `read/manage` | `profileId` |
| `license-integration` | `read/manage` | `customerId` |

操作号、凭据号、激活号和联动命令号不能替代所属授权或客户维度。`all=true` 必须使用空 `constraints`；创建和治理入口通常要求对应资源 `manage/all`，有限编号不能表达尚未创建的主键。吊销创建要求 `license-grant/manage/all`。

DATA 文档示例只授指定授权和客户，其他资源须按实际工作流分别授予：

```json
{
  "protocol": "simple-data-permission",
  "version": "1.0",
  "grants": [
    {
      "resource": "license-grant",
      "actions": ["read", "manage", "issue", "deliver"],
      "all": false,
      "constraints": [{"dimension": "grantId", "operator": "IN", "values": ["grant-example"]}]
    },
    {
      "resource": "license-integration",
      "actions": ["read"],
      "all": false,
      "constraints": [{"dimension": "customerId", "operator": "IN", "values": ["customer-example"]}]
    }
  ]
}
```

模型、方案和应用绑定属于产品 DATA；资格、激活、凭据及签发任务属于授权 DATA。给授权全量不自动获得关联客户、产品、签名档案权限。新建签发方、客户、产品、模型、方案、授权、签名档案、联动计划与 CRM 同步要求各自资源 `manage/all`。

调用来源登记、任务治理和联动治理复用已有权限码，端点均在 `/api/license/v1` 下：

| 动作与端点 | API 权限 | DATA |
| --- | --- | --- |
| `PATCH /activations/{activationId}/caller-binding` | `license.activation.manage` | 所属 `license-grant/manage` 的 `grantId` |
| `POST /operations/{operationId}/recoveries` 或 `/abandonments` | `license.operation.recover` | 所属 `license-grant/manage` 的 `grantId` |
| `POST /products/{productId}/role-projection-plans` | `license.integration.manage` | `license-integration/manage/all` |
| `POST /role-projection-plans/{planId}/confirmations` | `license.integration.manage` | `license-integration/manage` 的 `customerId` |
| `POST /integration-commands/{commandId}/attempts` | `license.integration.manage` | `license-integration/manage/all` |
| `POST /integration-commands/{commandId}/reconciliations` | `license.integration.manage` | `license-integration/manage/all` |
| `POST /products/{productId}/role-projection-reconfirmations` | `license.integration.manage` | `license-integration/manage/all` |

这些入口不申报额外的 caller-binding、reconcile 或 reconfirm 权限码。联动读取仍使用 `license.integration.read`，并按客户 DATA 筛选。

## 6. IAM 官方保存顺序

写请求先 `GET /iam/web/auth/csrf`，携带响应的 `headerName` 与 `token`，并使用 IAM 管理会话 Cookie。不要用 License 人员 Bearer 或 SQL 直插投影表。

1. 按 `applicationCode` 查重后 `POST /iam/admin/trusted-applications` 创建应用；创建请求的 `portal` 使用完整菜单树，`initialClient` 使用公共 PKCE 配置。
2. `PUT /iam/admin/trusted-applications/{applicationId}/permission-manifest` 提交完整 `roles`、`pagePermissions`、`apiPermissions`、`dataResources`。
3. 回读 `configVersion` 后，`PUT /iam/admin/trusted-applications/{applicationId}/portal/configuration` 提交完整 `enabled`、`entry`、`apiBase`、`menuTree`、`defaultEntry`；请求字段是 `entryPath`，空菜单会清空菜单。
4. `POST /iam/admin/trusted-applications/{applicationId}/resource-verification-clients` 创建服务端验证客户端，返回 Secret 仅注入运行环境。
5. 按角色编码查重后 `POST /iam/admin/roles` 创建角色，保存实际 `roleId`；清单声明不自动创建角色。
6. 按用户对外 `subjectId`（不是数字主键）回读 `GET /iam/admin/users/{subjectId}/application-authorizations/{applicationId}`。仅首次无记录时用同路径 `PUT` 建立 `admitted=true` 的空权限记录；已有记录必须保留回读的完整 `roles`、`pagePermissions`、`apiPermissions`、`dataGrantDocument`。
7. 先回读规则，再 `PUT /iam/admin/roles/{roleId}/authorization-rules/{applicationId}` 完整保存 `pagePermissions`、`apiPermissions`、`dataGrantTemplate`；保存规则会触发已关联人员的投影重算。优先使用部门、组织或用户组等稳定关系配置准入。
8. 尚未关联的人员使用 `POST /iam/admin/users/{subjectId}/roles/{roleId}`；重复关联已有角色不会再次重算，修复旧投影应保存官方角色规则。最后回读人员授权核对准入、角色和三权，不能再用空权限 PUT 覆盖刚生成的投影。

权限清单、Portal 和角色规则都是完整快照，保存前回读，保存后核对。清单请求的 `roles` 可取自对照文件的 `designRoles`，`_comment` 等说明字段不提交；DATA 申报使用 `resource/actions/dimensions`。Portal 默认入口响应的 `path` 对应请求的 `entryPath`，更新携带当前 `configVersion`，冲突先回读。IAM 数据重建后重新走官方登记流程，不依赖旧编号或 SQL 直插。

## 7. 角色与验收

建议角色为 `license-admin`（业务全量）、`license-designer`（产品规则）、`license-operator`（授权交付）和 `license-auditor`（只读）。角色名称不产生继承；实际规则以 IAM 保存结果为准。

只读角色不授 manage、publish、issue、deliver、recover 或强制替换；设计角色不自动获得交付和治理权限。页面依赖的关联对象也要授只读能力，例如创建授权需要客户、产品及模型查询；不能只给主页面就声称流程可操作。

License 自己的 Nginx 托管 `dist/` 并把 `/api/license/v1/**` 原样代理到自己的后端；统一入口经 Envoy 将 License 静态与 API 转发至同一个 `targetOrigin`，深链刷新回门户壳。业务 API 错误不能兜底为 HTML。后端保护路径包含 `/api/license/**`，IAM 验证客户端绑定本应用。Java Server 端口只在业务网络监听，不能登记为 Gateway 目标。

验收顺序：门户 PKCE 登录→签发方→客户绑定→产品与应用→模型/方案发布→授权→资格/激活→签发→任务 READY→凭据交付；每步回读。分别验证全量、受限、只读和无准入身份，覆盖直链、403、分页、主题与深链刷新。CRM 使用机器 cursor（继续位置）及显式客户/产品映射；KMS 核对精确钥版本和公钥快照。签发响应、任务和列表不包含 compact JWS（完整签名文件）；READY 后另走 content 交付接口并校验 deliver 权限。未执行的场景不能记为通过。

## 8. 角色联动操作与异常治理

产品应用绑定必须保存已批准的 PAGE/API/DATA 规则快照。License 从真实 IAM 权限清单、组织目录、已启用商业授权与远端角色读取事实，不把产品动作名称猜作权限码，也不读取 IAM 数据库。

1. 生成计划，检查目标应用、客户组织根、环境编号、绑定代数、权限清单摘要、期望修订及部门差异。
2. 默认 MANUAL：人员在 IAM 完成计划要求的变更，提交期望修订、环境、绑定代数及实际角色编号；服务端严格回读规则和完整部门挂载，符合期望后记为 `MANUALLY_CONFIRMED`。刷新请求不带模式或显式 MANUAL 只产生新清单。
3. 选择 AUTO 时，明确提交 `executionMode=AUTO` 及幂等键才执行受委托写入。每次写入携带远端修订并回读，最终再次核对业务、环境、清单和目录，符合期望后记为 `VERIFIED`。
4. `UNCERTAIN` 表示结果不明，`DRIFTED` 表示事实已漂移。不得自动重发写请求；治理者先确认旧调用终止，再携带期望修订、环境、绑定代数及实际角色编号请求回读收口。人工治理结果仍是人工确认，不冒充 AUTO 验证。
5. IAM 清库、恢复或客户组织重绑后，核对当前环境与绑定并显式重新确认，生成新计划，不自动续用旧远端角色编号。

MANUAL、AUTO、异常治理、过期/旧修订拒绝及环境重确认分别验收。缺少官方受委托能力时明确失败，不提供成功替身；具备代码和页面不能代替真实操作证据。

## 9. 激活、任务恢复与数据库前置

部署设备政策当前仅支持 NONE，创建或替换不携带设备分量摘要。在线及混合模式的激活必须登记 `callerBinding`（获准服务的来源编号及主体编号）；未绑定或调用主体不符时拒绝在线判定。含 LOCAL 指标时，创建激活同时提交 `requestedAllocations`，服务端生成 `allocationId`、固化当前 `grantRevision` 与固定窗口锚并在列表回读；前端不提交这些服务端事实。存量未绑定行由授权管理员经 caller-binding 管理接口明确补齐，不能按客户或当前登录人猜测。改绑携带最新 `expectedRowVersion`，提交后回读。

任务恢复保留原冻结签名输入。接管失联 SIGNING 还需原执行代数及接管理由，并满足宿主的 `LICENSE_STALE_SIGNING_AFTER_SECONDS` 超时窗口；未配置窗口时禁止接管，窗口必须大于完整 KMS 与认证调用耗时上限。行版本冲突先回读，READY 不能放弃，不用重新签发掩盖未知任务。

普通离线凭据入口只面向 OFFLINE；ONLINE 走在线判定。HYBRID 的在线判定可调用，管理台不提供混合租约签发与交付。签发必须从当前授权有效资格或激活中精确选择：固定人员/服务提交真实来源、主体、`assignmentId` 和 `assignmentGeneration`；部署提交 `activationId` 和 `activationGeneration`。所需候选读取权限及 DATA 也须授予，代数不缺省为 1，不让人员手填证明。

后端使用 22 张 License 自有事实表。新空库使用匹配制品的 `01_schema.sql`，其中 DROP 只能用于明确可丢弃的库。已有库先停本域写入并备份，核对 02 激活归属、03 商业期限、04 履约关联，再执行额度分配增量迁移并逐激活补录，不能从权益限额猜造分配：

| 迁移材料 | 核验内容 |
| --- | --- |
| `05_add_signing_idempotency_unique.sql` | 幂等摘要列定义、NULL、重复组及等价完整唯一索引 |
| `06_add_role_projection.sql` | 联动计划快照/模式/原因/状态列和两张台账；旧 NULL 快照重新生成 |
| `07_add_activation_caller_binding.sql` | 调用来源两列；旧 NULL 绑定须明确登记，不自动猜测 |
| `08_add_signing_tracking_and_legacy_uniques.sql` | MySQL 8；KMS 调用追踪列、凭据号与吊销目标唯一键，以及 NULL、重复组和等价索引 |

05–08 先逐条只读预检，再人工复制实际缺失且已核对的单条 DDL（改变表结构的语句），执行一条回读一条。同名冲突索引、异常定义或重复事实须停止核对；不整文件自动执行，不通过删除历史修唯一约束，不改已交付文件或冻结签名材料。自动改表不代表历史业务事实已正确迁移。
