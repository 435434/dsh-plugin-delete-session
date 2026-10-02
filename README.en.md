# dsh-plugin-delete-session

[中文](README.md)

[![test](https://github.com/435434/dsh-plugin-delete-session/actions/workflows/ci.yml/badge.svg)](https://github.com/435434/dsh-plugin-delete-session/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)


Adds a **Delete session** row to the "…" menu of every session in DSH (DeepSeek Harness) — placed after "置顶会话 / 重命名 / 分叉会话 / 归档会话", as the last row of the menu.

![menu location](docs/menu.png)

> The screenshot above is the menu **before** installing: this plugin inserts one more row, **Delete session**, under 归档会话 (archive).

> DSH ships no session-delete API (neither on the Host nor on the Client), so this plugin implements the whole operation itself: remove the files, repair the registry accounting, refresh the UI.

Verified on DSH 0.2.0-rc.2 Desktop (Windows). Requires DSH ≥ 0.2.0-rc.1.

## Features

- Inline confirmation inside the menu: a red warning plus `Cancel` / `Delete`; the destructive button stays disabled for 700 ms so a double click cannot delete.
- A session that is currently in use is refused, and the reason is shown inside the menu (which stays open) so you can retry.
- After a successful delete the sidebar row disappears **immediately** — no reload, no restart.
- Localized (zh/en) following the client language; styling uses only DSH theme tokens, so light and dark themes both look right.
- Exactly one loopback-only POST route; nothing else is exposed.

## Install

Requires DSH ≥ 0.2.0-rc.1. Installing from GitHub needs network access to GitHub, and — because a `github:` spec is fetched by pnpm through git — a `git` executable on the machine.

### Option 1: install straight from GitHub (recommended)

Open the **Plugins** page in the DSH sidebar → **Add plugin**, paste this line and press Enter:

```
github:435434/dsh-plugin-delete-session
```

Or have an agent use the built-in tool:

```
plugin_manager { action: "install_bundle", target: "github:435434/dsh-plugin-delete-session" }
```

Pin a release by appending its tag:

```
github:435434/dsh-plugin-delete-session#v0.1.0
```

Refresh the page afterwards and open any session's "…" menu — the last row is **Delete session**.

### Option 2: install from a local directory (development / offline)

1. Put this directory anywhere (`git clone`, or download and unpack), e.g. `D:\plugins\dsh-plugin-delete-session`.
2. Let DSH install it, using the built-in `plugin_manager`:

   ```
   plugin_manager { action: "install_bundle", target: "D:\\plugins\\dsh-plugin-delete-session" }
   ```

3. Refresh the page and open any session's "…" menu — the last row is **Delete session**.

The package is an ordinary DSH `bundle + client` package, so any equivalent install path (add it to the profile as a dependency and enable it in the bundles list) works too.

### Option 3: install from npm (optional)

After publishing to npm (drop `"private"` from `package.json`), users can install by package name, which needs no local `git`:

```
plugin_manager { action: "install_bundle", target: "dsh-plugin-delete-session" }
```

### Uninstall

```
plugin_manager { action: "remove_bundle", target: "dsh-plugin-delete-session" }
```

### Upgrade

Overwrite the files here and install again; **changing the JavaScript of an installed package requires an app restart** to load a fresh module generation (reinstalling alone does not reload code). DSH plugins do not update automatically: upgrading means uninstalling and installing the new version.

## Configuration

The bundle row in `cordis.patch.yml` accepts one option:

| Key | Default | Meaning |
| --- | --- | --- |
| `sessionsRoot` | `$DSH_HOME/sessions` | Session storage root. Usually unnecessary; set it only if you customized session-persistence-jsonl's `root`. |

```yaml
- insert:
    - id: delete-session
      name: 'dsh-plugin-delete-session'
      config:
        sessionsRoot: 'D:\\somewhere\\sessions'
```

## How it works

### Client (`client.js`)

A Module Loader bundle (plain JavaScript — no JSX, no imports; React is injected by the loader). It contributes one row to the slot `sidebar.workspaces.session.menu.item`:

- `id`: `dsh-plugin-delete-session.delete-session`, `order`: 500 (after archive, 400)
- Click → the row becomes a confirmation → the confirm button `POST`s `/api/dsh-plugin-delete-session/delete` with `{ sessionId, confirmed: true }`
- On success the menu closes (the Host has already removed the row); on failure the reason is shown in place and the action can be retried

### Host (`index.js`)

1. If the session is still open in this Host process, refuse: its log file is held by the session store and deleting it would corrupt state that is actively being written;
2. Remove the on-disk session directory `<sessionsRoot>/<encoded cwd>/session-<uuid>/` (located by directory name, so the cwd encoding never has to be reproduced);
3. Drop the id from workspace accounting (`Workspace.detachSession`) and from the pin/archive sets;
4. Emit `api-session/removed` so the browser's session list drops the row too.

The storage layer (`sessionPersistence.list/stat`) and the SQLite search index both re-scan the filesystem and tolerate missing files (the index reconciles itself before each query), so no index surgery is needed.

## Security

- The route `/api/dsh-plugin-delete-session/delete` accepts `POST` only, and only when the peer is loopback (`127.0.0.1` / `::1` / `::ffff:127.*`), `Host` and `Origin` both point at this server, and the body carries `confirmed: true`.
- The session id must match `^session-[A-Za-z0-9_-]+$`, which rules out path traversal.
- Deletion is strictly limited to directories under `<sessionsRoot>` whose name equals that session id.

## Limitations

- **A session that is in use cannot be deleted**: switch to another session (so the Host releases it) or restart the app first.
- **Deletion is permanent — no trash, no undo.** That is a deliberate design choice.
- Deleting a session does not cascade to its forks/children.
- The click path cannot be exercised automatically in an environment without browser control — please confirm once by hand.

## Getting listed in the plugin market

The community plugin market reads its list from the curated repository [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin): to appear in the market and its site, open a PR there adding one entry (site and market sync automatically, usually within a day). Installing straight from GitHub with Option 1 works without being listed.

## Layout

| File | Purpose |
| --- | --- |
| `index.js` | Host half: HTTP route + delete/accounting/events |
| `client.js` | Client half: Module Loader bundle registering the menu row |
| `cordis.patch.yml` | Bundle layer that mounts the plugin row into a profile |
| `icon.svg` | Plugin icon (shown in the plugin list) |
| `docs/menu.png` | Screenshot of the menu location |
| `test/host.test.mjs` | Unit tests for the host logic (`node --test`) |
| `.github/workflows/ci.yml` | GitHub Actions: run the tests on push |
| `package.json` | Package manifest (`dsh.bundle` + `dsh.client`) |
| `README.md` / `README.en.md` | Documentation |
| `CHANGELOG.md` / `LICENSE` | Changelog / MIT license |

## Development & tests

The host logic does not depend on the DSH runtime and can be tested directly:

```bash
node --test
```

(If the sandbox forbids piping a child process, `node --test` fails with `spawn EPERM`; run the file itself instead: `node test/host.test.mjs`.)

Coverage: session-id validation, the same-origin guard matrix, session-directory discovery, a successful delete (including accounting and the emitted event), refusing a live session, and reporting a missing session.

## License

[MIT](LICENSE)
