# 会员模型与上下文通用配置

日期：2026-11-04，Asia/Shanghai。状态：已准备本地网站 settings 候选；DeepSeek 配置与说明仅本地提交，未推送、构建或发布，未修改线上设置。网站配置是会员主 Agent / Worker 的来源；ChatGPT 登录继续使用原有模型、effort、Fast 和原生授权。

## 来源与当前值

唯一来源是网站 `Meteor.settings.private.homer.clientConfig`。公开 `GET /api/homer/v1/config` 和 PKCE 兑换均返回完整校验后的同一结构。顶层严格只有 `main` / `worker`，两角色独立声明以下必填字段；完整两角色示例在网站仓库 `docs/homer/2026-11-04-membership-context-config.example.json`。

```json
{
  "baseUrl": "https://models.super-tree.com/v1",
  "model": "deepseek-flash",
  "effort": "high",
  "fast": false,
  "context": {
    "contextWindow": 272000,
    "autoCompactTokenLimit": 244800,
    "autoCompactTokenLimitScope": "total"
  }
}
```

当前 main 采用上述基础字段，worker 保留 effort:max；两角色均显式声明原 DeepSeek 目录的 text/image、low/high/max、关闭网页搜索及开启工具发现元数据，完整配置以网站示例为准。示例已同步到本地网站 `.deploy/settings.json` 的 `private.homer.clientConfig`，尚未部署；不能覆盖整份 settings。

## 通用边界与能力

- `model`：1–256 个可打印 ASCII 字符，无具体模型、品牌或前缀白名单。可使用网关别名、`vendor/model:revision` 等标识。
- `effort`：1–64 个可打印 ASCII 字符，或显式 `null`。固定 Codex 0.163.0 的协议接受非空字符串，不再列举 low/high/max 等值。配置者负责选用模型实际支持的强度；`null` 清除推理强度，不能套用角色默认值。缺失字段仍拒绝。
- `fast`：固定为 false；网站和客户端均拒绝 true。会员/API 模式不支持 Fast，ChatGPT 登录模式保留原做法。
- `context`：通用必填对象，严格只有示例中的三个字段。窗口为 32768–1048576 的整数；阈值为正整数，且不超过 `floor(window * 9 / 10)`；口径固定为 total。范围是当前产品契约，不能据此推断供应商容量。
- `baseUrl`：仍须匹配受信任会员网关的 `/v1`；仅显式隔离测试允许回环 HTTP。移除模型白名单不放开网关地址、私有凭据、任意进程参数或文件路径。

角色另可声明一个完整 `capabilities` 对象，用于原生目录不能准确描述的模型；所有能力都由数据决定，不按模型名猜测：

```json
{
  "inputModalities": ["text"],
  "reasoningEfforts": ["high"],
  "webSearch": false,
  "toolSearch": false
}
```

`inputModalities` 必须含 text，另可含 image，不重复。`reasoningEfforts` 最多 32 个不重复的合法强度；非 null 的 effort 必须列在其中，effort 为 null 时此列表必须为空。webSearch / toolSearch 为布尔值，分别控制原生网页搜索及延迟工具发现，两者语义不同。能力声明不能越过 Homer 的工具、文件、审批或网络权限；受限运行环境仍可关闭相关工具。

未声明 capabilities 时，普通推理模型沿用原生目录/默认能力；新模型或别名需要自定义元数据时，在网站增加 capabilities 即可，无需发布代码。effort 为 null 且未声明能力时，使用 text、无推理强度、无网页搜索及无延迟工具发现的保守目录。生成目录使用配置内容摘要命名，保留运行快照所引用的文件，不让另一角色/后续配置覆盖当前文件；目录私有、原子写入，拒绝符号链接和硬链接。

固定引擎的 turn effort:null 会继承本机设置，因此会员 null 配置另通过线程设置接口清除推理状态，并禁止附加内置模式指令；保留 Homer 开发指令，不改本机配置文件。固定引擎在无推理模型的请求中可能保留空 `reasoning` 对象；实测不会发送 effort 或 summary。这里不承诺移除整个 reasoning 键。不兼容固定 Responses / 工具协议的模型，仍需要引擎或网关适配，不能仅凭配置字段验收。

## 采用链路与旧配置恢复

GET / 兑换 → 客户端完整校验 → 私有连接文件原子保存 → 启动或正常重启采用快照 → `effectiveModelConfig` 选择 main / worker → `CodexEngine` 设置模型、强度、Fast、窗口、阈值及可选目录。配置回读与声明不符时拒绝启动；运行中保存新配置不会热切换当前进程。

会员配置不再进入按模型名选择的 DeepSeek 专属分支。独立 BYOK 的 DeepSeek profile / 目录仍保留；上下文校验移到 `src/model-context.ts`，会员不依赖 DeepSeek 调优类型。ChatGPT 分支明确清除会员 endpoint、context 和 capabilities，保留主 Agent high / Fast、Worker xhigh / 非 Fast 的原做法。

