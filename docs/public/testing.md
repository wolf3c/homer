# 测试与移动端开发

先按[构建指南](getting-started.md)安装依赖并构建。测试使用独立目录和合成资料，不复用日常账号、runtime 或 Codex Home。

## Homer 自身检查

```sh
npm run typecheck
npm test
```

默认测试验证调度、审批、成果交付、持久化、权限及适配契约。它不代表真实模型、第三方工具、桌面安装或真机体验通过验收。

构建规划与 Release 草稿上传可单独离线检查：`node --test tests/github-build-plan.test.mjs tests/github-release-draft.test.mjs`。测试使用合成包、模拟 GitHub 协议及回环 HTTP，不访问 GitHub，不构建、签名或发布产品；验证附件名、Mac 更新链接、下载摘要及拒绝覆盖已发布版本。

## 显式专项

仅在准备好对应环境、账户和费用授权后运行；先阅读 `scripts/test.mjs` 对应清单和各测试的环境要求。

| 命令 | 范围 |
| --- | --- |
| `npm run test:local-media` | 本地文档、图片、音视频工具。 |
| `npm run test:engine` | 真实引擎及对应运行环境。 |
| `npm run test:account` | 模型服务账号及网关。 |
| `npm run test:rtc` | WebRTC 通信。 |
| `npm run test:development` | 开发、构建及发布流程。 |
| `npm run test:vendor` | 上游组件契约及资源。 |
| `node scripts/test.mjs --browser` | 浏览器专项；须显式设置 `HISTORY_FOLLOWUP_BUILD`、`HOMER_SYNTHETIC_ROOT`、`HOMER_BROWSER_EVIDENCE`，按清单准备隔离环境。 |
| `npm run test:desktop:acceptance` | 已构建桌面 App、显式指定引擎与模块。 |

缺少依赖、条件跳过和未运行均保留未验证状态；专项退出码 0 不代表全部能力验收通过。`npm run test:real` 等真实任务可能产生模型费用，不能当作普通离线检查运行。

## 移动端

`mobile/` 使用 Expo、React Native WebView 和同一套聊天页面。根目录构建完成后：

```sh
cd mobile
npm ci
npm run build:ui
npm test
npm run typecheck
```

`npm run bundle` 检查 iOS／Android 的 JavaScript 包；`npm run ios`、`npm run android` 需要对应原生开发环境并会生成原生工程。正式分发另需应用标识、签名和渠道配置；生成目录不纳入源码。

移动端依赖主端、信令与 WebRTC 网络条件。源码包含客户端不代表提供可独立部署的信令服务，也不代表所有网络和设备均已通过验收。
