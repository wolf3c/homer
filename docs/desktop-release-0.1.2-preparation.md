# Homer 桌面版 0.1.2 构建准备

核对日期：2026-11-06。以下为准备阶段快照；用户随后授权提交、同步公开源码、创建标签并开始三平台草稿构建。实际提交、运行及验收状态见下方执行记录。本记录属于本地维护材料，不加入公开文件树。

## 本轮范围与版本

用户确认桌面版本为 `0.1.2`，沿用 Apple 芯片 Mac、Intel Mac 和 Windows x64 三平台；仅 Apple 芯片版进行实机验收。Intel 和 Windows 保留未实机验收状态。Linux 桌面未适配，不加入本轮矩阵。移动端版本与发行独立，本轮不修改。

根 `package.json.version`、锁文件顶层及根 package 版本已一致更新为 `0.1.2`，未改变依赖或锁定的依赖字节。拟用显式 build `287`，高于已发行桌面 build `269`、只读核对的本机安装 build `273`；正式执行前再次核对递增条件。

| 输入 | 准备值 |
| --- | --- |
| 仓库及 ref | `wolf3c/homer` / `main` |
| 类型及平台 | `kind=desktop` / `target=desktop-three` |
| 标签及构建号 | `release_tag=v0.1.2` / `build_number=287` |
| 草稿上传 | `upload_release_draft=true`；仅为后续执行参数，本轮不上传 |
| 网站及网关 | `https://super-tree.com` / `https://models.super-tree.com` |
| Node | `.nvmrc` 的 `22.22.0` |
| 系统基线 | Apple 芯片 macOS 27.0；Intel macOS 14.0；Windows 11 |
| 签名及更新 | Mac Developer ID、公证及 stapling；Windows 未签名、禁用自动更新 |

## 源码与公开候选

本地产品基线为 `19ac7005615389be3ea7c92ae57a52c8ea66e45d`，包含新任务／Worker 会话架构及授权绑定优化。此前优化对话保存的实测记录与此 SHA 一致：隔离 macOS App＋实际 ChatGPT 共 16 项检查通过，回收临时资源并保全正式成果；该轮由主 Agent 亲办，没有覆盖归档后新派 Worker 的实模分支。它是版本变更前的产品基线证据，不代表本轮三平台发行包已经验收。

只读核对的 GitHub main 为 `f589b5f3fae491d9e30691d816e88ad4c999d823`。本地与公开仓库分别维护历史，不能直接推送本地 main。GitHub 尚未包含本轮完整产品优化。

独立公开候选位于 `.codex/scratch/github-build-preparation-20261106/public-source/`。以远端快照为底，映射本地已提交的产品代码、测试、打包配置、运行所需资源、内置 Skill 及既有公开指南，再叠加本轮两份桌面版本元数据；工作流由维护模板映射到 `.github/workflows/homer-build.yml`。公开候选另规范化 `native-boundaries.md` 和 `ui/desktop-account-state.ts` 的尾部空行，不改变指令或程序逻辑。保留公开 README、许可证及公开仓库元数据，不带入本地历史、运营文档、内部发行 Skill、品牌工作底稿或其他未提交内容。

- 候选共 `978` 个文件；相对远端新增 `18`、修改 `255`、删除 `17`。删除项来自已提交产品清理，完整路径见候选旁的 `public-diff.txt`，本轮未删除共享工作区文件。
- 逐文件清单及 SHA-256 在候选旁 `manifest.json`；清单摘要为 `89cf1381e887e0ab4f9cea837d23d2d88b5f6cb1b15b7d0208a5ab5e26595c5b`。计算方式为按路径排序的 `{path, sha256, bytes, mode}` 清单，以键排序、无空白的 JSON 编码后计算 SHA-256。
- 桌面版本元数据仍未提交，候选也没有创建提交。因此当前没有可用的最终 `expected_sha`；上述本地基线或旧远端 SHA 都不能作为本轮 dispatch 的输入。
- 主工作区原有 `docs/README.md`、`docs/desktop-app-update.md`、`docs/mobile-app-update-notice.md`、`.gitattributes`、`docs/desktop-release-0.1.1.md` 的修改／未跟踪状态保留，均未纳入本轮候选。

## 核对结果

- 远端默认分支为 `main`，仓库公开；当前身份具有管理和推送权限，Actions 已启用。`homer-build.yml` 已在默认分支注册且为 `active`，只允许 `workflow_dispatch`，字节与本地维护模板一致。权限是技术条件，不构成写操作授权。
- 所需六个 Mac 签名／公证 Secrets 名称齐全；未读取其值，也未验证证书有效期或真实签名。临时钥匙串及凭据清理逻辑保留。
- 远端没有 `v0.1.2` 标签或 Release；现有桌面 `v0.1.1` 不覆盖、不移动。原 Latest 是 `mobile-android-0.1.1-4`；本轮不改变 Latest，后续公开及下载入口策略须按发行授权执行。
- 本地和公开候选各运行 `node --test tests/github-build-plan.test.mjs tests/github-release-draft.test.mjs`：各 `21` 项通过，零失败、零跳过。均为合成包、模拟 GitHub 协议及回环 HTTP，不编译产品或访问真实账号。
- YAML 使用系统 Ruby YAML 解析；`12` 段 shell 通过 `bash -n`，`9` 处 Action 引用固定完整 SHA。源码固定、三平台规划、显式双服务地址、Intel Swift/macOS 14 目标、Node SHA-256 和 Codex SRI 配置检查通过。
- GitHub 基线快照、原工作流、离线测试回执与公开差异清单保存在同一 scratch 目录；准备期间没有新增 Actions 运行或改动 Release。

