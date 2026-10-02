/**
 * dsh-plugin-delete-session — host half.
 *
 * DSH has no session-delete API, so this plugin owns the operation end to end:
 *
 *   1. refuse while the Session is still live in this process (its log file is
 *      held open by the session store, and deleting the Session another part of
 *      the Host is actively writing would corrupt the app's own bookkeeping);
 *   2. remove the on-disk session directory under <DSH_HOME>/sessions — the
 *      durable session storage and the SQLite search index both re-read the
 *      filesystem, so the Session simply disappears from every list;
 *   3. drop the id from workspace accounting (`Workspace.detachSession`) and from
 *      the registry-global pin/archive sets, which is what makes the browser
 *      sidebar drop the row through the workspace feed;
 *   4. emit `api-session/removed`, the event the shipped session controller emits
 *      when a Session leaves the live registry, so the client's session store
 *      drops its snapshot too.
 *
 * Reached from the browser by exactly one loopback-only route; see client.js.
 */
import { readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const name = 'delete-session'

/** Every dependency is load-bearing: the route, and the accounting it repairs. */
export const inject = ['webServer', 'workspaceRegistry', 'sessions']

export const ROUTE_PATH = '/api/dsh-plugin-delete-session/delete'

export function apply(ctx, config) {
  const settings = config !== null && typeof config === 'object' ? config : {}
  const sessionsRoot =
    typeof settings.sessionsRoot === 'string' && settings.sessionsRoot.length > 0
      ? settings.sessionsRoot
      : path.join(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'sessions')
  ctx.effect(() => registerDeleteRoute(ctx, sessionsRoot), 'dsh-plugin-delete-session: delete route')
  ctx.logger?.info?.(`dsh-plugin-delete-session: sessions root ${sessionsRoot}`)
}

/** Register the single POST route; returns the disposer removing it. */
export function registerDeleteRoute(ctx, sessionsRoot) {
  const webServer = ctx.webServer
  const port = webServer.port
  return webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'POST required' })
          return
        }
        if (!isSameOriginRequest(req, port)) {
          sendJson(res, 403, { ok: false, error: 'loopback same-origin request required' })
          return
        }
        const input = await readJsonBody(req)
        if (input.confirmed !== true) {
          sendJson(res, 400, { ok: false, error: 'explicit confirmation required' })
          return
        }
        const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
        if (!isSessionId(sessionId)) {
          sendJson(res, 400, { ok: false, error: 'invalid session id' })
          return
        }
        const outcome = await deleteStoredSession(ctx, sessionsRoot, sessionId)
        sendJson(res, outcome.ok ? 200 : 409, outcome)
      } catch (cause) {
        sendJson(res, 500, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
      }
    },
  })
}

/**
 * Permanently delete one stored Session. Resolves to `{ ok: true, ... }` or to
 * `{ ok: false, error }` with a caller-facing reason; never throws for an
 * expected failure.
 */
export async function deleteStoredSession(ctx, sessionsRoot, sessionId) {
  if (ctx.sessions.get(sessionId) !== undefined) {
    return {
      ok: false,
      error: '该会话正在使用中（已在应用中打开），请先切换到其它会话后再删除',
    }
  }

  const directories = await findSessionDirs(sessionsRoot, sessionId)
  for (const directory of directories) {
    await rm(directory, { recursive: true, force: true })
  }

  const warnings = []
  const note = (what) => (cause) => warnings.push(`${what}: ${cause instanceof Error ? cause.message : String(cause)}`)

  let detached = false
  for (const workspace of ctx.workspaceRegistry.list()) {
    if (!workspace.sessionIds.includes(sessionId)) continue
    try {
      await workspace.detachSession(sessionId)
      detached = true
    } catch (cause) {
      note('detachSession')(cause)
    }
  }
  // Removing an id cannot introduce an unknown one, so both are no-ops once the
  // session is gone — safe to call unconditionally.
  try {
    await ctx.workspaceRegistry.unpinSession(sessionId)
  } catch (cause) {
    note('unpinSession')(cause)
  }
  try {
    await ctx.workspaceRegistry.unarchiveSession(sessionId)
  } catch (cause) {
    note('unarchiveSession')(cause)
  }
  try {
    ctx.emit('api-session/removed', sessionId)
  } catch (cause) {
    note('api-session/removed')(cause)
  }

  if (directories.length === 0 && !detached) {
    return { ok: false, error: '未找到该会话的存储目录（可能已被删除）' }
  }
  return {
    ok: true,
    sessionId,
    removedDirectories: directories.length,
    detached,
    ...(warnings.length > 0 ? { warnings } : {}),
  }
}

/** Every `<sessionsRoot>/<encoded-cwd>/session-<id>` directory on disk. */
export async function findSessionDirs(sessionsRoot, sessionId) {
  const hits = []
  let projects
  try {
    projects = await readdir(sessionsRoot, { withFileTypes: true })
  } catch (cause) {
    if (cause?.code === 'ENOENT') return hits
    throw cause
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const candidate = path.join(sessionsRoot, project.name, sessionId)
    try {
      const info = await stat(candidate)
      if (info.isDirectory()) hits.push(candidate)
    } catch (cause) {
      if (cause?.code !== 'ENOENT') throw cause
    }
  }
  return hits
}

export function isSessionId(value) {
  return typeof value === 'string' && /^session-[A-Za-z0-9_-]+$/.test(value)
}

/**
 * The shipped destructive HTTP handlers (e.g. the migration plugin) guard with
 * loopback + Host + Origin; this mirrors that posture: a request is accepted
 * only from this machine, addressed to this server by name, with an Origin that
 * matches — a cross-site page cannot forge it.
 */
export function isSameOriginRequest(req, port) {
  const address = req.socket?.remoteAddress
  const loopback =
    address === '127.0.0.1' ||
    address === '::1' ||
    (typeof address === 'string' && address.startsWith('::ffff:127.'))
  if (!loopback) return false
  const host = req.headers?.host
  if (typeof host !== 'string' || host.length === 0) return false
  if (port === undefined || port === null) {
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return false
  } else if (host !== `127.0.0.1:${String(port)}` && host !== `localhost:${String(port)}`) {
    return false
  }
  return req.headers?.origin === `http://${host}`
}

function sendJson(res, statusCode, value) {
  res.statusCode = statusCode
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(value))
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  if (chunks.length === 0) return {}
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  return parsed !== null && typeof parsed === 'object' ? parsed : {}
}
