/**
 * Runnable self-check for the dsh-encore plugin.
 * Usage: node index.test.mjs [path/to/index.mjs]
 */
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'

const target = process.argv[2] ?? fileURLToPath(new URL('./index.mjs', import.meta.url))
const { apply } = await import(pathToFileURL(target).href)

const settle = () => new Promise((done) => setImmediate(done))

function harness(maxContinues, goals) {
  const followed = []
  const warnings = []
  const resumedGoals = []
  let listener
  const agent = { id: 's1', session: { id: 's1' }, followup: (message) => followed.push(message) }
  apply({
    agents: { get: (id) => (id === 's1' ? agent : undefined) },
    // `undefined` models a composition with no goal subsystem: the service is
    // simply absent, which is what the non-throwing reflect read reports.
    reflect: {
      get: (name, strict) => {
        assert.equal(name, 'goals')
        assert.equal(strict, undefined, 'the strict default must be used')
        if (goals === undefined) return undefined
        return {
          get: () => goals.goal,
          resume: (_agent, ref) => {
            if (goals.resumeError !== undefined) throw goals.resumeError
            resumedGoals.push(ref)
            goals.goal = { ...goals.goal, activation: 'armed' }
          },
        }
      },
    },
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
    resumedGoals,
    agent,
    goals,
    turnEnd,
    end: async (kind, session) => { turnEnd(kind, session); await settle() },
    other: (event, session) => listener(session ?? agent.session, event),
  }
}

/** The plain continuation, as opposed to a goal round the driver queues itself. */
const plainContinue = (h) => h.followed.filter((message) => message.source.kind === 'dsh-encore').length

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

// An active but disarmed goal: hand the continuation back to the goal driver
// instead of queueing a plain continuation that would compete with it.
{
  const g = harness(5, { goal: { id: 'goal-1', revision: 3, phase: 'active', activation: 'disarmed' } })
  await g.end('max-tokens')
  assert.deepEqual(g.resumedGoals, [{ id: 'goal-1', revision: 3 }], 'the disarmed active goal is re-armed')
  assert.equal(plainContinue(g), 0, 'no plain continuation competes with the re-armed goal')
  assert.equal(g.goals.goal.activation, 'armed')
}

// An already-armed goal is the driver's business; do not touch it.
{
  const g = harness(5, { goal: { id: 'goal-1', revision: 3, phase: 'active', activation: 'armed' } })
  await g.end('max-tokens')
  assert.equal(g.resumedGoals.length, 0, 'an armed goal is left alone')
  assert.equal(plainContinue(g), 1)
}

// Paused, blocked and completed goals must never be resumed.
for (const phase of ['paused', 'blocked', 'complete']) {
  const g = harness(5, { goal: { id: 'goal-1', revision: 3, phase, activation: 'disarmed' } })
  await g.end('max-tokens')
  assert.equal(g.resumedGoals.length, 0, `a ${phase} goal is not resumed`)
  assert.equal(plainContinue(g), 1, `a ${phase} goal still continues the turn`)
}

// No goal at all, and a composition without the goal subsystem: plain continuation.
{
  const g = harness(5, { goal: undefined })
  await g.end('max-tokens')
  assert.equal(g.resumedGoals.length, 0)
  assert.equal(plainContinue(g), 1)
}

// A rejected resume (stale revision, exhausted cap, a pause mid-turn) falls back
// to the plain continuation rather than losing the resume.
{
  const g = harness(5, { goal: { id: 'goal-1', revision: 3, phase: 'active', activation: 'disarmed' }, resumeError: new Error('stale goal ref') })
  await g.end('max-tokens')
  assert.equal(g.resumedGoals.length, 0)
  assert.equal(plainContinue(g), 1, 'a failed re-arm still continues the turn')
  assert.match(g.warnings.at(-1), /could not re-arm the goal/)
}

console.log(`ok — dsh-encore self-check passed (${target})`)
