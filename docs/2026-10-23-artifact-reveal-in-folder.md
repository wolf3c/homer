# 在文件夹中显示成果文件

2026-10-23：本功能经过实现、代码审查及独立提交内容验证。本次仅提交成果定位的源码、测试和说明，未部署或重启运行版。维护源为 `/Users/wolf3c/Project/homer`，其他 worktree 及主树并行改动保持原样；本功能的提交不表示批准发布整棵脏主树。

## 使用与准确文件含义

点击聊天中的成果 FileList，在 Canvas 现有操作区点击“在文件夹中显示”。macOS 请求运行 Homer 的电脑使用 Finder 选中该文件，不运行文件，也不只打开父目录。手机或远程访问时请求的仍然是 Homer 主机。其他系统明确提示暂不支持。

已有 `results.filePath` 与 `sha256` 记录可准确定位发布成果；`stage_workspace_file` 先读工作文件、再写正式成果，原实现未保存两者关联。因此新增 `payloadJson.workspaceSource={path,sha256}`，由原暂存 owner 二次核验当前 Run 内的实际字节后登记。没有新表、迁移、独立成果库或客户端路径字段；直接生成的成果及旧记录仍准确定位已登记的正式成果，并在回执说明未保留独立工作源路径。新来源不会反推或补造旧记录。

有来源时优先工作源文件。源已删除、移动、内容改变或路径越权就失败，不按文件名搜索、不悄悄选副本。以 SHA-256 识别交付字节，未声称曾登记 inode。已有禁止软链的 Files 规则沿用，包括解析后仍需处于对应 Run 的真实目录。

更早的 legacy 记录如果连交付哈希也未保存，会明确报“未保留可核验的文件版本”，不把当前同名文件冒充原交付版本。

## 实现边界

- `src/service.ts`：仅在 `stage_workspace_file` 的原 `writeFile` 调用传入刚核验的源路径；工具 schema 不增加可信来源参数。
- `src/recursive-tasks.ts`：在现有暂存事务及幂等意图内核验／保留来源；`publishedRevealTarget` 先沿原 `publishedResult` 验证明确发布、未撤销、accepted、Run 边界和哈希，再解析来源。沿现有单用户 Web 发布读取权限，不增加新的跨线程授权模型。
- `src/artifact-reveal.ts`：固定 `execFile('/usr/bin/open',['-R',checkedPath])`，无 shell 拼接、URL 或任意命令；10秒超时，外部进程错误不向客户端回显路径／stderr。回执仅有 `target:source|published`、`device:homer-host`。
- `src/web-contract.ts`、`src/web-homer.ts`、`src/web-server.ts`：增加可选 bridge 方法和 `POST /api/files/:resultId/reveal`；原 loopback、Host、Origin、Sec-Fetch-Site、禁止 query、JSON大小与类型校验保持；请求必须是同源 Origin 和空对象，绝对路径、filename、额外字段均拒绝。GET 不触发系统动作；旧服务方法不存在时明确不支持。
- `ui/artifact-reveal.tsx`、`ui/canvas-panel.tsx`、`ui/canvas-panel.css`：按准确成果 ID 挂载一个动作；同步防重入，提交中保留可聚焦按钮，中文设备说明与错误回执；关闭／切文件取消客户端等待，旧结果不覆盖新文件，不自动重试系统操作。不改变现有预览、HTML隔离、下载或原答复路径，不新增顶部入口或侧栏。

现有仓库没有活动的 macOS Finder bridge。已检查保全的旧 `HomerApplication.swift`：只见外链 `NSWorkspace.open` 与上传／保存面板，不能将它当作可复用的 reveal 接口；未改保全源码或安装中的宿主应用。

## 官方参考与核验边界

