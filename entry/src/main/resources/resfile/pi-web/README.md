# 应用载荷（pi-web + pi）放这里

本目录对应 HAP 内的 `resources/resfile/pi-web/`，**只读直读**，零解压（工程规划 §5.5）。

## 放什么

- `pi-web` 的构建产物（Next 的 standalone / 预生成 CJS 形态）；
- 若需可写则改用 `tar.gz` + **Node 自己解包**（谁写谁读：ArkTS/鸿蒙解压器写出的文件 Node 读不到）。

## 当前为什么是空的

骨架期**不带载荷**：本目录除本文件外全部被 `.gitignore` 忽略（载荷压后预估 70–90 MB，不进 git），
由后续的 provision 脚本从 `../pi-web` / `../pi` 的构建产物拷入。

## Node 怎么读到它

真机上 `resources/resfile/` 会落到应用安装目录下（`context.bundleCodeDir` 相关路径）。
**不要用 `process.cwd()` 拼路径**（真机上 `cwd = /`）；入口脚本用绝对路径指过来，
或把需要写权限的部分在首启时由 Node 自己复制到 `filesDir`。
