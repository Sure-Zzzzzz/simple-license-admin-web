# simple-license-admin-web

通用产品授权管理台，以乾坤子应用接入 IAM 统一应用门户。覆盖签发方、客户与组织绑定、产品与应用绑定、模型与授权方案、客户授权、人员资格、部署激活、离线凭据交付、签发任务、吊销、签名档案及角色联动。

浏览器通过 IAM 授权码与 PKCE（带一次性校验材料的授权码流程，使用 S256）获取本应用的人员访问令牌。业务请求使用 `Authorization: Bearer`，不携带 Cookie，也不接收门户人员令牌作为业务凭据。门户负责导航和主题，License Server 负责业务状态及接口、数据权限校验。

## 最小接入

1. 在 IAM 登记可信应用、公共授权客户端、权限清单及角色规则，并核对人员准入与实际授权投影。
2. 在构建环境注入登记的公共客户端编号，不将实际编号或机密写入仓库。
3. 构建 `dist/`，由本应用 Nginx 托管静态资源并代理本应用后端；统一入口负责转发到 License Nginx 与子路由刷新回门户壳。

```powershell
$env:VITE_LICENSE_PKCE_CLIENT_ID = '<PUBLIC_CLIENT_ID>'
npx.cmd pnpm@9.15.4 install --frozen-lockfile
npx.cmd pnpm@9.15.4 run check
```

`check` 执行类型检查、单元测试及生产构建。正式登记、PAGE/API/DATA 三类权限、部署路径和验收流程见 [可信应用接入手册](docs/TRUSTED_APPLICATION_ONBOARDING.md)；登记值对照与权限清单位于 `deploy/iam/`，按 IAM 官方管理 API 保存并触发投影。

## 挂载契约

| 配置 | 值 |
| --- | --- |
| 子应用名 | `license` |
| Portal entry | `/app/license/index.html`，统一入口公共路径 |
| Gateway targetOrigin | `http://license-web-nginx:80`，只指向 License 自有 Nginx |
| 路由前缀 | `/app/license` |
| 授权回调 | `https://portal.example.test/app/license/oauth-callback` |
| 业务接口 | `/api/license/v1` |
| Portal apiBase | `/api/license/v1`；请求桥也兼容同源空值 |
| 构建环境变量 | `VITE_LICENSE_PKCE_CLIENT_ID` |
| 主题契约 | `@sure-zzzzzz/simple-iam-theme-contract:1.0.5` |

示例域名需替换为部署域名。Portal props（宿主挂载参数）包含 `routePrefix`、`apiBase`、`theme`、`onUnauthorized`；应用在自己的路由基址内导航，卸载时清理监听及旧请求状态。业务路径只拼接一次，不能出现重复的 `/api/license/v1`。

## 使用约束

- PAGE 控制页面可见性，API 控制操作，DATA 控制数据范围。角色名称本身不赋予权限，以 IAM 实际投影和服务端校验为准。
- 修改既有对象携带服务端返回的 `expectedRowVersion`；409 表示冲突，应回读再操作。签发及角色联动等支持幂等重放的操作携带 `Idempotency-Key`，结果不明时沿用原键及原请求体。基础台账创建不承诺同键响应重放，结果不明时先按业务编码回读。
- 签发响应、任务及凭据列表只展示元数据；READY 后经独立 content 接口下载完整签名凭据。任务未就绪或结果不明时不得伪报交付成功。
- 普通离线签发仅适用于 OFFLINE 授权；ONLINE 使用在线判定。HYBRID 的在线判定可调用，管理台不提供混合租约签发与交付入口。签发对象从本授权有效资格或激活中选择，提交真实编号、来源及当前代数，不手填资格证明。
- 部署激活当前设备政策为 NONE，不把设备分量摘要当证明。在线及混合模式必须明确登记调用来源 `callerBinding`；改绑复用 `license.activation.manage`，同时校验所属授权的 DATA。
- 含 LOCAL 指标的部署激活在创建时登记 `requestedAllocations`（指标、数量和保留规则），服务端按已发布模型校验并生成分配编号与当前授权修订；列表回读的是持久化分配快照，不是前端推导值。
- 角色联动默认 MANUAL（人工执行及确认）：展示真实差异，服务端严格回读规则及完整部门挂载后保存 `MANUALLY_CONFIRMED`。显式 AUTO 才调用 IAM 受委托接口，最终回读符合期望后为 `VERIFIED`；人员回执不能当作 AUTO 证明。
- 联动结果不明 `UNCERTAIN` 或事实漂移 `DRIFTED` 时，先确认旧调用终止，再回读治理；IAM 清库或绑定变化后显式重新确认环境。执行及治理复用 `license.integration.manage`，不自动重发远端写请求。
- 签发恢复保留冻结输入。失联 SIGNING 接管还需服务端开启超时窗口、原执行代数和理由，未配置窗口时禁止接管；页面显示的操作入口不替代服务端检查。
- 401 触发一轮 PKCE 重授权；再次失败展示错误，避免来回跳转。403 表示无权，不能通过重新登录绕过。

## 客户 OpenAPI 限流授权

新建客户授权时，可以为客户声明一组 OpenAPI 限频策略。每条策略由服务编码、资源编码和一个或多个时间窗口组成；窗口包含允许次数、窗口长度和时间单位（秒、分钟、小时或天）。页面只提交这些业务字段，不让调用方填写 Management 命名空间、远端规则编号或内部实现字段。

提交授权后，License 保存授权中的限流策略快照及其绑定状态，并通过官方 limiter Management client 将策略投影到 Management。Management 负责策略生命周期和远端规则编号；实际承载客户 OpenAPI 的业务服务引入 limiter starter，读取 Management 快照并执行限流。License 页面本身的入口保护仍由 IAM 的 PAGE/API/DATA 权限控制，这两条链路互不替代。

限频策略是授权的一部分，授权停用、修订或回收时由服务端按绑定状态处理对应的远端策略。策略写入结果未知时，页面只显示不确定状态，不把本地提交成功当作远端生效；最终能否调用仍以目标 OpenAPI 服务当前读取到的 limiter 快照为准。

## 模型政策与授权组合

模型草稿的快照在 `fields`、`actions` 之外显式保存 `subjectPolicy`、`validityPolicy`、`connectivityPolicy`、`clockPolicy`、`devicePolicy`、`organizationPolicy`、`quotaDefinitions`、`quotaConstraints`、`revocationPolicy` 及 `requiredCapabilities`。模型节面按这些结构化段编辑，并在提交前提示对象、资格、模式、租约、设备、组织和额度的冲突；服务端 422 仍是最终裁决。

历史上只含字段与动作的旧快照可以读取和试算，页面会明确标记政策缺失。编辑保存时必须由管理员显式形成完整政策，前端不会把隐藏默认值当作已发布能力。产品未声明的能力、未登记的离线身份或未具备真实设备/离线 Provider 时，页面只展示政策约束，不承诺凭据一定可签发；实际签发仍由服务端按当前资格、代数和能力证据重新核验。

新建授权必须关联已发布模型；页面从模型政策收窄授权对象、资格种类和连接模式，并展示合法组合摘要。没有真实模型关联时禁止提交，关联方案也必须读取它引用的真实模型与权益。创建接口继续校验完整商业事实，前端候选不能代替服务端判断。

生产验收使用 Nginx 托管的 `dist/`，核对列表与详情、写后回读、翻页、无权直链、深链刷新、浏览器返回及主题切换。前端检查和构建只验证前端工程，真实 IAM、CRM、KMS 协作与机器入站需分别执行端到端验收。
