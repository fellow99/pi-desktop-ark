# 真机基本功能验证 —— 2026-10-17（设 Key / 建工作区 / 一次对话）

- **设备**：HAD-W24 / `7.0.0.107(SP7C00E100R13P5)` / API 26 / OpenHarmony-7.0.0.105（`const.product.model` 报 `HAD-W32`，软件版本串报 `HAD-W24 …`）
- **应用**：`org.fellow99.pi.PiDesktopArk` v0.1.0，进程内 Node v24.2.0（pid 46164，全程未重启）
- **服务**：`<base>/payload/pi-web.ready.json` 里的真实端口（本文件一律写作 `<port>`，不硬编码）
- **沙箱别名（重要）**：`hdc shell` 看到的是 `/data/app/el2/100/base/org.fellow99.pi.PiDesktopArk/haps/entry/files`，
  而**应用自己只认** `/data/storage/el2/base/haps/entry/files`。所有 API 的 cwd 参数必须用后者（见 §5 发现 ②）。
- **结论**：设 Key / 建工作区 / 一次真实对话 **三项现在全部通过**。
  首轮那把 Key 被 DeepSeek 判为无效（401，现场见 §4，作为历史记录保留）；随后换成有效 Key 复测，
  拿到真实流式回答：`stopReason=stop`、256 个 `text_delta`、`Cpp Crash`=0（见 **§4.1**）。

---

## 1. 步骤 1：设置 DeepSeek Key

命令（Key 只在运行期以环境变量传入，不落任何文件）：

```bash
PORT=$(hdc shell "cat <base>/payload/pi-web.ready.json" | grep -o '"port": *[0-9]*' | grep -o '[0-9]*')
hdc fport tcp:$PORT tcp:$PORT                     # 已存在则报 listen failed，可忽略
# 前态
hdc shell "stat -c 'size=%s mtime=%y' <base>/pi-agent/auth.json"
curl -s -X POST "http://127.0.0.1:<port>/api/auth/api-key/deepseek" \
     -H 'Content-Type: application/json' --data-binary '{"apiKey":"<密钥>"}'
# 后态与校验
hdc shell "stat -c 'size=%s mtime=%y' <base>/pi-agent/auth.json"
curl -s "http://127.0.0.1:<port>/api/auth/providers"
curl -s "http://127.0.0.1:<port>/api/models?cwd=/data/storage/el2/base/haps/entry/files/workspace"
```

观测（原样，已去密）：

| 项 | 结果 |
| --- | --- |
| `POST /api/auth/api-key/deepseek` | **HTTP 200**，`{"success":true}` |
| `auth.json` 前态 | `size=95 mtime=2026-10-17 12:01:17.825794687 +0800` |
| `auth.json` 后态 | `size=95 mtime=2026-10-17 14:19:27.386687500 +0800` |
| `GET /api/auth/providers` | `{"id":"deepseek","displayName":"DeepSeek","configured":true,"source":"stored","modelCount":2,"supportsOAuth":false}`（其余 38 个 provider 全 `configured:false`） |
| `GET /api/models?cwd=…` | **HTTP 200**，2 条：`deepseek:deepseek-flash`、`deepseek:deepseek-v4-pro` |

**怎么知道是"替换"而不是"新加"**：写入前后 `auth.json` 的 **mtime 从 12:01:17.826 跳到 14:19:27.387**
（size 不变是因为新旧 Key 都是同格式 35 字符——我**没有**读取过文件内容，`hdc shell` 对该文件是 EACCES，
只有应用进程有权读）。另外 §4 里 provider 回显的 4 位尾号与本轮新 Key 一致，
说明**存进去并发出 HTTP 的确实是本轮这把新 Key**，旧 Key 已被覆盖。

> `auth.json` 是唯一持久化位置，全程未被写入仓库内任何文件（Key 仅以 `sk-e32f…a17f` 这种缩写形式出现在文档里）。

**截图取舍**：`01-set-key.jpeg` 拍的是 **设置 › 提供商**（不是"模型"页）。理由：`ModelsConfig.tsx:1646`
的 Key 输入框是 `SecretTextInput`（`type="password"`，`components/ModelsConfig.tsx:221-245`），且其 state 初值是
空串（`ModelsConfig.tsx:1564`，从不回填已存 Key），未配置时才渲染输入区；"模型"页只列模型开关（首个是
OpenCode Free，DeepSeek 需滚动）。**因此我选了能直接证明"已连接"且根本不含 Key 字段的"提供商"页**。
截图前用 `uitest dumpLayout` 检查过：整棵可及树里「Key 前缀串」/ `password` / `apiKey` / `Authorization` 均为 0 命中。

