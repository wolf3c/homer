# 已验候选发布与自动更新恢复

后续原生工具/审批接线于00:06发布，网络权限收口于2026-10-18 00:24经正常后台自动切换为 `7a02ce032a85`，396项回归通过；Shell整轮网络暂不批准，授权MCP联网保留。本文d3a仍是此前完整候选发布的历史证据；最新指纹、采用与限定迁移预演见[27](27-native-tools-and-approvals.md)。

2026-10-17 **22:12（Asia/Shanghai）**，按用户“验证并上线，让我体验”的明确授权，已在原 Terminal 恢复正常源码自动更新入口。日常地址：<http://127.0.0.1:4780/>。原主对话、账号连接、历史、记忆、队列身份及六条 uncertain 保留。

## 现在可用

- 保留停止方形图标、44×44、title/aria、等待时 disabled/busy、独立发送。
- Web 多附件上传、草稿刷新恢复、排队编辑附件和撤回；既有流式、中断、追加机制继续复用原生 Engine，用量折叠展示，不增加内部工具流水。
- 更简短的记忆保存/纠正回执，不重复宿主确认或指向已不存在的设置入口；记忆仍由 Homer 原业务库管理并常开。
- 已实现的 iLink 文档/音频/视频处理、引用、缩略图、组合 publication、进度及生命周期候选代码进入日常。通过的证据是本机工具、合成引擎/SQLite/Mock 渠道；真实手机媒体播放、服务端扩展显示及模型理解**尚未验收**，不将代码上线等同于这些能力在手机上已通过。
- 顶部“能力”进入 `/settings/capabilities`，管理 Homer 专属 Skill/MCP 原生配置，读取连接和模型目录。新连接/程序/工具范围及 OAuth 仍需要明确对象授权，不安装依赖或接收 Token。

**原生主对话采用尚未完成。** 日常配置仍显式绑定原 `codexHome`，没有复制、软链或迁移 auth/原生 sessions。管理服务使用独立的 `~/Library/Application Support/Homer/codex`，真实 GET 回执为 `boundToNativeHome:false`、`application:isolated_configuration_only`，页面明确提示“旧引擎尚未采用”。此时保存管理配置可以成功，不能称它已加入原主对话。后续需要用户在专属 HOME 完成合法原生登录，且另行核实并批准原 thread 的合法恢复方式；登录本身不会搬来原 thread。未执行真实登录，未创建真实测试 thread。

## 发布指纹

| 项目 | 本次实际值 |
| --- | --- |
| 业务版本 | `d3a575a64471` |
| 完整源码 hash | `d3a575a64471af322fd3b2fb4bd87fec2a1088d59b0fbfc917578df2b44d3edb` |
| UI | `ee46f17bab93c7ac73978aad2bb9531776d4717b7063675b4869ca279dff052a` |
| gateway | `8245affd1cb8639af0214b3aab8c69579511cf8dfee1db12bf89d0fe9341cfdf` |
| 依赖 | `6ec82c3861e35ea215327c670026ca067320f4f5602a70bc38b93e198ba8a712`，与旧日常相同 |
| 原五 MAIN_TOOLS | `e6d674a05ae34945a5e234a2b1f55029f0d319e51371f448911845224062cf9a`，未变 |
| Web protocol | 1 |
| SQLite schema | `7bb04862cc7dedde54ba98eee74a942368d7e3e0a79332878e764d0ed3a5f4a0` |
| 实际 JS | `index-D7OAN603.js`，SHA256 `a092e17251b1bfd793e927c16b4631e633f82f8d83391f95c09b083404eff5be` |
| 实际 CSS | `index-hTNpmw-h.css`，SHA256 `8c1f72fa27ce28a0d7f3bffb5aa6217b6da64d551033eed3b9b92d54559f869b` |

正常构建、类型检查、源码与编译产物清单、HTTP index/JS/CSS 均实际匹配；没有伪造 hash、覆盖旧资产或修改保护。原配置文件 hash 仍为 `0bf61829ef7d0e937a962b84dec362c03f258a5c24e1fbea1aa0f8a9bda76ff3`，模型/effort未切换。当前原 Terminal window7325、tty `/dev/ttys000`、shell47294 持续运行；发布核查时 launcher92892、host92923，仅作当时证据，后续操作必须重新核实 PID。

## 验证结果

