# Homer 桌面 v0.1.8 构建准备

核对日期：2026-11-11。用户要求按惯例准备 `v0.1.8` / build `293`，准备完成后再确认开始构建。本记录可公开；不包含账号、凭据或原始运行内容。

## 范围与输入

| 输入 | 准备值 |
| --- | --- |
| 仓库 / ref | `wolf3c/homer` / `main` |
| 类型 / 平台 | `kind=desktop` / `target=desktop-three` |
| 标签 / 构建号 | `release_tag=v0.1.8` / `build_number=293` |
| 草稿上传 | `upload_release_draft=true`，待确认后执行 |
| 网站 / 网关 | `https://super-tree.com` / `https://models.super-tree.com` |
| Node | `.nvmrc` 指定的 `22.22.0` |
| 系统基线 | Apple 芯片 macOS 27.0；Intel macOS 14.0；Windows 11 x64 |
| 签名 | Mac Developer ID、公证及 stapling；Windows 未签名，自动更新关闭 |
| 产品验收 | 仅 Apple 芯片 Mac，使用独立资料；Intel / Windows 保留未实机验收状态 |

Linux 桌面尚未适配，不加入矩阵。移动端版本、日常安装、生产网站、自动更新入口与 Latest 变更不在本轮准备范围。

## 源码与版本

- 准备基线为本地 `main` 的 `1f1009f52916b04e80daf6ac76becbb113c89746`。开始准备时工作区干净。
- 远端 `main` 只读回查为 `e22d6ddd9e01dc08cb12d6d0ac19261f50ee1a29`；本地领先 5 个提交、落后 0 个。后续按[仓库公开与同步](repository-publication.md)完整同步已提交的共享主线，不创建第二套公开文件树。
- 当前 Latest 为 [v0.1.7](https://github.com/wolf3c/homer/releases/tag/v0.1.7)，Release ID `440535806`，源码为 `6a5d1edc2aaaff5a8764007fab1afc9f823d6385`，build `292`。本机 `/Applications/Homer.app` 的 `CFBundleVersion` 同为 `292`，拟用 `293` 满足递增要求。
- 根 `package.json.version`、锁文件顶层及根 package 版本更新为 `0.1.8`；依赖与锁定字节不变，UI workspace 与移动端不改版本。
- 远端标签列表未发现 `v0.1.8`，Release 列表中也无此版本。本轮没有创建标签或草稿。
- 版本变更尚未提交，因此准备基线不能直接作为构建的 `expected_sha`。执行前必须提交获准的准备文件、同步并回读最终完整 SHA；标签与 dispatch 均绑定该 SHA。

上版至本地准备基线的产品相关路径（`src`、`ui`、`scripts`、`packaging`、`tests`、`prompts`、根版本文件）差异共 75 个文件。不能将远端领先的 5 个本地提交等同于全部发行差异；共享主线整合已包含上版之后的其他产品变化。待核实的更新说明包括独立 ChatGPT 模型设置，以及会话展示、交互和 Cua 路径变化。最终双语 Release 正文应对照完整差异及本次安装包验收编写，不能把源码变化当成已验收效果。

## 准备检查

- 仓库默认分支为 `main`，当前身份权限为 `ADMIN`。`homer-build.yml` 在远端默认分支存在，状态 `active`；远端文件、本地工作流与维护模板一致。
- 工作流仅允许手动触发；checkout 固定 `github.sha`，规划入口核对 `expected_sha`。同标签排队，不取消上传中的运行。
- YAML 解析、12 段 shell 的 `bash -n`、9 处完整 SHA 固定的 Actions 引用通过。工作流 SHA-256：`f696bda20603ae9f752f64c74d37c12b21dcbb8ea7e7c6d6a7857123d973211d`。
- 构建、依赖准备、运行时、来源冻结和 Electron 配置入口存在；工作流显式传入双服务地址、发行标签、构建号、Intel 最低 macOS 14 与 Windows 未签名参数。
- 三平台 Node 归档具有固定 SHA-256，Codex 归档具有 SRI；随源码的 Codex 许可原字节与锁定摘要一致。没有下载归档、安装原生依赖或验证 runner 工具链。
- Mac 证书及公证所需 Secrets 名称存在；未读取其值，证书有效期与真实签名待构建验证。
- 本地 Node `22.22.0` 下执行 `node --test tests/github-build-plan.test.mjs tests/github-release-draft.test.mjs`：21 项通过，0 失败、0 跳过。仅使用合成 GitHub 协议、临时文件和回环 HTTP，未调用真实上传或构建。
- 版本一致性、锁文件仅两处版本变化及模板同步断言通过。本轮不改变产品行为，无需新增测试。

## 确认后执行

1. 获准后审查并提交本轮版本及准备材料，完整推送 `main`，回读远端完整 SHA；再次核对版本、build、标签占用与工作流状态。
2. 在创建标签、Mac 正式签名及草稿上传均获准的前提下，创建不可变 `v0.1.8` 标签并确认它解析到同一 SHA。
3. 按上表 dispatch 一轮三平台桌面构建，记录 run ID / attempt；跟踪三平台打包、直传草稿及 `verify-draft` 云端完整下载摘要校验。
4. 只下载 Apple 芯片包，核对回执与包内 manifest 的版本、build、SHA、双服务地址、签名及来源，在独立资料下验收。Intel / Windows 不标记实机通过，Windows Cua 的签名候选验收条件仍未满足。
5. 草稿与验收完成后报告结果。公开 Release、Latest、官网及部署按各自授权推进，不由构建默认参数推定授权。

本轮没有提交、推送、创建标签、触发工作流、构建、签名、上传、安装或发布。没有产品编译、全量回归、真实模型或外部通信验收；静态准备通过不代表三平台安装包可用。

## 执行授权（2026-11-11）

用户在准备完成后确认提交并同步准备内容、创建 `v0.1.8` 标签、执行 build `293` 三平台构建（Mac 正式签名及公证）并上传草稿。后续跟进云端校验与 Apple 芯片包验收；不公开 Release、不变更 Latest。下方执行记录以实际结果补齐。
