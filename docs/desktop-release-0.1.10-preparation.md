# Homer 桌面 v0.1.10 发行记录

状态：2026-11-12，修复及本地验证完成，准备重新执行三平台构建。

- 本轮用户要求先补全修复、确认真实构建器输出契约，再继续三平台构建。沿用已授权的提交、推送、创建标签、Mac 签名公证、草稿直传和 Apple 芯片隔离验收范围。保留 v0.1.9 的失败标签与六个草稿附件，不覆盖、不混入新轮。
- 产品版本 0.1.10，显式 build 295；上一公开版 v0.1.8 / 293，本轮失败候选 v0.1.9 / 294。
- 三平台：Apple 芯片 Mac / macOS 27、Intel Mac / macOS 14、Windows x64 / Windows 11。Mac Developer ID 签名、公证及 stapling；Windows 未签名。
- 网站 `https://super-tree.com`，网关 `https://models.super-tree.com`。原生更新来源 GitHub Latest，安装器引用固定标签。公开及 Latest 仍需另行授权；Intel、Windows 实机与原生升级尚未验收。

## Windows 修复与契约检查

锁定的 electron-builder / app-builder-lib 26.18.0 在关闭 differentialPackage 后，非差分 NSIS 路径不提供自定义 updateInfo。实际 createUpdateInfoTasks 和 writeUpdateInfoFiles 生成的 latest.yml 包含文件名与实际 SHA-512，但 files[0] 没有 size。专项直接调用安装依赖中的这两个函数，写出并重新解析 YAML，再交给 Homer；未模拟生成器或手写其输出。安装器输入为合成字节，不把这个专项称为真实 NSIS 安装验收。

Homer 先核对安装器 SHA-512，再将实际读取字节数写入清单；已有错误长度、错误摘要、错误文件引用及提权标记仍拒绝。校验错误使用固定字段标识，不打印清单内容或路径。Windows 云端在打包前运行同一契约专项。测试已登记在现有 development 清单，无需扩大默认测试。

本地验证：

- `node --test --test-name-pattern='real electron-builder' tests/electron-package.development.test.mjs`：真实生成器契约及 YAML 往返通过。错误字段诊断断言先失败后通过。
- `node --test tests/electron-package.test.mjs tests/github-release-draft.test.mjs tests/github-build-plan.test.mjs`：41 项通过。
- 模板一致、版本元数据一致与 git diff --check 通过。

完整 NSIS 生成、三平台云端下载校验及新包 Apple 芯片验收仍待本轮实际执行，不沿用旧轮产品验收。
