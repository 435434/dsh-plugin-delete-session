# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 0.1.0 — 2026-10-02

首个版本。

- 在会话「…」菜单末尾（order 500，归档之后）注册一行 **删除会话**。
- 菜单内联二次确认，危险按钮 700ms 后解除禁用。
- 宿主端永久删除 `<DSH_HOME>/sessions/<编码 cwd>/session-<uuid>/`。
- 删除后清理工作区记账（`Workspace.detachSession`）与置顶/归档集合，并发出 `api-session/removed`，侧栏立即移除该行。
- 正在使用中的会话拒绝删除并回显原因。
- 路由 `/api/dsh-plugin-delete-session/delete` 仅接受本机回环 + Host/Origin 一致 + `confirmed: true` 的 POST。
- 中英文文案；样式只使用 DSH 主题变量。
- 附带：GitHub Actions 测试工作流（`.github/workflows/ci.yml`，`node --test`）、菜单位置截图 `docs/menu.png`、中英文 README、MIT LICENSE、`test/host.test.mjs` 单元测试（7 项）。
- `package.json` 声明 `dsh.engines.dsh: ">=0.2.0-rc.1"`，供插件市场做版本兼容判断。
