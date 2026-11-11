# FileList 文件列表组件

日期：2026-10-22。源码：`ui/file-list.tsx`；样式使用组件内工具类及既有 vendor 资源，不存在独立的 `ui/file-list.css`。

组件用于在不同业务位置展示相同的紧凑文件列表。本次在隔离的真实 Homer 前端候选中，由主对话成果和原答复弹窗共同复用。

## 组件职责

- 按调用方提供的顺序显示文件，每项只显示类型图标和完整文件名。
- 用原生按钮提供整行点击、Enter/Space 激活和清楚的键盘焦点。
- 空数组不渲染列表和占位；单文件、多文件使用同一个结构。
- 长名称自然换行，窄屏点击区域至少 44px。
- 由文件名后缀提供图标和屏幕阅读器类型说明。后缀不决定资源 MIME 或是否能执行。

组件不获取文件、不缓存正文、不判断权限、版本或任务状态，不创建 Canvas，也不附加下载、管理、分享或业务备注。调用方持有这些业务职责。

## 输入与回调

```ts
type FileListItem = {id: string; title: string};

type FileListProps<T extends FileListItem> = {
  files: readonly T[];
  label: string;
  onOpen: (file: T, trigger: HTMLButtonElement) => void;
  selectedId?: string;
  controlsId?: string;
};
```

| 属性 | 合同 |
| --- | --- |
| `files` | 调用方已经组织好的文件集合。`id` 是稳定身份，必须在当前列表中唯一；`title` 是完整可读文件名。组件不排序、去重或按同名合并 |
| `label` | 列表的可访问名称，不额外产生可见标题行 |
| `onOpen` | 返回原始泛型文件对象及真实触发按钮，供调用方打开预览、维护来源和恢复焦点 |
| `selectedId` | 调用方控制的当前选中文件，组件没有第二份选择状态 |
| `controlsId` | 可选，被打开区域的 DOM ID；提供后才输出对应的 aria-controls / aria-expanded |

同名但不同 ID 可以同时出现。业务层应在打开及原答复定位时使用 ID，不能回头用文件名查找资源。

## 使用示例

```tsx
import {FileList} from './file-list';

<FileList
  files={authorizedFiles}
  label="本条答复的成果文件"
  controlsId="canvas-panel"
  selectedId={canvasOpen ? canvasArtifact?.id : undefined}
  onOpen={(file, trigger) => openArtifact(file, trigger)}
/>
```

`authorizedFiles` 可以保留业务字段，例如 result、原消息或工作信息；泛型回调不会丢失这些字段。另一个业务位置只需传入自己的文件集合与打开行为，不依赖 Homer 的 ArtifactsContext。

## 样式与复用约束

使用产品现有 `--line`、`--surface`、`--ink`、`--muted`、`--soft`、`--soft-hover`、`--focus` 主题变量，不安装 UI 或图标依赖。样式限定在组件类名内，不修改其他列表、正文或附件。

当前使用 `min-h-11` 保持至少 44px 点击高度，长名允许自然增高。不能为固定行高加省略截断或限制行数。图标为内联 React SVG，不把外部 SVG/文件名当 HTML 执行。

列表只提供呈现和打开通知。具体的读取中、失败重试、HTML 隔离、文件切换、授权和资源回收由预览宿主负责；不能把这些业务分支逐步塞回组件。

## 验证入口

`tests/artifact-file-list.browser.mjs` 使用真实前端、合成发布/文件合同及独立 Chrome，覆盖主对话和原答复两处实际复用、空/单/多文件、长名、类型可访问说明、多尺寸、打开与返回。运行需要显式指定现有构建和 fixture 路径，见[浏览器专项](testing.md#合成浏览器回归)。只读组件契约核对不等于本轮重新完成浏览器验收，不把 Demo 通过当成产品验证。