## 2. 步骤 2：在 `<base>/workspace` 里建测试工作区

```bash
M=/data/storage/el2/base/haps/entry/files
curl -s -X POST "http://127.0.0.1:<port>/api/cwd/browse" -H 'Content-Type: application/json' \
     --data-binary '{"path":"'$M'/workspace","name":"pitest-20261017"}'
curl -s -X POST "http://127.0.0.1:<port>/api/cwd/validate" -H 'Content-Type: application/json' \
     --data-binary '{"cwd":"'$M'/workspace/pitest-20261017"}'
curl -s -X POST "http://127.0.0.1:<port>/api/files$M/workspace/pitest-20261017?type=upload" \
     -F "files=@hello.txt;filename=hello.txt"
curl -s "http://127.0.0.1:<port>/api/files$M/workspace/pitest-20261017/hello.txt?type=read"
curl -s "http://127.0.0.1:<port>/api/files$M/workspace/pitest-20261017?type=list"
```

观测：

| 接口 | 结果 |
| --- | --- |
| `POST /api/cwd/browse` | **200** `{"success":true,"path":"/data/storage/el2/base/haps/entry/files/workspace/pitest-20261017"}` |
| `POST /api/cwd/validate` | **200** `{"success":true,"cwd":"…/workspace/pitest-20261017","projectRoot":"…/workspace/pitest-20261017","projectKey":"…/workspace/pitest-20261017"}` |
| `POST /api/files/…?type=upload` | **200** `{"uploaded":["hello.txt"],"skipped":[],"errors":[]}`（27 B） |
| `GET …?type=read` | **200** `{"content":"hello from pitest-20261017\n","nextOffset":27,"truncated":false,"language":"text","size":27}` |
| `GET …?type=list` | **200** `{"entries":[{"name":"hello.txt","isDir":false,…}],"path":"…/workspace/pitest-20261017"}` |
| 旁证 shell | `hdc shell "ls -la <base>/workspace/pitest-20261017"` → `-rw-rw-rw- 27 hello.txt`，`cat` 内容一致 |
| **运行期可见** | `GET /api/sessions` → 会话 `01a14889-…` 的 `cwd = /data/storage/el2/base/haps/entry/files/workspace/pitest-20261017` |
| 旁证 `browse` | `GET /api/cwd/browse?path=…/workspace` → `directories:[{"name":"pitest-20261017"},{"name":"probe-dir"}]` |

## 3. 步骤 3：一次对话「介绍一下你自己」

```bash
# 建会话（toolNames 必须被接受）
curl -s -X POST "http://127.0.0.1:<port>/api/agent/new" -H 'Content-Type: application/json' \
  --data-binary '{"cwd":"…/workspace/pitest-20261017","type":"ensure_session","toolNames":["read","write"]}'
# 开 SSE（后台）
curl -sN "http://127.0.0.1:<port>/api/agent/<id>/events" > sse.txt &
# 发 prompt（用 JSON \u 转义，纯 ASCII 线上字节，避免 shell 编码干扰）
curl -s -X POST "http://127.0.0.1:<port>/api/agent/<id>" -H 'Content-Type: application/json' \
  --data-binary '{"type":"prompt","message":"\u4ecb\u7ecd\u4e00\u4e0b\u4f60\u81ea\u5df1"}'
```

观测：

| 项 | 结果 |
| --- | --- |
| `POST /api/agent/new` | **200** `{"success":true,"sessionId":"01a14889-a743-71d8-9206-82058ee372c4","data":null,"model":{"provider":"deepseek","modelId":"deepseek-v4-pro"},"thinkingLevel":"high"}` ⇒ `toolNames:["read","write"]` 通过 |
| `POST /api/agent/<id>` prompt | **200** `{"success":true,"data":null}` |
| SSE 事件总数 | **9** 条 `data:` 事件 |
| 事件类型分布 | `connected`1、`agent_start`1、`message_start`2、`message_end`2、`agent_end`1、`agent_settled`1、`prompt_done`1 |
| `text_delta` 数 | **0**（没有任何流式增量——因为下一行就是失败） |
| 用户消息回环 | `message_end` → `{"role":"user","content":[{"type":"text","text":"介绍一下你自己"}]}` ✅ UTF-8 无损 |
| 助手消息 | `content: []`、`stopReason: "error"`、`usage` 全 0（`input/output/cacheRead/cacheWrite/totalTokens` 均 0）、`api: openai-completions`、`model: deepseek-v4-pro`、`durationMs: 321` |
| 助手回答前 300 字 | **不存在**（`content` 为空数组，无任何 token 产出） |
| 崩溃 | `hdc shell "hilog -x \| grep -ac 'Cpp Crash'"` → **0**（`Cpp Crash` = 0） |
| 进程存活 | pid 46164 + `:gpu` / `:render` 全程存活，`GET /api/web-auth` 仍 200 |