## 后续执行条件

1. 审阅候选差异与本轮版本变更，获准后仅提交本轮版本及准备材料；通过独立公开文件树提交、同步产品源码，禁止将本地内部历史直接 push。
2. 重新读取远端完整 SHA，核对已审查的工作流、规划脚本、构建入口及候选文件摘要。获准创建并推送不可变的 `v0.1.2` 标签，确保标签解析到同一公开源码 SHA。
3. 用户明确要求开始构建后，使用上述输入和新核对的完整 `expected_sha` 触发一次整轮工作流。先跟踪草稿直传及云端完整摘要校验，不能将旧版附件或不同 run／attempt 混入本轮。
4. 仅下载 Apple 芯片包，在独立 profile 验收；核对 ZIP 内 manifest 和构建回执的双服务地址、版本、来源及签名，保留 Intel／Windows 未实机验收说明。不得替换日常安装。
5. 按授权公开同一草稿，再核验公开分发与 Latest 策略，准备 Yezi2 下载入口及 Mac 更新清单交接。网站修改、发消息和部署仍沿用各自授权。

准备阶段没有安装依赖、产品编译、全量回归、三平台云端构建、正式签名、公证、覆盖升级或新版本实机验收。草稿直传仍缺首次真实云端运行证据；离线检查通过不能替代这些验收。

## 执行记录（2026-11-06）

- 用户已授权提交、同步公开源码、创建标签并开始构建。公开发布及 Latest 变更不在本轮执行范围。
- 本地版本与准备材料提交：`8b672a415ebdd7c7252a8bcb09ce88471b30812c`。
- 公开源码及 `v0.1.2` 标签已原子推送到 `d176e6c13c64a434d9650b82d7a9a198f16c8a15`；远端 Git tree 为 `92e2969dd9b261a52fb11cba14ea853e641e6e3b`，与本地已审查的公开候选一致。共 290 个公开文件变化，未带入本地内部历史。
- 独立公开候选安装锁文件依赖后，使用 Node 22.22.0 完成 `npm run check`：源码构建、类型检查及 2,256 项默认回归全部通过，零失败、零跳过。检查后仅规范化新增文件尾部空行；暂存 diff 检查通过。共享依赖目录与其他未提交文件未修改。
- 构建：[42063051881](https://github.com/wolf3c/homer/actions/runs/42063051881)，attempt `1`，操作者 `wolf3c`，ref `v0.1.2`；`expected_sha` 为上述完整公开 SHA。输入为 `kind=desktop`、`target=desktop-three`、`build_number=287`、`upload_release_draft=true`。规划及草稿预检通过，本轮最终失败。

| 平台 | 构建及草稿结果 |
| --- | --- |
| Apple 芯片 Mac | 源码编译完成；请求 `openai/codex` 的 `rust-v0.163.0` `LICENSE` 时返回 HTTP 403，打包失败。已确认官方文件存在，无法充分验证 runner 返回 403 的具体原因。未生成可验收安装包。 |
| Intel Mac | 发行打包步骤通过，含 Developer ID、公证及 stapling；草稿上传返回 HTTP 415，未保留可交付安装包。未做实机验收。 |
| Windows x64 | 未签名 NSIS 发行打包步骤通过；草稿上传返回 HTTP 415，未保留可交付安装包。未做实机验收。 |

草稿 `435442802` 保留，附件 `0`。`verify-draft` 和构建回执上传均未执行；没有完整附件或下载摘要证据，也没有 Apple 芯片实机验收。现有 Release 与 Latest 未改动；未重跑、删除草稿、移动标签或公开发布。

### 已验证的构建修正

- `scripts/github-release-draft.mjs`：下载 GET 保留二进制 `Accept`；上传 POST 按 [GitHub 上传接口](https://docs.github.com/en/rest/releases/assets#upload-a-release-asset)请求 JSON 回执，原二进制正文、长度、摘要和防覆盖检查保留。回环 HTTP 测试先复现旧代码的 415，再验证修正通过。
- `scripts/prepare-desktop-dependencies.mjs`：使用随源码保存的 [Codex 官方 `rust-v0.163.0` 许可文件](https://github.com/openai/codex/tree/rust-v0.163.0)。校验 Git blob 原字节、版本绑定及锁文件 SHA-256；Windows checkout 保留原字节。升级 Codex 时必须同时更新许可文件和锁定摘要。不再在每个 runner 上临时请求原 API，不向构建注入额外 Token；Node/Codex 归档及签名校验未放宽。
- 本地和独立公开树各 74 项构建、来源、归档和草稿协议定向测试通过，零失败、零跳过。公开修正提交：`14bc5c67ed03c2d776fe801e74fb7fa4b772361b`。
- 原 `v0.1.2` 标签固定到失败运行的 `d176e6c13c64a434d9650b82d7a9a198f16c8a15`。用户确认保留原标签和空草稿，并改用 `v0.1.3`（build `288`）。修正后的三平台构建和草稿校验结果见 [v0.1.3 构建记录](desktop-release-0.1.3.md)。
