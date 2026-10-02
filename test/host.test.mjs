/**
 * Unit tests for the host half.
 *
 * The host logic deliberately does not touch the DSH runtime, so these tests
 * import index.js directly, run it against a temporary session tree and fake
 * Cordis services, and never go near a real profile's sessions.
 *
 *   node --test
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  ROUTE_PATH,
  apply,
  deleteStoredSession,
  findSessionDirs,
  inject,
  isSameOriginRequest,
  isSessionId,
} from '../index.js'

const SESSION_ID = 'session-248e5a3d-a581-46d6-9b46-c3cd84133c4c'

/** A throwaway `<DSH_HOME>/sessions`-shaped root, removed after the callback. */
async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-delete-session-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** The smallest ctx that satisfies deleteStoredSession, with spies. */
function fakeContext(options = {}) {
  const calls = { detached: [], unpinned: [], unarchived: [], emitted: [] }
  const makeWorkspace = (sessionIds) => ({
    sessionIds: [...sessionIds],
    async detachSession(id) {
      calls.detached.push(id)
      this.sessionIds = this.sessionIds.filter((value) => value !== id)
    },
  })
  const workspaces = (options.workspaces ?? []).map(makeWorkspace)
  if (options.owned !== undefined) workspaces.push(makeWorkspace(options.owned))
  return {
    calls,
    sessions: { get: (id) => (options.liveIds?.includes(id) ? { id } : undefined) },
    workspaceRegistry: {
      list: () => workspaces,
      unpinSession: async (id) => calls.unpinned.push(id),
      unarchiveSession: async (id) => calls.unarchived.push(id),
    },
    emit: (event, payload) => calls.emitted.push([event, payload]),
  }
}

test('isSessionId accepts session ids and rejects anything path-shaped', () => {
  assert.equal(isSessionId(SESSION_ID), true)
  assert.equal(isSessionId('session-abc_DEF-123'), true)
  assert.equal(isSessionId('session-'), false)
  assert.equal(isSessionId(''), false)
  assert.equal(isSessionId(undefined), false)
  assert.equal(isSessionId('../../etc'), false)
  assert.equal(isSessionId('session-x/../../y'), false)
  assert.equal(isSessionId('SESSION-1'), false)
})

test('isSameOriginRequest accepts only loopback with matching Host and Origin', () => {
  const request = (remoteAddress, headers) => ({ socket: { remoteAddress }, headers })
  const loopback = { host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19387' }
  const localhost = { host: 'localhost:19387', origin: 'http://localhost:19387' }

  assert.equal(isSameOriginRequest(request('127.0.0.1', loopback), 19387), true)
  assert.equal(isSameOriginRequest(request('::1', loopback), 19387), true)
  assert.equal(isSameOriginRequest(request('::ffff:127.0.0.1', loopback), 19387), true)
  assert.equal(isSameOriginRequest(request('127.0.0.1', localhost), 19387), true)

  // A peer address is always a literal IP; a name is not loopback.
  assert.equal(isSameOriginRequest(request('localhost', loopback), 19387), false)
  assert.equal(isSameOriginRequest(request('10.0.0.5', loopback), 19387), false)
  // Foreign Host, missing Origin, mismatched Origin.
  assert.equal(isSameOriginRequest(request('127.0.0.1', { host: 'evil.test:19387', origin: 'http://evil.test:19387' }), 19387), false)
  assert.equal(isSameOriginRequest(request('127.0.0.1', { host: '127.0.0.1:19387' }), 19387), false)
  assert.equal(isSameOriginRequest(request('127.0.0.1', { host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19388' }), 19387), false)
  assert.equal(isSameOriginRequest(request(undefined, loopback), 19387), false)
  // An unknown port still demands a loopback Host spelling.
  assert.equal(isSameOriginRequest(request('127.0.0.1', loopback), undefined), true)
  assert.equal(isSameOriginRequest(request('127.0.0.1', { host: 'evil.test', origin: 'http://evil.test' }), undefined), false)
})

test('findSessionDirs finds every project directory holding the session', async () => {
  await withRoot(async (root) => {
    await mkdir(path.join(root, '--E-~9879~76EE~6587~4EF6-agent-DSH--', SESSION_ID), { recursive: true })
    await mkdir(path.join(root, '--C-Users-kunku--', SESSION_ID), { recursive: true })
    await mkdir(path.join(root, '--C-Users-kunku--', 'session-99999999-2222-3333-4444-555555555555'), { recursive: true })
    await writeFile(path.join(root, 'loose-file'), 'x')

    const hits = await findSessionDirs(root, SESSION_ID)
    assert.equal(hits.length, 2)
    for (const hit of hits) assert.equal(path.basename(hit), SESSION_ID)

    assert.deepEqual(await findSessionDirs(root, 'session-absent-0000'), [])
    assert.deepEqual(await findSessionDirs(path.join(root, 'nope'), SESSION_ID), [])
  })
})

test('deleteStoredSession removes the files and repairs registry accounting', async () => {
  await withRoot(async (root) => {
    const sessionsRoot = path.join(root, 'sessions')
    const projectDir = path.join(sessionsRoot, '--E-项目--')
    await mkdir(path.join(projectDir, SESSION_ID), { recursive: true })
    await writeFile(path.join(projectDir, SESSION_ID, 'session.v4.jsonl.zstd'), 'log')

    const ctx = fakeContext({ workspaces: [['session-other']], owned: ['session-other', SESSION_ID] })
    const outcome = await deleteStoredSession(ctx, sessionsRoot, SESSION_ID)

    assert.deepEqual(outcome, { ok: true, sessionId: SESSION_ID, removedDirectories: 1, detached: true })
    assert.deepEqual(await readdir(projectDir), [])
    assert.deepEqual(ctx.calls.detached, [SESSION_ID])
    assert.deepEqual(ctx.calls.unpinned, [SESSION_ID])
    assert.deepEqual(ctx.calls.unarchived, [SESSION_ID])
    assert.deepEqual(ctx.calls.emitted, [['api-session/removed', SESSION_ID]])
  })
})

test('deleteStoredSession refuses a session that is live in this process', async () => {
  await withRoot(async (root) => {
    const sessionsRoot = path.join(root, 'sessions')
    const projectDir = path.join(sessionsRoot, '--E-项目--')
    await mkdir(path.join(projectDir, SESSION_ID), { recursive: true })

    const ctx = fakeContext({ liveIds: [SESSION_ID] })
    const outcome = await deleteStoredSession(ctx, sessionsRoot, SESSION_ID)

    assert.equal(outcome.ok, false)
    assert.match(outcome.error, /正在使用中/)
    assert.equal((await readdir(projectDir)).length, 1)
    assert.deepEqual(ctx.calls.emitted, [])
  })
})

test('deleteStoredSession reports a missing session instead of claiming success', async () => {
  await withRoot(async (root) => {
    const ctx = fakeContext({})
    const outcome = await deleteStoredSession(ctx, path.join(root, 'sessions'), SESSION_ID)

    assert.equal(outcome.ok, false)
    assert.match(outcome.error, /未找到/)
  })
})

test('the manifest contract holds', () => {
  assert.equal(ROUTE_PATH, '/api/dsh-plugin-delete-session/delete')
  assert.equal(typeof apply, 'function')
  for (const key of ['webServer', 'workspaceRegistry', 'sessions']) assert.equal(inject.includes(key), true)
})