### 4. 本轮唯一的阻塞：这把 Key 被 DeepSeek 判无效（401）

应用侧（SSE 里 `message_end.message.errorMessage`，provider 自己的 4 位掩码已遮蔽）：

```
401: {"message":"Authentication Fails, Your api key: ****<4-char tail withheld> is invalid
      (request_id: 0784478b-73db-4bda-8f72-29f83fa26924)","type":"authentication_error",
      "param":null,"code":"invalid_request_error"}
```

为排除"应用把 Key 弄坏了"，我在**开发机**上用同一字符串直连 DeepSeek（运行期内存变量，不落盘）：

```bash
curl -sS -w '\nHTTP=%{http_code}\n' https://api.deepseek.com/models  -H "Authorization: Bearer <密钥>"
curl -sS -w '\nHTTP=%{http_code}\n' https://api.deepseek.com/v1/models -H "Authorization: Bearer <密钥>"
# 两次都是 HTTP=401，同样 "****<4-char tail withheld> is invalid"；Key 形状校验：len=35、前缀 3 字符、后 32 位全小写 hex
```

⇒ **Key 本身无效（吊销/未激活/抄错），不是应用、不是网络、不是存储**。
旁证：**换 Key 之前**（12:01 存的那把）在同一台机器上跑出过真实回答——UI 里 14:18/14:19 两条
`Build · DeepSeek V4.1 Flash · 8 秒 / 20 秒` 的完整回复。也就是说通道本身是通的，本轮失败只因这把新 Key。

**未做的事**（不编造替代）：没有换供应商、没有换模型、没有伪造回答、没有把旧 Key 找回。

## 4.1 复测：换有效 Key 后的真实对话（2026-10-17 15:52）

拿到有效 Key（正文只写作 `sk-dc5d…296c`）后，用**同一套机制**重做步骤 3。原先的 401 现场（§4）不删，
作为"无效 Key 长什么样"的对照保留。

**Key 替换证据**（依旧没有读取 `auth.json` 内容）：

| 项 | 结果 |
| --- | --- |
| `auth.json` 前态 | `size=95 mtime=2026-10-17 14:48:58.518694531 +0800` |
| `POST /api/auth/api-key/deepseek` | **HTTP 200** `{"success":true}` |
| `auth.json` 后态 | `size=95 mtime=2026-10-17 15:52:38.065345937 +0800`（mtime 前移 ⇒ 已被覆盖） |
| `GET /api/auth/providers` | `{"id":"deepseek","configured":true,"source":"stored","modelCount":2}`；其余 provider 全 `configured:false` |
| `GET /api/models?cwd=…` | **200**：`deepseek:deepseek-flash`（DeepSeek V4.1 Flash）、`deepseek:deepseek-v4-pro`（DeepSeek V4 Pro） |

size 仍是 95 是因为两把 Key 同为 35 字符、同结构；**新值生效的判据是 mtime 变 + 下表的真实往返**。

**会话与流**（`POST /api/agent/new` → `ensure_session` + `toolNames:["read","write"]`，再开 SSE，再发 prompt）：

