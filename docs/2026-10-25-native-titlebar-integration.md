# macOS 原生标题栏同行接入

2026-10-25。本报告记录原生标题栏实施阶段：当时已按用户批准方案实施维护源码，尚未 commit、安装或发布。已安装 build66 的 manifest 只读核实为 `gitSha=12aeb6b188791b820426e30900ac49ca695d09af`，未采用本项。实施交付时维护 HEAD 为 `cce82fe16f4c087506c8474b53a724d32415220d`，不能把维护源码、合成窗口和安装版混称。后续审查、定向补验与准确提交另见 `docs/2026-10-25-native-titlebar-review-commit.md`。

## 变更与原生归属

- `packaging/electron/main.mjs`：仅macOS构造配置hiddenInset、WCO、trafficLightPosition；一个本窗口resize处理读取contentBounds，位置不同才调用setWindowButtonPosition。原1080×780／min380×420、title、菜单、导航／下载／权限／sandbox、关闭隐藏、activate和退出确认／停止协议保持。
- `ui/homer-app.tsx`：一个启动WCO能力标记；首次geometrychange若需要则识别后移除监听，卸载也清理；全屏不会撤掉能力标记。原Group两个Panel仅native改为左min240px、右min25%/max75%，无宽度observer或第二布局owner。
- `ui/homer-styles.css`、`ui/canvas-panel.css`：native限定的原顶栏drag／WCO避让和控件no-drag，窄窗同一Dialog避让，左栏小于320px隐藏整品牌。原44/52行、44全局目标、18图标、原字体及业务owner保持。
- 定向窗口回归扩展与 `tests/native-titlebar.browser.mjs`；设计规范和桌面说明补充。vendor和依赖未改，因此没有新增vendor来源声明。

全屏WCO归零时CSS自动释放避让8px，退出恢复88px。全屏标志不参与Reader或Portal key。没有自绘窗口按钮、frame:false、preload、可执行系统控制桥、新依赖、业务实体或持久状态。

## 实际发现并修正的原生问题

长标签横滚后，Electron45把离屏Tab／关闭子项的no-drag矩形算到左侧header，真实HID事件进入DOM而窗口不移动。自带 `ELECTRON_DEBUG_DRAGGABLE_REGIONS=1` 诊断与准确程序bounds证明：横滚归零后拖动恢复；仅加paint containment无效；让可见rail承担no-drag、内部元素恢复app-region初始值后恢复。最终纯CSS修复使用较明确的选择器，不增加轮询、横滚监听或pointermove IPC。Tab／关闭仍处于可见rail的原生no-drag矩形内。

最终非诊断产品构建、长rail已横滚状态下，真实HID拖header使外窗y70→121，尺寸1440×780不变。分隔线HID拖动使左栏1079.25→780.5859375，外窗bounds不变。双击空白遵循当前 `AppleActionOnDoubleClick=Maximize`，1440×780→1470×923，再次双击恢复原bounds。没有修改用户系统偏好；Minimize／None偏好未切换测试。

## 构建与输入身份

所有临时输入、准确前像、构建、profile、PNG、bounds、日志与任务补丁均在 `.codex/scratch/native-titlebar-integration-20261025/`。隔离UI构建显式绑定本次隔离生成的HTML批注runtime，不写 `dist`、包锁或安装目录；只读复用现有node_modules。正常维护构建仍按现有桌面流程另行授权。

合成产品运行复用既有Electron45可执行文件。测试入口逐字采用当前main的createWindow、菜单／导航／关闭和before-quit处理，以及原stdout／close协议处理；仅用测试bootstrap替代打包／codesign／profile引导，连接当前真实产品renderer、真实HTTP router及非执行fake engine。不是重新跑旧样机，也不是完整签名发行包验收。完整生产入口另由VM OS fixture核对；不把bootstrap替代称为已安装应用启动通过。

`candidate-input-identity.json`、`baseline-input-identity.json`记录准确原生来源hash、处理器hash、协议hash与profile；`source-identities.json`记录最终源码和构建身份。`identity-before.json`保存入场HEAD、index、833项tracked文件hash及相关前像。共享树已有大量dirty，期间另有输入栏清理改动；本任务不撤销。交付task-only补丁只含本项hunk，保留无关改动及index，详情 `preservation.json`。补丁为审阅／精确撤回来源，不授权自动覆盖共享树。

只读核实安装manifest为build66、Electron45.0.0，manifest SHA256为 `f1263d8babdacdf6db3948745adddd838843246442af77a6e2e0732a0ec985c3`。没有启动、重启、替换安装版或触及真实账号／模型／渠道。

## 实测几何

Electron45.0.0／Chromium156.0.8078.48／进程内Node24.22.0，macOS27.0 arm64；测试脚本Node22.22.0。实际版本、屏幕和DPR见runtime文件。外窗／内容用BrowserWindow bounds，网页用DOM rect；N=content.y−bounds.y。PNG存在工具缩放，不能用PNG像素直接推CSSpx。

| 同外窗条件 | 默认N | 默认网页顶栏 | 默认正文上沿 | 合并N | 合并正文上沿 | 净增 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1440×780、1080×780、801×780 | 32 | 44 | 76 | 0 | 44 | 32 CSSpx |
| 800×780、799×780 | 32 | 52 | 84 | 0 | 52 | 32 CSSpx |
| 380×420 | 32 | 52 | 84 | 0 | 52 | 32 CSSpx |

前像原生PNG：`baseline-native-1440.png`、`baseline-native-380x420.png`；最终源码原生PNG：`candidate-native-final-1440.png`、`candidate-native-final-380x420.png`。`*-renderer-*.png`和全屏renderer截图不含系统按钮，不能替代原生证据。前后bounds在results和manual-events中。

