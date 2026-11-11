# 图片多区域批注接入

2026-10-24，共享工作树源码候选。没有提交、安装、重启或部署；已安装 Appbuild52 保持原样。验收参照 `.codex/scratch/image-annotation-header-demo-20261024/`，独立 Demo HTML 没有拷入产品。

用户从图片预览标题栏的笔形图标加“批注”进入。连续框选后，每处填写多行备注并保存，图片显示1/2/3编号；点原框可编辑、拖动原生手柄或删除。最后统一“添加到对话（N）”，生成一条图片资源引用和一份原图附件，不自动发送。原正文和普通附件保留，窄屏先关闭预览，再聚焦原 Lexical 输入框。

## 状态与生命周期

Annotorious React/Annotorious 3.9.5 的 annotation store 是唯一活动图面状态，原生矩形、选择、手柄、commenting body、ImageAnnotationPopup 定位保持。编号只是按原生矩形投影的只读标签。当前备注框只有一份文字缓冲和一个回退点；保存将原文备注及顺序写入原生 annotation，不在另一份实时 regions 数组上同步。

失选、取消、退出模式、关闭，以及统一导入前，均取消当前未保存编辑：新框删除，已有框还原该处保存前的备注和几何；其他已保存区域保持。Escape 依次取消选区、退出批注、关闭预览。普通看图不加载图片批注 chunk；首次进入只挂一个实例，退出模式继续保留实例，预览卸载前取消未保存内容、生成休眠快照并调用原生 destroy 清理监听器。原生 React 3.9.5 的包装器本身没有调用 destroy。

同一主 thread 的原预览 owner 保存 artifactId+sha256 对应的 File 身份与休眠原生快照；重开时快照移回 native store，删除休眠副本。不同文件、版本或 thread 不复用。刷新只从原 Composer 持久草稿恢复已导入引用；未导入内容仅页面内存，批量按钮 title 明确说明。没有批注数据库、长期图库或新实体。

导入生成独立引用快照，后续编辑不改该快照；再次导入替换原单引用。删除引用按原附件 owner 移除对应原图，保留普通附件和图片会话批注。重新导入沿原 adapter 产生新上传身份；重复导入和刷新后已确认附件复用原身份，不重复上传。同图引用的来源按钮可重新打开原成果。

异步导入沿原 MainComposer/上传 owner，检查预览生命周期、thread/来源代际、原请求身份与挂载状态。关闭或切图后迟到的上传可保留为已确认附件，不能插入旧引用或覆盖新正文；失败保留批注、原引用和普通草稿。未知发送仍只由原 ACK/显式重试路径使用原 payload/requestId，当前答题及旧队列草稿的限制保持。

## 图片引用合同

旧单区域结构继续原样解析，字段顺序和请求哈希不变：

```ts
{kind:'image',source,width,height,region:{x,y,width,height},comment,image:{assetId,revision}}
```

新结构与旧 region/comment 互斥：

```ts
{kind:'image',source,width,height,image:{assetId,revision},annotations:[{id,region:{x,y,width,height},comment}]}
```

source 仍是同一个已发布成果 ID、SHA-256、标题，所有区域共享原图尺寸和已确认 AttachmentRef。仍存入原 quote JSON；ConversationInput、队列、数据库及哈希算法没有新增版本或归一化迁移。旧请求不转换为 annotations，因此旧历史、草稿、已接收 payload/ACK 和重试保持；新字段实际存在才进入新 payload 哈希。

每个区域独立校验有限非负坐标、非零面积、原图边界、唯一非空 ID 和非空备注。新批次尺寸必须为正整数，最多4000万像素；每批1～20处，每备注16000字符、所有备注48000字符，沿既有预览批次限额。备注、正文、分隔文字与原授权前缀合计仍限制24000字符。超限拒绝并保留，不截断。标题、坐标、附件、来源信息不提升为用户要求。