会员网页工具继续走现有宿主 MCP。主 Agent 和 Worker 分别采用自己的生效配置：模型目录可用且该角色启用原生 `web_search=live` 时，宿主和 stdio 都不列出会员 `web_search`，并拒绝直接调用。其余网站会员角色明确关闭原生搜索，保留会员搜索。会员搜索和抓取使用同一会员网关和模型 Token，搜索最多返回五条来源，抓取返回单页 Markdown 并标记截断。超时或结果不明时不自动重试。有会员 Token 时继续提供 `web_fetch` 和付费图片、视频生成。Codex 登录沿用原生配置，无会员 Token 时不注册会员工具。原有主会话的动态工具清单无需迁移。

本地旧四字段 DeepSeek 角色，以及上一版带 `deepseek` 的五字段角色，只恢复 subject / Token 后重新拉取新配置，不将旧模型设置交给引擎；旧版本的格式校验保留用于识别历史缓存。已有合法 context 缓存继续可读。刷新 503、非法响应或写入失败均保留原文件与凭据，下次启动可恢复；主动退出状态不恢复 Token。私有连接文件读写上限统一为 32768 字节，支持完整能力列表和长 Token，超限在替换前拒绝。

旧客户端对新字段、模型或参数可能不兼容。发布顺序、维护窗口和完整回退见 [发布方案](2026-11-04-membership-context-release-plan.md)。

## 离线验证

Node 22.22.0，独立 scratch、合成凭据、本地模拟协议；未调用真实模型、支付或日常账号。

```sh
node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test --test-concurrency=1 tests/homer-account.test.ts tests/model-config.test.ts tests/desktop-deepseek-engine.test.mjs tests/deepseek-model.test.ts
node --experimental-vm-modules --test tests/electron-shell.test.mjs
node --import tsx --test --test-name-pattern='pinned generic|adopts delivered membership context' tests/deepseek-pinned.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.check.json
```

### 会员原生搜索去重候选（2026-11-08）

以 Homer `main` 的 `1f501f3` 为基线，在隔离工作树验证。Node 22.22.0 下定向回归 103/103 通过，零跳过，类型检查通过。覆盖角色能力对调、声明支持但缺少模型目录、引擎配置回读、旧主会话沿用、无会员 Token、宿主与 stdio 的列出和拒绝，以及会员抓取、图片生成、视频审批与回执恢复。缺少目录的场景在配置校验之后注入，用于验证防御性分支。回读来自合成 app-server，会员请求使用合成 Token 和本机回环网关。

```sh
node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test tests/membership-web-tools.test.ts tests/desktop-deepseek-engine.test.mjs tests/worker-interaction-mcp.test.ts tests/model-config.test.ts tests/deepseek-model.test.ts
npm run typecheck
```

合入复验使用隔离的固定 Codex 0.163.0、合成 Token 和本机回环网关。Main 开启、Worker 开启、Worker 声明支持但缺少模型目录三组均通过。每组核对原主线程恢复、原生模型请求里的搜索工具、宿主 MCP 目录，并实际执行一次会员搜索、两次抓取和两次图片生成。视频在用户批准后提交一次，图片和视频输出均核对字节。另重跑 32 项定向回归，零失败或跳过，类型检查通过。线上网关和真实模型未参与。

### 既有会员模型配置验证

网站专项：`node --test tests/homer_runtime_config.test.mjs tests/homer_entry.test.mjs tests/homer_boundary_regressions.test.mjs`。通用配置代码快照的结果：Homer 定向 152/152、桌面壳 282/282、固定引擎 4/4、网站 27/27、跨仓合同 67/67，均通过且无跳过；类型检查通过。主 Agent / Worker 的真实调度入口仍将各自角色投影交给同一引擎。原生账户和能力管理定向回归另有 19/19 通过；补充原生控制连接的会员 context / capabilities 清除与登录回归，防止会员目录影响 ChatGPT 授权。详细非敏感输出保存在 `.codex/scratch/generic-membership-20261104/`。

历史 DeepSeek / 512k 草案的 66 passing、1 pending 网站全隔离结果不代表当前通用版本已完成同一专项；本次不重跑完整网站/桌面安装验收，也没有做真实网关模型可用性、272k 容量、长上下文召回或压缩边界验收。

本次 DeepSeek 272K 配置候选另经网站 27/27、跨仓合同 67/67 检查；本地 settings 与示例一致，其他设置未变。实际角色投影与目录生成函数确认 main:high / worker:max、272000 / 244800 / total、原 DeepSeek 能力元数据，以及 ChatGPT 配置隔离。本次未启动引擎或调用模型，不能将此前固定引擎 4/4 当作本次候选的新增引擎验收。