## 验收表

| 项目 | 本次观察结果与边界 |
| --- | --- |
| UI类型与隔离构建 | 当前UI tsc无诊断；隔离runtime和Vite构建成功。仅原有大chunk提示，没有安装依赖或改生成样式 |
| 主入口定向窗口合同 | 11项通过，含原有8项退出／安全合同和新增macOS几何／Win Linux打包守卫；新窗口断言先在旧main失败后通过 |
| 原生产品尺寸 | 1440/1080/801/800/799/380及420低窗通过；header/bar44/52、page overflow/outerRange0 |
| 原生左右下限 | 801左240px，1440左约359.75px；右原25%／最多75%，44px全局操作保留；Web原两个25% |
| 状态与无预览 | 实际1440无预览workspace阈值产生原320px摘要，单owner；Web用例还核2560预览下原阈值，不新增轮询 |
| Drag/no-drag | 最终源码真实HID header及Separator通过；长rail问题修正。rail/Tab/关闭/actions计算区域和实际Tab关闭通过；全局三个按钮逐个HID点击、rail悬停tooltip仍未全部手测 |
| 红／黄／绿系统按钮 | 真实红键只隐藏且进程保留；黄键minimized=true/visible=false，restore恢复；绿键触发真实全屏，WCO归零，原生API退出恢复 |
| 双击系统偏好 | 当前Maximize真实HID放大／还原通过；未更改或测试Minimize／None |
| Cmd-W／activate／退出 | 实际原菜单调用隐藏、activate恢复同窗；退出取消保留进程；确认沿原menu→quit→真实合成stdio stopped与exit0正常结束。不是产品账号后台停止验收 |
| unknown／超时 | 原完整main的VM合成协议验证ACK但无exit0、exit1或无ACK、超时均不成功退出，重复quit不重复发送；没有清真实锁。未另外重跑真实账号或完整打包后端 |
| Ctrl+Cmd+F | 准确前像与最终源码原菜单下均不动作；原菜单无togglefullscreen，本次保留菜单，不把它列为通过。绿色按钮全屏可用 |
| HTML稳定性与安全 | 真产品opaque iframe默认空sandbox；明确点批注才执行一次；801/800/799/380/1440保持iframe/Tab/actions/Composer身份；切文件销毁旧上下文；无额外消息／模型调用 |
| 图片稳定性与草稿 | 真Annotorious、临时编辑器与文字在801/800/799/380/1080及真实全屏往返保持；IME候选Enter不提交，明确Enter写原主草稿，切文件销毁旧图片／编辑器 |
| Web／窄屏交互 | 原compact-header18组检查通过：1440/390/320、长标签、状态、rail、回焦、modal隔离、滚动锚、Composer留底、同HTML实例、粗指针52/44及DPR2等效缩放。均无native留白、零模型／消息提交 |
| 批注Enter／IME | 现有共享表单与文本／图片三屏15组检查通过：保存／编辑／Shift+Enter／合成composition／229／错误保留与主草稿。不冒称真人中文输入法候选已验 |
| 系统名称 | AXWindow“荷马”、AXWebArea“Homer · 荷马”及系统窗口列表标题保留；未完整运行VoiceOver |
| 仍待人工／其他平台 | 全屏悬停系统栏是否盖正文、全局三个入口逐一HID／railtooltip、真实IME候选与VoiceOver、其他系统偏好、多屏、真实端侧200%未完全实测。Windows/Linux仅静态守卫，不声称运行支持 |

首次扩展图片测试在close()后立即读visible而失败；已改为在触发前订阅真实hide事件，最终通过，产品生命周期未改。失败证据保留。早期误启动不相关桌面包装测试时，缺少所需engine模块环境及硬编码scratch受沙箱限制，未计通过，也未为此改旧测试／扩大产物目录。验收仅采用上表明确结果，不沿用旧样机52项检查、旧fixture总数或全仓基线。

## 重跑与回退

先用现有依赖将准确UI和HTML runtime隔离构建到任务scratch；本次配置与日志保留。针对本次构建：

```sh
node --experimental-vm-modules --test tests/electron-shell.test.mjs
node node_modules/typescript/bin/tsc --noEmit -p ui/tsconfig.json
HOMER_TITLEBAR_BUILD="$PWD/.codex/scratch/native-titlebar-integration-20261025/candidate/web" \
  node --import tsx tests/native-titlebar.browser.mjs
```

测试原生入口默认复用本项目已有Electron／Playwright隔离依赖，可通过HOMER_ELECTRON_EXECUTABLE／HOMER_PLAYWRIGHT_ROOT指定另一个已核同版本依赖。不自动安装，不使用真实profile。

回退仅撤本项macOS构造选项／resize、WCO能力标记／Panel约束、native限定CSS和说明。数据无迁移。使用task-only patch逐hunk审阅，避免恢复整文件覆盖并行输入栏清理；恢复默认标题栏即回到N32的双行布局。本项尚未安装，无需生产回退。

原生API与区域语义依据固定 [Electron45 BaseWindow](https://raw.githubusercontent.com/electron/electron/v45.0.0/docs/api/base-window.md)、[自定义窗口交互](https://raw.githubusercontent.com/electron/electron/v45.0.0/docs/tutorial/custom-window-interactions.md)和 [macOS原生实现](https://raw.githubusercontent.com/electron/electron/v45.0.0/shell/browser/native_window_mac.mm)，并由本次实际运行核验。resizable 4.14.8的像素／百分比约束直接核本地固定声明，不改库。
