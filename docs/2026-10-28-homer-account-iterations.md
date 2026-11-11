# Homer 账号接入：小步实施计划

> 历史实施记录，旧独立用户／钱包／grant／五操作方案已退役。当前范围与验证以 [原生 Token MVP](2026-10-29-homer-native-token-mvp.md) 和 v1-r5 合同为准；下文不再作为实施计划。

2026-10-28，Asia/Shanghai。初始base：`0120d92084f6cdc90c4f05f19e92aa0e8c1233bb`；提交前的main合并基线：`545d95d1311578a766f78d776a587a5370c5a425`。本任务不包含主树未提交改动、Terra、164或启动修复。

## 目标与边界

后续用户调整：先复用 BYOK 跑通 `https://models.super-tree.com/v1` 的 `deepseek-flash`，主 Agent／Worker 均为 `max`、Fast 关闭，继续使用当前 `0.163.0`。已交付 [隔离终端入口](2026-10-28-deepseek-isolated.md)，用户已完成一次主／Worker真实试跑；账号授权后续接入。以下授权迭代顺序暂缓，既有1A增量保留。最新授权包括代码审查、本地提交与合并main，不包括安装、部署或日常服务切换，也不改变平台合同alias。

用户最初要求从本地合成工程开始，后调整为先做BYOK实测，再审查提交合并。本轮审查不增加真实账号／支付／短信／模型调用，不安装、重启日常服务、部署或迁移真实数据。账号新增模块尚未接入service／UI，不把纯模块与BYOK试跑称为完整授权功能。

唯一合同为 `v1-r2`，SHA-256 `a5e125fbbd54ad9e6af15a66cef54af2eb92f6c853504f54a166565eb3e23c5b`。实施方案 SHA-256 `c5601c548db6eedfd8e8a505ee191f78a548aa1227af84d411655a4c7f0f6a95`。准确三件套位于 `/Users/wolf3c/Project/homer/.cindy-worktrees/curious-cohen/docs/`，本候选不修改原件。

源码默认保持主 Sol/medium/Fast、Worker Sol/high/Fast。平台模式的两个 alias 固定为 homer-main/homer-worker。固定 Codex 0.163.0；不启异步压缩，原250000压缩阈值不变。使用已安装 Node22.22.0、tsx 和 TypeScript，无新依赖。

## 迭代与通过条件

| 小步 | 最小交付 | 验证与进入下一步的条件 |
| --- | --- | --- |
| 1A 授权输入防线 | 新增 `src/homer-account.ts` 的可信服务端响应校验、PKCE／callback 操作；仅纯本机模块，不接 UI、网络或秘密存储 | 合法合同输入可消费；错误 origin、alias、subject、state、过期及重复 callback 被拒；cancel 后返回不再可采用 |
| 1B 合成生命周期环境 | 独立 HOME/runtime/workspace、内存秘密存储与可暂停的假网站交换／撤销；复用 AMH 候选，不重建五操作 | 授权、取消、迟到成功、秘密写失败可确定性复现；先红后绿；不触达真实账号或系统秘密存储 |
| 2 秘密与本机提交 | 单飞控制、prepare→OS store→本机指针事务、重启恢复、refresh／revoke；先对合成适配器实现 | R4/R5/R6/N3、结果未知与重复启动通过；唯一撤销凭据不提前删除，同 subject 保留原数据、异人拒绝 |
| 3 角色与固定163 | 配置／engine／service统一角色快照、可信子进程凭据 resolver、固定 alias 能力快照 | 固定163＋loopback假上游捕获新建／恢复／连续轮次、工具、图片、Fast、同步压缩和后台记忆；全部请求只用批准 alias，shell/MCP无Key |
| 4 本人状态与兼容 | 专用本机接口及原生 usage/status 查询，受限桌面采用；原 BYOK／原生路径保留 | 精确路径和原生包、无限Token／钱包区分、查询失败未确认；合成旧runtime升级两次及回退不丢新任务 |
| 5 界面与共同联调 | 最小账号入口、网站跳转、窄视口交互、操作手册及共同包锁 | 原生交互、数据保全与回退预演通过；网站／网关证据及同一正式包齐备后才做三方联调 |

每步先运行能观察到缺失行为的断言，再做最小实现，运行聚焦回归并审查 diff。不会为通过测试静默降档、切 BYOK、自动重放付费轮次或放宽合同。合同／身份／秘密／固定163能力冲突时暂停受影响部分，其他独立合成工作继续。

## 文件责任与依赖

- `src/homer-account.ts` 拥有客户端授权状态及校验；不接管网站的冻结／authSlot 恢复状态机。
- `src/model-access-secrets.ts` 在步骤2提供自身条目的秘密存储，不复用微信条目，不向 renderer 暴露 get Key。
- `src/config.ts`、`src/model-config.ts`、`src/engine.ts`、`src/service.ts` 在步骤3统一角色与执行，保留现有覆盖语义。
- Web、desktop-management、profile/runtime 和 Electron 仅在步骤4–5修改必要接线，先确认现有 adoption 与运行绑定兼容，不绕过校验。
- 测试及合成 helper 放 `tests/`；执行输出与隔离数据统一放本候选 `.codex/scratch/homer-account-stage1/`。

