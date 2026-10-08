/**
 * Runnable self-check for the dsh-encore plugin.
 * Usage: node index.test.mjs [path/to/index.mjs]
 */
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'

const target = process.argv[2] ?? fileURLToPath(new URL('./index.mjs', import.meta.url))
const { apply } = await import(pathToFileURL(target).href)

const settle = () => new Promise((done) => setImmediate(done))

function harness(maxContinues) {
  const followed = []
  const warnings = []
  let listener
  const agent = { id: 's1', session: { id: 's1' }, followup: (message) => followed.push(message) }
  apply({
    agents: { get: (id) => (id === 's1' ? agent : undefined) },
    logger: { warn: (text) => warnings.push(text) },
    on: (name, callback) => {
      assert.equal(name, 'session/event')
      listener = callback
    },
  }, { maxContinues })
  const turnEnd = (kind, session) => listener(session ?? agent.session, { type: 'turn/end', data: { reason: { kind } } })
  return {
    followed,
    warnings,
    agent,
    turnEnd,
    end: async (kind, session) => { turnEnd(kind, session); await settle() },
    other: (event, session) => listener(session ?? agent.session, event),
  }
}

const h = harness(2)
await h.end('completed')
assert.equal(h.followed.length, 0, 'a completed turn must not continue')

await h.end('max-tokens')
assert.equal(h.followed.length, 1, 'a capped turn continues')
assert.equal(h.followed[0].role, 'user')
assert.deepEqual(h.followed[0].source, { kind: 'dsh-encore' })
assert.ok(h.followed[0].content[0].text.length > 0)

await h.end('max-tokens')
assert.equal(h.followed.length, 2, 'the cap allows the configured consecutive resumes')

await h.end('max-tokens')
assert.equal(h.followed.length, 2, 'the cap stops further resumes')
assert.match(h.warnings.at(-1), /output-token cap/)

await h.end('aborted')
await h.end('max-tokens')
assert.equal(h.followed.length, 3, 'a non-capped turn resets the consecutive count')

await h.end('max-tokens', { id: 'other' })
assert.equal(h.followed.length, 3, 'a session with no live agent is ignored')

await h.end('max-tokens', { id: 's1' })
assert.equal(h.followed.length, 3, 'a stale session object for the same id is ignored')

h.other({ type: 'assistant/message' })
assert.equal(h.followed.length, 3, 'other events are ignored')

assert.throws(() => apply({ on() {}, agents: {}, logger: {} }, { maxContinues: 0 }), /maxContinues/)

console.log(`ok — dsh-encore self-check passed (${target})`)
