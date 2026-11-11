# Homer 协作身份与接口精简方案

历史方案：本文仅保留 2026-11-04 的决策与验证记录。2026-11-05 会话架构已替代旧合同、Matter、候选验收和旧调用兼容处理；2026-11-06 的[消息与附件方案](architecture/main-worker-chat-architecture.md#消息与附件统一交付)进一步决定删除 Result／Delivery，准确文件改由消息附件引用。下文“保留成果实体”和兼容处理不再是当前实施要求；新方案尚未改动产品代码。

更新：2026-11-04。状态：源码已实现，通过 99 项离线定向测试及 TypeScript 检查；未构建、安装或部署，真实模型／原生线程恢复未验收。

## 1. 决策与范围

**普通文件直接提供地址；正式成果保留记录与稳定引用；只删除已证明没有选择意义的模型参数。** 沿用现有工具、存储和授权，不新增实体、通道、映射表或兼容框架。

- 源码、日志、中间文件等普通本地文件，在已有任务说明中提供地址，配合 `workingDirectory` 使用。无需为交接注册成果、复制文件或生成另一种 ID；地址本身不授予读写、删除或发布权限。
- 正式成果仍有候选、检查、验收、采用和发布的生命周期。保留 `resultId`，宿主负责核对所属任务、版本、Run、文件字节和哈希；不让模型用更多字段重新拼装成果身份。
- 本期不合并业务实体、不改库、不重编历史 ID。已有字段若承担路由、追踪或恢复作用，不能仅因名称复杂而删除；未证明多余的接口保持不变。

## 2. 保留、合并与删除清单

| 对象／接口 | 决定及理由 |
| --- | --- |
| Task／TaskVersion、Run | 保留 `taskId`、`version`、`runId`，区分工作、契约版本和执行尝试。保留修订、epoch、停止确认与恢复关联。 |
| Matter、Worker 路由 | 保留 `matterId` 和现有分组；`worker:<taskId>` 已是派生路由，无独立 Worker 实体需要合并。保留 `agent_send.recipientAgentId`，不改成另一套任务寻址接口。 |
| Result／正式文件成果 | 保留 `results`、主结果及每文件 `resultId`、`completionResultId` 分组、验收与发布关联。路径说明文件位置，ID 稳定指向记录，两者各有用途。 |
| 正式成果工具 | 保留 `contract.inputs` 的 `{type:'result',id}`、`work_inspect.resultId`、`inspect_result_file`、`task_review.resultId`、子任务采用的 `resultId`，以及 `publish_delivery` 的成果／文件选择字段。无文件结论与多文件成果均沿用原合同。 |
| 普通文件、材料与附件 | 普通文件使用地址；`material.id` 已是材料相对文件名，不改名或另设协议。上传附件保留 `assetId`＋revision，继续管理来源、准备和撤销。 |
| 来源、消息、操作、交互、交付、待办与检查点 | 保留各自身份、作用域及生命周期；保留 `inbox_ack.resultId` 等仍有持久关联的字段。原生 thread／turn／item 与进程会话沿用引擎机制。 |
| 固定协调者参数 | 仅删除下一节列出的三处模型填写要求；保留内部协调责任与记录字段。 |

本期没有需要合并的实体。不增加任务／版本／路径选择器来替代正式成果 ID，也不新增普通文件登记、授权清单副本或返回值脱敏投影层。

## 3. 接口变更：省略固定协调者参数

当前业务协调者只能是该 Homer 实例的主 Agent。目标由宿主确定，动作仍须调用方明确选择。

| 新调用不再填写 | 宿主行为与必须保留的校验 |
| --- | --- |
| `task_takeover.coordinatorAgentId` | 固定交给主 Agent；保留版本／修订、真实来源、停止 fence 和未知执行状态校验。接管不代表任务成功，也不能越过未确认退出。 |
| `task_update.children[].coordinatorAgentId` | 仅在显式 `action:'transfer'` 时取主 Agent。保留 retain／update／stop／transfer 的区别及后续停服确认、接管步骤；省略参数不等于转交已经完成。 |
| `task_review`／`publish_delivery` 的 `children[].nextCoordinatorId` | 显式 `disposition:'transferred'` 时取主 Agent，仍须确认子任务已由该协调者接管且 `controlState='normal'`；未完成的转交继续拒绝，不能计为成功。 |

`tasks.coordinatorAgentId`、`child_resolutions.nextCoordinatorId` 和既有回执继续记录实际事实；不删除列、不改写旧记录。其他工具名称、参数与返回结构不借本次调整重设计。

## 4. 三类旧调用的兼容处理

目前严格参数校验发生在操作幂等查询之前，直接从 schema 删字段会挡住旧请求。新工具目录不再列出上述固定参数，但现有工具 owner 须保留这些旧字段的窄范围解析；不建立第二套工具或通用协议转换层。

| 旧调用类别 | 处理方式 |
| --- | --- |
| **历史只读**：旧任务、合同、成果、消息、操作回执和下载 | 使用原 ID、原读取入口与原权限读取。回执原样返回，文件路径和下载链接不搬迁；不重写历史 JSON，不重放动作，也不把旧回执伪装成新格式。 |
| **已接纳操作重查**：已有 Operation，调用方未收到响应或状态未明 | 优先用 `work_inspect(operationId, operationScopeId)` 查原操作；作用域有歧义时不猜选。相同 actor／作用域／operationId 的旧形态重试，按既有载荷结构和哈希规则匹配，命中后返回原回执，不再执行。载荷冲突拒绝；accepted／uncertain 或缺少完成证据时继续核对原状态，不自动补做外部动作。 |
| **未执行旧请求**：尚未接纳的旧格式调用 | 仅兼容本次省略的固定字段，按旧形态和原语义校验；原本无效的目标继续拒绝，不能静默改成主 Agent。确认尚未执行后，仍经原授权、版本及执行状态检查，再由宿主确定固定目标。未知格式或过期请求明确拒绝；缺少操作记录不能证明外部动作未发生，无法确认时保留未知状态，不因升级自动重放。 |

幂等顺序必须保持：**先以该调用原有载荷查原操作，再为新操作确定执行目标。** 不在查询前删旧字段、补默认值或重新哈希历史数据；新调用的省略字段形态沿用现有操作记录机制，不保存第二份规范化载荷。重试须保持原载荷；新旧形态若哈希不同，仍报载荷冲突，不能自动换 ID 绕过。

保留现有角色、消息目标及读取范围检查；返回旧回执不等于授予新权限。原五个主工具 `list_work / dispatch_work / inspect_run / review_artifact / stop_work` 的定义与恢复指纹不变。MCP 目录在已有空闲／退出确认边界切换，不重置主线程、账号或 HOME 来绕过恢复问题。

宿主自动转交也复用原接管操作：在 [服务](../src/service.ts) 的 `applyUpdate` 中，先按既有 operationId／作用域检查接管回执，已完成则沿用，未知状态则阻断；只有原操作不存在时才经原接管入口处理。避免恢复旧请求时用当前修订号重建已完成的接管。

## 5. 不变的授权、协作与数据边界

- **指定成果转交**：沿用当前能力，成果须真实且已验收，主 Agent 可读生产者，生产版本的真实用户来源被目标任务来源覆盖。仅授予合同明确列出的输入，Worker 经 `read_material` 读取；不授予整个生产任务的检查、控制或停止权限。知道 ID 或地址均不构成授权。
- **验收与发布**：同轮检查准确结论及该次候选文件组、核对字节／哈希，随后分别验收、采用与显式发布。保留文件组关联和准确文件选择；路径不能替代 Web 下载许可，同路径换内容仍须拒绝。
- **版本与恢复**：保留版本／修订、Run epoch、采用及停止 fence；旧执行不能操作新执行。unknown／uncertain 不自动重放，消息已消费不代表业务已完成。
- **历史与切换**：保留数据库、外键、合同／授权快照、操作哈希／回执、输出目录和 `/api/files/{resultId|runId}` 等历史消费者。无数据迁移也须验证恢复及降级；不回滚数据库来抹掉已发生动作。
- **归档收尾**：童子军原则、事实通知、Skill 及既有授权保持不变。主 Agent 继续依上下文判断并派工；删参数不解决用途判断或脱管进程问题，也不扩大清理权限。

## 6. 最小实施范围与验收

本次仅修改下表涉及的现有 owner、调用方与测试，无数据库迁移。

| 范围 | 实现与定向验证 |
| --- | --- |
| 固定参数及调用方 | 在 [模型工具](../src/recursive-tools.ts) 与 [任务 owner](../src/recursive-tasks.ts) 中省略三处参数、窄范围解析旧形态，并在幂等检查后确定固定目标。同步 `scripts/recursive-synthetic-host.ts` 与宿主多文件 fixture；新调用可省略，旧有效调用可恢复，非法目标／未确认接管仍拒绝。 |
| 兼容与幂等 | 通过 `tests/recursive-tools.test.ts`、`tests/receipt-result-recovery.test.ts` 等验证三类旧调用、原载荷哈希和原回执；覆盖宿主新旧转交请求重试，载荷变化拒绝，未知状态不重做接管。真实引擎恢复仍依 [测试边界](testing.md) 单独验收。 |
| 保留能力回归 | 指定已验收成果转交、越权与字节变化拒绝、多文件检查／发布／下载、持久化恢复和 Worker 控制边界检查通过。沿用 `tests/result-input-authority.test.ts`、`tests/multiple-artifact.test.ts` 等既有合同；普通文件仍在原任务说明中提供地址，未增加登记或搬运流程。 |

完成标准：没有新实体、表或双份状态；普通文件交接无需成果登记；正式成果稳定引用及保护保持；三处固定参数省略后，旧调用不会被误执行或阻断恢复。仅修改描述或返回通知不算完成。

源码依据：[任务与持久合同](../src/recursive-tasks.ts)、[模型工具](../src/recursive-tools.ts)、[原主工具与恢复](../src/service.ts)、[材料与文件](../src/files.ts)、[历史下载](../src/web-server.ts)。归档行为的实测边界见 [归档方案](task-archive-housekeeping.md)。

定向复验命令（项目根目录）：

```sh
node --import ./tests/fixtures/core-system-proxy.mjs --import tsx --test --test-concurrency=1 \
  tests/{recursive-tools,recursive-update-children,recursive-tasks,receipt-result-recovery,result-input-authority,multiple-artifact,multiple-artifact-host,worker-business-boundary,held-descendant-closure,worker-interaction-mcp}.test.ts
node_modules/.bin/tsc -p tsconfig.check.json --noEmit
```

结果：99 项通过、0 失败、0 跳过；类型检查通过。测试使用独立 scratch、合成任务与 Peer，未使用日常 runtime／CODEX_HOME；未改提示词、Skill、授权或沙箱权限，未运行真实模型、全量测试、构建、安装或发布。