AMH 候选 `/Users/wolf3c/Project/AgentModelHub/infra/new-api/homer-contract-v1/` 当前未发布、sourceCommit=null。本地临时输入不是正式共同包；正式联调须记录 producer、准确sourceCommit及package/contract摘要。Homer 客户端不调用内部五操作、不持服务秘密。

## 验证命令与记录

使用 `/Users/wolf3c/.nvm/versions/node/v22.22.0/bin/node` 和已有依赖，测试进程使用清空继承环境后的专属 HOME/CODEX_HOME/TMPDIR。不会直接运行可能读取真实配置的 acceptance 脚本。

基线聚焦回归为 `tests/model-config.test.ts` 与 `tests/worker-default-fast.test.ts`；新增行为用 `tests/homer-account.test.ts`。后端检查采用 `tsc -p tsconfig.json --noEmit`，新增测试另做定向 TypeScript 检查。只在接线涉及更多模块时扩大回归范围。

进度与实际命令／结果保留在本文件后续记录及 scratch；未获提交授权前，候选身份为准确base＋未提交diff，不把base冒称实现提交。

## 1A 初次交付记录（提交前）

- 已建立 detached 隔离候选，未创建分支；本任务未写入主树或原文档工作树。主树仍有外部并行改动，未纳入本候选。
- 已有依赖以本机 node_modules 链接复用，没有安装或修改锁文件。
- 1A 已实现可信服务端响应白名单校验、固定 origin／alias／subject 边界，以及内存 PKCE／state、严格 callback、一次消费、取消与虚拟时钟到期守卫。只新增独立模块，尚未接入 service／UI，没有监听端口、打开浏览器或读写 OS 秘密存储。
- 既有模型／Worker基线：130/130通过。响应校验红灯1通过／26失败，补齐后27/27通过。callback有效测试红灯31通过／21失败，补齐后52/52通过。
- 独立只读审阅发现端口80／前导零被浏览器规范化后的 Host 比较不一致。新增两个行为用例后观察到57通过／2失败；从 URI 派生规范化 Host、保留精确 redirectUri 后修复。同时补入非法 code 不消费操作、错误 state 的拒绝不能取消原操作的断言。
- 最终账号测试59项与既有130项合跑：189/189通过，0失败、0跳过，实际耗时83.6秒。该结果只证明合成模块／协议 fixture，未运行固定163真二进制模型序列或真实账号验证。
- 最终后端 TypeScript 无输出检查、新增测试的定向 TypeScript 检查均退出0；三个新增文件的逐文件 whitespace 检查通过。
- 1B及后续步骤尚未完成：真正先监听后开浏览器、单飞宿主、HTTP交换／撤销、可暂停假秘密存储、持久化／崩溃恢复、角色接线及桌面界面均未交付。本轮不能记为整个第一阶段完成。

本轮核心命令（在隔离候选目录执行；Node明确选22.22.0，先创建下面隔离目录）：

```sh
mkdir -p .codex/scratch/homer-account-stage1/host-home .codex/scratch/homer-account-stage1/codex-home .codex/scratch/homer-account-stage1/tmp

env -i PATH=/Users/wolf3c/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin \
  HOME="$PWD/.codex/scratch/homer-account-stage1/host-home" \
  CODEX_HOME="$PWD/.codex/scratch/homer-account-stage1/codex-home" \
  TMPDIR="$PWD/.codex/scratch/homer-account-stage1/tmp" LANG=en_US.UTF-8 \
  /Users/wolf3c/.nvm/versions/node/v22.22.0/bin/node node_modules/tsx/dist/cli.mjs \
  --test --test-concurrency=1 tests/homer-account.test.ts tests/model-config.test.ts tests/worker-default-fast.test.ts

/Users/wolf3c/.nvm/versions/node/v22.22.0/bin/node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
/Users/wolf3c/.nvm/versions/node/v22.22.0/bin/node node_modules/typescript/bin/tsc --noEmit --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --esModuleInterop --skipLibCheck --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters tests/homer-account.test.ts
```

实际执行还对类型检查使用了同一清空继承环境。输出位于 `.codex/scratch/homer-account-stage1/` 的 `baseline.tap`、`credentials-{red,green}.tap`、`callback-{red,green}.tap`、`review-red.tap`、`final-tests.log` 及类型检查日志。没有运行全仓测试或可能访问真实配置的 acceptance 脚本。

初次1A交付只有上述三个新文件。当前提交范围为两个独立纯模块／入口、对应两份测试和两份文档，共六文件；无新依赖或锁文件修改。BYOK试跑与审查修复结果见隔离入口文档。最终提交身份以本文件Git历史为准；网站授权宿主与后续步骤仍未实现。