1. 新授权下正常执行 `npm run check`：最终退出0，**383通过、0失败、2跳过**。跳过的是需显式给定旧构建路径的固定 UI 专用测试，两项在停止图标维护已独立通过。此次没有真实模型、真实账号登录、微信外发或 `test:real`。
2. 迁移预演原先只核白名单表，未覆盖已有记忆等 owner；新增稳定用例先 RED，改为枚举全部原用户表后 GREEN 3/3。最终全量覆盖此修正。中途新测试 TS18048 类型错误已修正并重新通过完整检查；没有改弱断言。
3. 原日常只读 SQLite backup 与停服后新维护点均独立离线预演：全部 **51个原非meta表**的原列/行及全部原metadata保留，原主thread、六 uncertain 完整行hash相同，quick_check=ok、FK=0，恢复副本字节/schema/事实相同。只新增 `media_web_uploads`、`wechat_combined_events`、`wechat_delivery_options`、`wechat_reply_quotes` 四表和对应索引，未改旧DDL。没有构造模型/渠道/Keychain来做迁移预演。
4. 实际完整新 launcher + 合成 Engine + 临时库 + 空 HOME，在4801真实浏览器完成：两张PNG实际上传→刷新草稿保留→提交排队→只移除第二张并保存→撤回另一消息→605px实际点击44px停止。原队列分别 interrupted/completed/cancelled，完成项只保留一张附件，无待确认transport。
5. 同一隔离实例实际源码变更后台构建；主轮忙碌时保持旧版，停止并排空后自动切新版本，原合成thread和队列保留。再注入仅合成 Engine 的启动失败，实际阶段 running→starting→rollback→running，自动恢复前一版本及原thread/队列。没有在日常制造源码变更、故障或测试消息。
6. 日常先确认浏览器无可见草稿/保存草稿且主轮结束，再刷新验证页。实际加载上述新UI；605/1470均无横溢，附件/能力/独立发送可见。真实管理页另在605/1470验证隔离提示，实际只读点击模型目录确认当前 `gpt-6.1-sol / medium` 受支持，未切模型、登录或新增连接。日常空闲时停止按钮按原语义隐藏；运行与等待状态在同一UI资源的合成实例实点验证，没有停止用户回复。
7. 发布后核对所有原表记录 `changed=[]`、元数据身份保持、uncertain六行逐条相同、原thread恢复，微信connected、transport pending/rejected均0。记忆来源/历史没有迁入原生第二套系统。

## 维护点与回退边界

两次临近检查确认主轮/Worker/队列/待答/待审/任务/transport/渠道发送均空闲；仅有正常主 engine 驻留lease。准确旧固定launcher正常SIGTERM，615ms内所有归属子进程退出，两锁和lease释放，无强杀。

新维护点 `.codex/private/full-candidate-release-20261017/` 为0700，配置、SQLite、gateway、workspace/media备份、完整原入口清单、启动/回退材料为0600；不复制 auth、Keychain 或私人 Codex HOME。不得用更早停止图标维护点覆盖这次之前新产生的业务事实。停服后副本预演通过，再在原 Terminal 启动：

```sh
/bin/zsh '/Users/wolf3c/Project/homer/.codex/private/full-candidate-release-20261017/start-automatic.command'
```

它执行正常 `scripts/dev.mjs --web --config <原配置> --port 4780`，不再固定旧9ab入口。未来兼容源码仍走正常后台构建→安全空闲交接→原thread；忙碌延后，构建失败保留旧版、启动失败回前一兼容版。管理操作、上传、任务、渠道发送等原busy/授权门槛保留；不实现跨版本Worker并行。

本次跨schema维护与未来同schema自动更新分开：原9ab严格manifest不能直接接管已迁移schema，不修改它来绕过。只有确认没有任何新业务事实，正常停服并完整核对后，才能用**本次新维护点**恢复数据库/网关并执行 `start-previous-icon.command`；有新事实只能前向修复。完整步骤在维护点 `maintenance-and-rollback.txt`。没有声称跨schema在线自动降级或 docs20 正式产品更新机制已经完成。

## 维护证据

维护源码为 `scripts/database-migration-preview.ts` 及对应测试；其余本轮验证/发布工具和不含正文的回执保留 `.codex/scratch/native-capabilities-implementation/`：

- `full-candidate-release-verified-check.log`：最后完整检查。
- `full-candidate-release-build-receipt.json`、`full-candidate-daily-release-receipt.json`：已验构建与真实发布指纹。
- `full-release-browser-busy-proof.json`、`full-release-browser-update-proof.json`、`full-release-browser-rollback-proof.json`：合成完整宿主自动更新证据。
- `full-release-daily-browser-receipt.json`：日常605/1470真实浏览器布局与资源观察。
- 合成PNG仅含合成消息/素材；私人库、业务行hash及维护清单仅留private。真实手机验收与原生订阅/thread隔离仍单列，不用合成证据替代。
