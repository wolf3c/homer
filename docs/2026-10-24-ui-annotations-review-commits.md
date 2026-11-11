# 五项 UI 工作统一审查与分别提交 · 2026-10-24

五项已授权产品工作及必要前置、测试和许可源码均已入库，共63个不同路径。工作在原共享main衔接，不切换工作树、不建立分支；未push/tag/部署/安装/重启，未访问真实账号、模型、生产数据或渠道。起始HEAD为`5afa91483870fd69fb281bc1bd5c2e24470dd3ba`。各功能原说明中的“未提交”记录其原实现交付阶段；本页记录随后统一审查与提交状态，不代表安装版采用。

## 提交身份与边界

|功能|完整commit|完整tree|改动路径数|
|---|---|---|---|
|Worker 事件卡|`094121b5de3a781b085f47cf6947300ef1d0c1cf`|`f346b345f5d63fb6980f06878174577a4cf1c49a`|6|
|主滚动空白|`fcb87df64aa0d8cb25bb9859b1e2e0c8df39afcb`|`d278c97687e73ba8949e202f6e7ea4458c17af56`|3|
|文本文件多批注（含选区/中文前置）|`9609d258c4fd0ab59fb6be20d91f988d9587d687`|`1c176eaa6714932e7fcadecde329b4aab29a7cbe`|19|
|HTML 静态优先与原生批注|`683aec4486e172e3ddcfb1d5a534ad88872bde1f`|`905f7bed37dc8f5c6b9897f0ffa4434a0e667c28`|37|
|图片多区域批注|`53c53e8b51803e6e161957c15a91816e5ba6db30`|`3434977ce3306aeb7ef504a14dd86f0b8546112d`|20|

精确路径白名单、每个文件SHA-256、父提交、task patch哈希、构建产物和测试证据哈希保存在[维护清单](patches/2026-10-24-ui-annotations-review-commits.json)。五组按准确补丁前像在专属scratch导出候选，C含此前选区工具条/中文化前置，D含正式发布测试fixture/test；不以混合dirty树充当提交证据。只在完全相同后像时复用并行任务的重复HTML HTTP测试hunk。共享DESIGN与vendor README按功能段落选取，service只纳来源校验，未吞入独立待答业务。

每个提交前用临时index核对精确diff白名单、完整tree和实际测试候选，保留原index其他条目；commit-tree生成提交、带旧HEAD保护的update-ref正常衔接main；index加锁只同步该组已提交路径。每次提交后的实际SHA/tree/diff均复核。原始index字节/条目、工作文件哈希、准确patch和运行日志保留在`.codex/scratch/ui-annotations-review-commit-20261024/`。

## 审查结论

本轮未发现新增的P0/P1/P2产品缺陷，没有额外产品源码修正。审查确认以下已实施修复和合同：

- `ui/process-nodes.tsx:75`排除workerEvent过程条目，`:86`同一父层/key只渲染一份原TaskCard。Working/Worked切换保留正文展开与焦点，真实工具记录仍显示，正式回答次序保持。
- `ui/homer-styles.css:3`只为thread-viewport新增position:relative，修复官方绝对定位读屏status的外层溢出；不删读屏、不新增overflow隐藏、不改阅读锚点。
- `src/preview-reference.ts:25`、`src/service.ts:695`和`src/user-intent.ts:10`核对text/image新旧结构互斥、逐条excerpt/rect、原图实际解码尺寸、来源hash及附件scope；只有用户备注/正文进入原24000授权预算，超限拒绝不截断，旧hash/草稿/历史与ACK重试保持。
- `ui/canvas-panel.tsx:93`、`:104`、`:147`及`ui/annotation-frame.tsx:17`保留静态默认与opaque/禁网；明确点击授权当前文档代际脚本，connected不代替active。native Exit/快捷键、超时、关闭/源码/文件切换清理运行iframe与token；未保存、已保存及已导入snapshot生命周期独立，按thread/artifactId/hash隔离。
- `ui/preview-selection-toolbar.tsx:16`、`ui/image-annotation.tsx:63`与`:70`保持选区订阅叶组件、Annotorious唯一活动store与公开原生rectangle/handles/popup；休眠snapshot移交，卸载destroy；迟到上传/新草稿受generation与requestId保护，普通附件、焦点与原payload未知回执不丢失。
- `ui/vendor/assistant-ui/attachment-tooltip.tsx:33`的可选container沿原Portal转发，省略时默认行为保持。`scripts/patch-preview-agentation.mjs:17`逐个核验3.1.2固定输入、精确补丁输出、类型镜像和完整license；正常build强制验证。Agentation为PolyForm Shield 1.0.0，非MIT，原件/patch/notices完整；本地源码提交不推断公开分发授权。