服务端原 validateResourceReference 先由发布成果 owner 验证授权文件/标题/hash，再核对原附件 request/thread/binding/hash，通过原 MediaStore.imageSize 读取原解码器按准确 sourceHash/revision 保存的尺寸元数据核对实际像素尺寸（不再额外分配整张派生图，模型输入仍沿原 image 方法读取并验证内容完整性），整批通过才接收。每处区域由公共解析器检查，不能只检查第一处。模型收到原图的现有原生图片输入，以及全部区域 ID、编号、像素坐标和备注；用户授权只包含全部用户备注和正文。

原生3.9.5矩形编辑器有一个可复现的派生边界时序：手柄更新了 x/y/w/h 时，bounds 可能仍是前一帧。图片适配读取原生矩形字段，保存时经公开 updateAnnotation 同步派生 bounds；旋转矩形输出覆盖该原生矩形的轴向区域。恢复快照正确重建 native x/y/w/h，不把传输协议的 width/height 当成本机几何字段。没有 DOM 读坐标、库 fork 或新绘制引擎。

批注入口只提供给原上传 owner 支持的 PNG/JPEG/WEBP/GIF；没有因 Demo 合成 SVG 扩大 SVG 执行或上传权限。

## 组件和许可

CanvasSplitHeader 复用并行 HTML owner 已加入的 actions 插槽，只增加独立图片动作 hunk；HTML runtime/bridge/patch 未由本任务改写。原 Base UI Dialog、TooltipIconButton、QuoteBlock、MainComposer 和附件 adapter 继续使用。TooltipContent/TooltipIconButton 只增加可选Portal容器参数，图片传入原Dialog内的动作区；手机提示可见且能命中，其他消费者默认行为不变。主引用、历史和“查看原请求”均沿 ResourceReferenceBlock 显示所有编号/区域/备注，限高滚动保留全文。

备注表单是本地受控 textarea/Base UI Button，沿已验收 Agentation 3.1.2 深色样式，非 Agentation 原生编辑器；Enter 换行、IME、中文取消/保存、空值及 busy 防重复保持。样式来源为 `src/components/annotation-popup-css/styles.module.scss`，本机 dist 原文 SHA-256 `1a4d069438c9f218d20eab31150e5c2b1c6ef05c526135bd10dd492950023b1e`。Agentation 为 PolyForm Shield 1.0.0，Copyright (c) 2026 Benji Taylor，非 MIT；Annotorious BSD-3-Clause 完整许可沿 vendor/assistant-ui/LICENSE-annotorious，原 Vite notices 输出保留。没有引入另一个 Agentation 实例或依赖，不宣称商业许可豁免。

## 验证

本任务证据统一位于 `.codex/scratch/image-multi-annotation-product-20261024/`。合成文件、账号、主 thread、附件、备注和 fake engine 不读取真实用户数据；浏览器用独立 Chrome profile 和随机任务 HTTP 端口，不调用模型或渠道。