| 项 | 结果 |
| --- | --- |
| `POST /api/agent/new` | **200**，`sessionId = 01a148d9-584e-71d8-9206-82080b01e7c4`，`model = deepseek/deepseek-v4-pro`，`thinkingLevel = high` |
| `POST /api/agent/<id>` prompt | **200** `{"success":true,"data":null}` |
| SSE `data:` 事件总数 | **301** |
| 顶层类型分布 | `connected`1、`agent_start`1、`message_start`2、**`message_update`292**、`message_end`2、`agent_end`1、`agent_settled`1、`prompt_done`1 |
| **`text_delta` 数** | **256** ⇒ **> 0 ✓**（本构建把它们包在 `message_update.assistantMessageEvent` 里，另有 `thinking_delta` 32、`thinking_start`/`thinking_end`/`text_start`/`text_end` 各 1） |
| `text_delta` 拼接 vs 最终文本 | **逐字一致**（490 字，`joined == message_end.content[0].text` ⇒ 流式增量无损） |
| `stopReason` | **`stop`**（不是 `error`） |
| `model` / `api` | `deepseek` / `deepseek-v4-pro` / `openai-completions` |
| `usage` | `{"input":23,"output":295,"cacheRead":1152,"cacheWrite":0,"reasoning":32,"totalTokens":1470,"cost":{"input":3.036e-05,"output":0.0011682,"cacheRead":5.0688e-05,"total":0.001249248}}` |
| `Cpp Crash` | **0**（`hilog -x \| grep -ac 'Cpp Crash'`，复测前后均为 0） |

**回答前 300 字（原文照抄；不含任何凭据）**：

```
你好！我是 **pi**，一个编码智能体（coding agent），运行在 pi 编码代理框架中。简单介绍一下我自己：

## 我是谁

我是一个能够帮助你完成各种编程任务的 AI 助手。我可以：

- 📖 **阅读和分析代码** — 查看项目中的文件、理解代码结构
- ✍️ **编写和修改代码** — 创建新文件、重写现有文件
- 🔍 **执行命令和工具** — 根据项目需求调用各种工具
- 🛠️ **扩展能力** — 支持扩展、自定义工具、主题、技能等

## 我能帮你做什么

- 解释代码逻辑、排查 bug
- 实现新功能、重构代码
- 编写测试、文档
- 解答编程相关问题
- 探索和
```

⇒ 步骤 3 **现已完整通过**：真实 provider 往返 + 真实流式回答 + `stopReason=stop` + 无 401 + 无崩溃。

## 5. 顺带发现（都是真机实测，未改代码）

1. **`/api/models` 与 `/api/agent/new` 的 cwd 必须用 el2 别名**：
   传 `hdc shell` 视角的 `/data/app/el2/100/base/<bundle>/haps/entry/files/workspace` → **HTTP 400**
   `{"error":"Directory does not exist: …"}`；换成 `/data/storage/el2/base/haps/entry/files/workspace` → 200。
2. **目录选择器"沙箱"页起点是错的**：`DirectoryPicker` 打开后停在不存在的
   `/data/storage/el2/base/files/workspace`（`GET /api/cwd/browse?path=` 该路径 → 404），而应用真实根是
   `/data/storage/el2/base/haps/entry/files`（少了 `haps/entry`）。所以要选工作区必须用输入框手打绝对路径。
3. **我的脚本编码坑（非应用缺陷）**：第一次我用一个 shell 脚本发 prompt，脚本文件被写成 **GBK**，
   于是发出去的是 GBK 字节，应用按 UTF-8 解码后把 `介绍一下你自己` 存成了 U+FFFD 乱码（`message_end` 里可见）。
   改用纯 ASCII 的 JSON `\u` 转义重发后，用户消息**逐字无损**回环 ⇒ 应用的 UTF-8 处理是正确的。

## 6. 留存的截图与文本（尺寸见括号）

拍法：`hdc shell "snapshot_display -f /data/local/tmp/<name>.jpeg"` +
`hdc shell "uitest dumpLayout -p /data/local/tmp/<name>.json"`，
再用 `MSYS_NO_PATHCONV=1 hdc file recv /data/local/tmp/<name> ./<name>`（先 `cd` 进本目录，用相对路径）。

| 文件 | 大小 | 内容 |
| --- | --- | --- |
| `01-set-key.jpeg` | 270,020 B | 设置 › 提供商：`已连接的提供商` → `DeepSeek` + `API 密钥`；下方"热门提供商"（OpenCode Go/Anthropic/OpenAI…）全是"连接"按钮 |
| `01-set-key.layout.json` | 247,574 B | 同上可及树（文本：`提供商`/`已连接的提供商`/`DeepSeek`/`API 密钥`/`Manage DeepSeek accounts`） |
| `02-workspace.jpeg` | 216,539 B | 左侧 `会话 → pitest-20261017`，`文件 → ~/workspace/pitest-20261017` 里能看到 **`hello.txt`**，右侧"新会话的位置 = pitest-20261017" |
| `02-workspace.layout.json` | 214,585 B | 同上可及树（文本：`pitest-20261017`/`hello.txt`/`~/workspace/pitest-20261017 有新活动`/`新会话的位置`） |
| `03-chat.jpeg` | 200,934 B | **历史记录：首轮用无效 Key 的 401 现场** —— 提问 `介绍一下你自己` + `DeepSeek V4 Pro` + 时间戳；**报错那一行被遮挡**（见 §7） |
| `03-chat.layout.json` | 217,646 B | 同上可及树，仅把 provider 回显的 4 位尾号替换成 `****<redacted-tail>`（其余原样） |
| `04-chat-reply.jpeg` | 317,231 B | **复测的真实回答**：会话里同时可见提问 `介绍一下你自己` 与 `DeepSeek V4 Pro` 下的完整流式回答（"你好！我是 pi，一个编码智能体…" 到 "有什么我可以帮你的吗？😊"）；无任何报错、无需遮挡 |
| `04-chat-reply.layout.json` | 273,640 B | 同上可及树（含回答各段落文本，逐段可读） |