## 准确候选验证

每组服务源码类型、UI类型/正常生产构建和attachment CSS --check均通过。相关quote/canvas-split生成CSS另只读check通过。全部合成服务用随机端口、任务专属DB/目录、独立Chrome profile与拒绝真实执行的fake engine；图像服务测试实际使用本机ffmpeg合成图像解码。未将无decoder提前return当作图像验证。

|候选|聚焦合同/服务测试|真实Chrome156验收|
|---|---|---|
|A|22界面测试|1440/390/320三屏19项，卡片移除次数0、身份/父节点/焦点保持|
|B|单声明准确diff与正常构建|8场景全部通过，外层滚动range均0，覆盖长短会话、运行/队列、窄屏、短窗和高DPI|
|C|38引用/兼容合同，7服务|文本43、选区45、公式/错误公式/fence34项，覆盖未保存/保存/导入snapshot、限制、主草稿和未知回执|
|D|4补丁/正式HTML发布/HTTP，1服务|HTML54、生命周期19、宽屏/summary/preview拖动布局4、原版默认/补丁兼容13项|
|E|41引用/adapter/旧hash合同，9服务|图片60、原预览31项，覆盖三屏原生手柄、增删编辑/编号、一次原图+全部notes、迟到上传和身份隔离|

最终合并E树再次通过Worker19、滚动8、文本43、HTML54、生命周期19、宽屏布局4，通用Canvas102项（首次运行CDP iframe会话消失，未改断言/产品源码，使用全新隔离Chrome重跑通过；首次失败日志和截图完整保留，具体触发未独立复现）。没有把失败运行计为通过。主路径和响应式截图已实看，Chrome触摸/IME模拟不等同实体手机或系统软键盘。

准确D树两次正常构建逐字节相同，共72文件；原任务混合源码报告的73文件未作为本轮提交证据。普通聊天/静态HTML不请求批注runtime，普通看图不加载annotator，由真实请求记录断言；没有新增全局持续observer/轮询/DB实体，唯一新增MutationObserver限定运行文档、插入后或10秒断开。未实测全设备性能，未承诺普遍速度提升。

|准确候选|主JS原始bytes|gzip6 bytes|
|---|---:|---:|
|base|2499757|803300|
|A-worker|2499638|803263|
|B-scroll|2499638|803262|
|C-text|2514771|808208|
|D-html|2517702|808882|
|E-image|2520503|809665|

体积是本次准确源码、固定已安装依赖的实际构建测量，gzip为level6。独立Mermaid懒载改动不在本轮范围，因此不拿旧混合树较小的主包作本轮成果。image/runtime/css的逐产物raw/gzip/hash见维护清单。

## 已有失败与保留内容

committed HEAD与五个准确候选的全仓类型检查均为137条诊断；消除导出目录位置和行列变化后，诊断多重集完全一致，无新增或消失。全仓检查仍未通过，未重新运行全仓测试；主UI/服务源码类型独立通过。原任务的Worker查询1项失败、backend mock5项失败、quote44旧断言与假DOM useMediaQuery失败不计入本轮通过数，未修无关测试。

正常构建在基线和每个候选都会将已有TaskStatus components.css从51402 bytes重生为50702 bytes，生成hash一致为`aa8415197c2ef3528f51c4ea87d94962d0759b0d43b82df84b73859ca740d871`。它不是本轮变更，未提交；完整候选tree核对只允许这个与基线生成结果完全相同的既有生成例外，其余tracked source全部逐字节匹配。

原737个tracked文件工作区字节与新入库来源文件均保持，非本轮index条目逐字节相同；开工及功能提交后暂存diff均为空。功能提交后仍留99个tracked dirty路径与325个untracked顶层条目（含原有.cindy-worktrees等），并非本轮漏交。共享文件剩余hunk为`src/service.ts`独立待答事实4行、`tests/web-service.test.ts`独立待答断言2行、`ui/DESIGN.md`其他设计工作，以及vendor README原有空行；`ui/markdown-code.tsx`独立Mermaid懒载和品牌/记忆/能力/渠道/历史资料保持。所有五项本轮来源hunk已纳入准确提交。

构建、日志、截图、候选导出和原index备份不入Git；可长期复核的产品/测试/固定vendor源码与本页验证清单已tracked。没有实际模型或账号验收，也没有安装或发布。
