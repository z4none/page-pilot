# Page Pilot

[English](README.md)

Page Pilot 是一个开源 Chrome 扩展：在网页右键选择“总结页面”后，它会提取页面主体，将标题、URL 与正文作为文本附件发送给浏览器侧栏中的 AI 网页。

> **无需 API Key**：不需要模型 API 账号、密钥或 API 计费配置，直接复用你已经登录的 Kimi、DeepSeek 或 Gemini 网页会话。

## 功能

- 右键菜单总结当前页面。
- 使用 Readability 提取正文，并将标题、URL、正文作为文本附件发送。
- 在侧栏内使用 Kimi、DeepSeek 或 Gemini，并复用各 Provider 的当前会话。
- 工具栏可查看实际提取出的附件内容。
- 默认生成简短总结：3-5 个要点、1-3 个追问，不复述原文。
- 根据 Chrome UI 语言自动本地化：默认英语，支持简体中文、日语、韩语；其他语言回退英语。
- Web Components 导致 HTML 转 Markdown 丢失内容时，自动回退到语义主内容容器的可见文本。

## 使用

1. 在侧栏设置中选择 AI Provider，并在对应网页完成登录。
2. 打开网页并等待内容加载。
3. 在页面空白处右键，选择“总结页面”。
4. 扩展会准备附件和默认提示词，并发送到当前 Provider。

## 开发

```bash
npm install
npm run build
npm run check
```

在 `chrome://extensions` 开启开发者模式，加载 `dist` 目录。修改源码后执行 `npm run build` 并重新加载扩展。

## 安全与隐私

项目不使用开发者自建的模型代理或后端。但“无需 API”不代表正文不会离开浏览器：触发总结后，标题、URL 和正文会发送给你选择的 AI Provider，并受其账号与隐私政策约束。

- 登录在 Provider 网页自身完成；扩展不要求账号密码或 API Key。
- 待发送页面内容保存在 `chrome.storage.session`；Provider 选择和自定义提示词保存在 Chrome 同步存储中。
- 仅在用户通过右键菜单触发总结后读取并发送页面内容；可先通过“查看提取内容”检查附件。
- `activeTab`、`scripting` 和 `<all_urls>` 用于提取用户主动总结的当前网页；Provider 内容脚本只匹配 Kimi、DeepSeek 与 Gemini 域名。
- 为在侧栏嵌入 DeepSeek/Gemini，扩展仅对这两个域名移除防嵌入响应头。这是安全敏感的兼容措施，请审计源码并在接受此取舍后使用开发版。
- Provider 网页改版、登录限制、内容策略与反自动化机制都可能影响兼容性；扩展不会绕过访问控制或付费限制。