[assistant-ui File 官方说明](https://www.assistant-ui.com/elements/file) 提供文件展示及下载，公开 API 没有 Finder reveal；本次保留既有 File 与 Canvas 结构，只接主机动作。官方组件固定来源及适配继续见 `ui/vendor/assistant-ui/README.md`，本功能不修改其实现或引入依赖。

[OpenAI 官方 Work with files](https://learn.chatgpt.com/docs/artifacts-viewer) 说明预览、下载与各端文件能力；本次访问的官方 Settings 和文件文档未确证 Finder 的具体内部实现，不声称 Codex 使用 `open -R`。未检查 Cindy 私有实现、聊天数据库、凭据或全盘目录，也未声称核实了 Cindy 的底层调用。macOS 本机 `/usr/bin/man open` 明确记载 `-R` 为在 Finder 显示文件而不打开，系统语义依据此实际手册及合成调用验证。

## 验证与证据

维护的非敏感合成用例：`tests/artifact-reveal.test.ts`、`tests/workspace-file-publication.test.ts` 的来源测试、`tests/artifact-reveal.browser.mjs`。全部为需求推导的合成输入，未使用真实聊天、生产数据库、模型或真实用户文件。

## 审查修正与性能边界

来源核验改用已有 `Files.verify`，不再通过 `resultBytes` 额外读取第二份完整字节；源与发布文件路径相同时复用本次发布授权流程已校验的结果。保留完整哈希和安全路径校验，不增加缓存及其失效状态。性能用例约束同一路径只核验一次；这表示消除确定的重复 I/O，不代表做过整机吞吐基准。

损坏 JSON、空值、数组和非对象来源记录明确返回 `artifact_source_invalid`，不调用系统；来源版本缺失或变化仍失败。客户端将服务端拒绝与连接结果未知分开，取消了异常文字匹配和错误列表反查。测试改用已有且已跟踪的合成 fixture，不依赖并行任务未提交的文件。

验证于 2026-10-23，使用 Node 22.22.0，从暂存区导出的独立源码副本验证实际提交内容：

- 25/25 回归通过：`node --import tsx --test tests/artifact-reveal.test.ts tests/workspace-file-publication.test.ts tests/files.test.ts tests/recursive-tasks.test.ts`。覆盖准确发布ID、跨任务已验收但未发布身份、撤销、路径注入、凭据路径、越权软链、源移动／删除／版本变化、无来源／坏来源、固定系统参数、系统／平台失败、同源／GET／非法body、实际暂存及幂等，并覆盖既有递归任务结算及迁移。旧迁移测试需要先创建 `.codex/scratch/recursive-agent-implementation/`；缺少该临时父目录的首次失败已定位，创建后25项全部通过。
- 保持原操作指纹，旧操作不会因新增元数据冲突，也不反向补造来源；相同字节换路径重试仍保留首次登记的来源。损坏来源及同路径单次核验用例已红绿验证。
- 暂存区副本的完整后端 `tsc -p tsconfig.json --noEmit`、本次两份TS测试及其依赖的严格类型检查、UI `tsc --noEmit` 和生产构建全部通过。构建保留既有大包提示。副本以 HEAD 加本任务增量构造，不含并行的 Canvas、Sources、问答、队列或历史管理改动。
- 浏览器12项检查通过：真实 UI／HTTP／发布 owner，新的无登录 headless Chrome，1440/390/320px。44px按钮、无横向溢出、键盘 Enter、失败保留预览和焦点、pending防重复／重试、切换成果时迟到回执隔离。浏览器内 Finder 分发显式注入，不作为真实 Finder 成功证据。
- 并行脏主树曾出现其他类型／测试问题，本次审查时的全后端检查在 `src/recursive-tasks.ts:945` 报独立于本任务的 `string | null` 参数错误。未修复或提交该段；提交副本通过不表示整棵并行脏主树通过。没有运行模型、生产依赖或全量 `npm test`。
- 真实 Finder smoke：用本任务 scratch 内新建合成 Markdown，经真实发布 owner 与未替换的 `execFile` 调用得到成功分发回执；观察到与合成 Run 同名的 Finder 窗口。精确 AX 选中状态核验返回 `CUA_UNAVAILABLE`／unknown，因此尚不能声称已目视或通过 AX 确认选中项。没有读取或截图其他 Finder 内容。smoke脚本最初分发后等待 stdin 导致退出13；证据保留实际分发和窗口观察，等待逻辑已修正，未为此重复系统动作。
- 提交增量只包含本功能14个文件；`git diff --cached --check` 通过。不创建 branch、worktree、tag 或 remote，不部署、改宿主配置或重启生产。

证据在 `.codex/scratch/artifact-reveal-in-folder-20261023/`：本次审查的源码副本 `commit-review/`、构建 `commit-web/`、增量 `commit-only.patch` 与 `commit-manifest.json`。提交副本的三屏证据在 `commit-review/.codex/scratch/artifact-reveal-in-folder-20261023/`。此前原生 Finder 证据为根目录 `finder-dispatch.json`，源码审查不重复打开真实 Finder。截图仅有合成数据；维护的测试源码及本说明提供可重新生成的验证依据。后续复跑：

```sh
mkdir -p .codex/scratch/recursive-agent-implementation
node --import tsx --test tests/artifact-reveal.test.ts tests/workspace-file-publication.test.ts tests/files.test.ts tests/recursive-tasks.test.ts
npm exec tsc -- -p tsconfig.json --noEmit
npm run build --workspace=homer-web -- --outDir "$PWD/.codex/scratch/artifact-reveal-in-folder-20261023/web"
HOMER_SYNTHETIC_ROOT=.codex/scratch/artifact-reveal-in-folder-20261023/runtime HISTORY_FOLLOWUP_BUILD="$PWD/.codex/scratch/artifact-reveal-in-folder-20261023/web" node --import tsx tests/artifact-reveal.browser.mjs
```

## 回退

只撤回本功能自己的两处 Canvas 接线、新 UI 动作、两条 CSS、bridge方法／POST、系统分发模块、来源登记与解析及对应测试／设计段。保留所有并行 Canvas、官方 Sources、问答与队列改动。无需回滚数据库 schema；已保存的可选来源字段可由旧逻辑忽略，不删除历史成果或发布文件。不得对共享文件整文件 checkout 或把其他未提交增量混入发布。
