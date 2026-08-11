# Frontend Slides attribution

OmniBox 的“PPT / 网页演示”工作流参考了 Frontend Slides 的以下设计思想：

- 固定 1920×1080、16:9 的演示画布；
- 先生成真实风格预览，再由用户选择视觉方向；
- 把源 PPTX 提取为内容结构后重新设计，而不是承诺像素级还原；
- 对页面密度、溢出和减少动态效果进行约束。

上游项目：https://github.com/zarazhangrui/frontend-slides

参考版本：`9906a34d640d2111f724544cbc50f7f130569ae1`

OmniBox 没有执行上游 Claude Code 插件，也没有默认调用其 Vercel 发布脚本。演示内容由 OmniBox 的结构化数据模型、本地模板和 Electron 沙箱导出。
