# Homer Leaf Directive 规范

Homer 借用 [Markdown 叶指令](https://github.com/remarkjs/remark-directive#syntax)的写法，在模型输入中表达宿主提供的事实。

- 每条指令独占一行，格式为 `::name{key=value key=value}`。宿主按定义顺序输出属性，值使用已校验的无空白标识符。
- 输入指令由宿主加在 `InputText` 开头，指令与用户原文之间空一行。前端按宿主提供的结构化字段渲染，用户原文里的同形文本按正文显示。
- 新增指令时，在本页登记名称、使用位置、字段、语义和使用方。

## message-source

用于来源已核实的外部用户消息。必填属性 `source` 是渠道标识。实际入口由宿主绑定的当前请求确定。

```text
::message-source{source=telegram}

这个事项后续的消息和附件都发到这里。
```

指令只描述同一个 `InputText` 里的用户原文。历史指令随原消息解释。主 Agent 可据此理解当前消息里的「这里」，实际入口和授权由宿主与渠道插件根据本轮请求记录核验。

[多渠道接入架构](multi-channel-architecture.md#消息来源)使用本指令，并定义渠道字段的取值和前端标签。[消息来源 Demo](../../examples/message-source.html)可直接在浏览器打开，用模拟请求并排展示界面标签与完整模型输入。
