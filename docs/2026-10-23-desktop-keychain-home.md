# 桌面隔离 HOME 下的原渠道 Keychain 接续

2026-10-23。a33e43d 独立审阅通过后，已经正常安装到 `/Applications/Homer.app` 并恢复原 ChatGPT 主对话；安装后的真实验收发现微信的可复现环境回归：同一既有 Keychain 条目，正常 OS 用户 HOME 下仅查元数据返回 0，桌面壳隔离 HOME 下返回 44。没有使用 `-w` 查密码、没有读取/复制凭据、解锁 Keychain 或修改访问控制。正常渠道恢复因 `wechat_keychain_unavailable` 将连接状态置 invalid/disabled；原绑定、secretRef 和全部收发/uncertain 事实保留，主聊天仍可使用。

根因是两个既有渠道秘密 owner 启动 `/usr/bin/security` 时继承桌面隔离 HOME，Keychain 搜索因此落到错误用户目录。最小修正在 `src/channels/wechat-secrets.ts` 与 `src/channels/telegram-secrets.ts`：只给 security 子进程显式设置 `HOME=userInfo().homedir`，其余环境沿原值。父 App HOME/tmp、Homer 原生账号目录、命令、服务/条目命名空间、stdin 编码与读回验证、ACL、审批和秘密存储均保持。Telegram 是同一实际调用路径，未配置 Telegram 不因此被启用或连接。

这两份源文件加入桌面有限准备来源清单，从 23 项变为 25 项，保证准备和普通模式都核准确输入。当前已安装 build4 不补源码。新安装包沿原应用身份，仅将 Info.plist 与 manifest 的 build 同步递增为 5；版本仍为 0.1.0，UI/schema/工具合同未变。

`tests/macos-keychain-home.test.mjs` 对两个实际编译 owner 做行为级红绿验证：隔离父 HOME/tmp，替换 Node spawn 为无网络合成子进程，核 security 绝对路径、准确参数和命名空间、秘密返回校验、子进程 OS HOME、其余环境及父环境不变。不执行真实 security、不读真实凭据。初次 fixture 的 Telegram 编码和微信 URL 不符合原验证器，已修正 fixture；准确 a33e43d 两项红灯均因缺少正确子环境 HOME，修正两项绿灯通过。原 Telegram 秘密/可信入口 3 项、有限来源护栏 3 项通过。后端类型编译通过，全项目原 137 条诊断与候选逐条一致，仅移除准确已知导出根路径后比较；不声称全仓全绿。

[验证记录](patches/2026-10-23-desktop-keychain-home-verification.json) 保留准确六文件 hash 和元数据证据。临时红绿及类型日志在本任务 `.codex/scratch/desktop-integration-20261023/`。已有 a33e43d 私有维护点、原数据及已安装 App 均保留，未以旧库覆盖新事实。

下一步为准确 main 提交的独立定向复审及新冻结，从普通 Git archive 构建、原入口冷启动通过后，再正常退出旧 App、核实际 stopped/exit0/owner 释放并为当前数据建立新维护点。正常安装 build5、打开原主对话后，通过既有渠道 owner 恢复原启用意图，不新绑定、不写入密码、不重放 sent/uncertain、未知请求或审批。最终验收及清理另续记正式发布记录。