## 7. 每一张图"为什么没有凭据"——逐张交代

- 通用手段：截图前先 `uitest dumpLayout` 抓可及树，扫「Key 前缀串」/ `password` / `apiKey` / `Authorization` / `Bearer`
  / Key 前后片段，**命中就不拍、或改变时机**；拍完再扫一遍留存文件。
- `01-set-key.jpeg`：该页只有"已连接"状态与"管理账户"下拉，**不渲染 Key 输入框**（未配置时才有），
  输入框本身也是 password 型且 state 恒为空 ⇒ 图像里不存在任何 Key 文本；可及树 0 命中。
- `02-workspace.jpeg`：只有工程名、目录名、文件名、按钮标签；无 provider 页、无凭据；可及树 0 命中。
- `03-chat.jpeg`：**遮挡了 provider 401 报错所在的一整条横幅**（坐标 `[990,566]–[2620,706]`，
  原 `alert` 节点为 `[1019,581]–[2578,679]`）。原因是那条报错里含 DeepSeek 回显的 4 位 Key 尾号；
  遮挡后图像中**不含任何 Key 派生字符**。用像素检查确认遮挡区域被单色填满（223,300 px 全为 `(20,20,22)`）。
  报错全文（除那 4 位）记录在 §4 的文本里。
- `04-chat-reply.jpeg`：**无需遮挡**——这次没有报错横幅，整屏只有提问、模型名、回答正文与会话侧栏。
  截图前的可及树扫描：Key 前缀串、两把 Key 的首尾片段、`password`、`apiKey`、`Authorization`、`Bearer` **全部 0 命中**；
  拍摄后再扫留存文件同样 0 命中。
- 四张图里唯一出现的 URL 是 ArkTS 侧调试状态栏的 `http://127.0.0.1:<port>/`（回环地址，无凭据）；
  文档正文一律写作 `<port>`。**没有任何 URL/user/password/token 入镜**。
- 断言：**本目录任何文件（含图片）都不含明文 Key**；两把 Key 在文本里只以 `sk-e32f…a17f` 与 `sk-dc5d…296c` 的缩写形式出现。

## 8. 泄漏检查与提交状态

有界检查（本机全量 `/d/pi-workspace` grep 会超时，故按指定范围）：

```bash
# 扫描串刻意不写全：文档里写出被扫的串 = 文档自命中。运行时从环境变量取 Key 的前 11 字符
PFX=${K:0:11}                                          # K 只在当前 shell 内存里
for d in pi-desktop-ark ohos-node-bridge ohos-node-bridge/docs pi-desktop-ark/docs; do
  grep -rIl -- "$PFX" "$d" 2>/dev/null
done
# → 输出为空（四个目录都无命中，含本证据目录）
grep -rIl -- "$PFX" pi-desktop-ark/docs/evidence/2026-10-17-basic-functional   # → 空
# 唯一含 Key 派生文字的文本是 README 里的缩写写法；图片与 *.layout.json 全部 0 命中
# 复测那把 Key 的前 11 字符同样按上面四段路径扫过，结果同样为空
# 提交内容自检：Key 前缀 + 调试签名用的两个密钥库口令字段名（此处不写出字段名，避免文档自命中）
git -C pi-desktop-ark diff --cached | grep -Ei "$PFX|keystore"   # → 空
```

- `git -C pi-desktop-ark status --porcelain` 提交前：` M build-profile.json5`（保持未提交）+
  `?? docs/evidence/2026-10-17-basic-functional/`。
- **`build-profile.json5` 未提交**（两个仓库都没有）。