| 检查 | 本轮结果与证据 |
| --- | --- |
| 新合同红绿 | 前像10通过/3失败，当前13通过；red-contract.log 与聚焦合同日志。旧单图哈希逐字节兼容 |
| 聚焦引用/数学/附件/客户端/主队列 | 42项通过；final-contract-tests.log |
| 合成服务端 | 9项通过；final-service-tests-v3.log。三处 ID/备注/坐标与原生图片真实进入 fake engine，非法任一区域、伪hash/附件/scope/尺寸拒绝，已接收原payload重试不重跑；尺寸校验0次整图读取、模型输入恰好1次 |
| 产品图片真实浏览器 | 60项通过；final-browser-v5/browser-results.json，1440/390/320。包括原生鼠标/触摸手柄后逐ID精确坐标比对、历史三处备注、IME/Enter/Escape/Space、原生resize、取消/删除/重排、正文及普通附件、真正Lexical焦点、重复导入、关闭/重开、刷新只恢复导入快照、不同source/hash、迟到读取/上传、失败重试、长备注超限、未知HTTP原payload/ID重试和主thread变化原有发送栅栏。外层滚动范围0，无运行异常/外部请求 |
| 既有预览浏览器 | 31项通过；final-compat-browser/browser-results.json。原文本、图片真实HTTP发送、HTML批注入口、原请求与Sources保留；图片步骤仅按新保存/统一导入合同更新 |
| UI/服务端源码类型 | 均通过；final-ui-types.log / final-source-types.log |
| 全仓类型 | 前像12处、候选12处既有诊断，规范化根路径后完整输出相同；check-comparison.txt。不称全仓all green，也未拿旧committed137处替代当前前像 |
| 隔离生产构建/生成CSS | Vite完成；build-final-v2.log。attachment --check通过。新增可选Portal的container标识被原Tailwind扫描，原脚本同步18行作用域工具类；没有其他生成样式重写 |
| 前像浏览器 | baseline-web来自准确图片前像覆盖构建；相同新合同在只认单region的历史呈现处失败，red-browser/failure-1440.json记录异常，不把它报为通过 |

最终截图：`final-browser-v5/three-regions-1440.png`、`three-regions-390.png`、`three-regions-320.png`，以及对应 `edit-region-*.png`、`composer-*.png`。主引用保留原Composer限高区域，完整三处备注可滚动查看，未为了截图扩大输入区。Chrome 156.0.8078.48；手机为Chrome触摸/IME仿真，不代替实体iOS/WKWebView/软键盘验收。

bundle-metrics.json记录准确前像/候选：图片按需JS 131029→137127字节（gzip40941→43076），图片CSS5930→9083字节（gzip1381→2333），主JS1857886→1860641字节（gzip570732→571431）。普通对话/普通看图未请求图片chunk；最多20区域，没有轮询或新依赖。原有大chunk提示保持，不据局部证据承诺全设备性能。Demo前轮155+24与标题35项未计入本轮产品通过数。

失败记录保留：初次scratch写入受沙箱限制后按明确授权申请该目录写入；合成服务socket路径过长后缩短本任务fixture名称；CDP Enter需携带回车；图片onLoad由库接管、标题尺寸被后加载utility覆盖、原生bounds滞后以及旧snapshot误用width/height已按owner修正；手柄检查沿Demo保持300ms拖动以区别点击；合成thread测试按产品已有身份变化栅栏校正，不改栅栏迎合测试。没有删除失败断言掩盖产品问题。

可复验命令（环境路径均指本任务scratch，不得指向真实runtime）：

```sh
node --import tsx --test tests/preview-reference.test.ts tests/message-quote.test.ts tests/web-client.test.ts tests/homer-attachment-adapter.test.ts tests/recursive-main-inputs.test.ts
HOMER_SYNTHETIC_ROOT=.codex/scratch/image-multi-annotation-product-20261024 node --import tsx --test --test-name-pattern='preview|file annotations|all text remarks|image multi-region|image.*original' tests/web-service.test.ts
HISTORY_FOLLOWUP_BUILD=.codex/scratch/image-multi-annotation-product-20261024/candidate HOMER_SYNTHETIC_ROOT=.codex/scratch/image-multi-annotation-product-20261024/retest-data HOMER_REVIEW_EVIDENCE_ROOT=.codex/scratch/image-multi-annotation-product-20261024/retest-browser node --import tsx tests/image-file-annotations.browser.mjs
```

## 回退边界

`before/`保存开工时相关 dirty 文件准确前像，`index-before`只读记录 Git index。应仅反向应用本任务差异，不恢复 HEAD 或覆盖文本/HTML/滚动/Worker 卡片等共享修改。新图片 annotations 已写入草稿或历史后，必须保留兼容解析器，不能直接回退到只认 region/comment 的版本。
