/**
 * dsh-encore — resume a turn the output-token cap cut off.
 *
 * Mounted as one row in the home patch layer (`$DSH_HOME/cordis.patch.yml`), so
 * it applies to every profile, every workspace, and every session. A `turn/end`
 * whose reason is `max-tokens` means the model was cut off mid-answer; this
 * queues the same "continue" prompt the Chat notice asks the human to send.
 *
 * @module dsh-encore
 */
import { randomUUID } from 'node:crypto'

/** Row label in the Loader tree. */
export const name = 'dsh-encore'
/** Service this row waits for; a composition without it keeps the row inactive. */
export const inject = ['agents']

/** Model-visible continuation prompt for one capped turn. */
const CONTINUE_TEXT =
  'Your previous reply was cut off by the output-token limit, so the turn ended mid-answer. ' +
  'Continue from exactly where it stopped; do not repeat or re-summarize what you already produced. ' +
  'Finish the remaining work and report the result.'

/**
 * Install automatic continuation for every session in the process.
 * @param ctx - owning context.
 * @param config - `maxContinues`: consecutive capped turns to resume (default 5).
 */
export function apply(ctx, config) {
  const maxContinues = config?.maxContinues ?? 5
  if (!Number.isSafeInteger(maxContinues) || maxContinues < 1) throw new Error('dsh-encore: maxContinues must be a positive integer')
  /** Consecutive capped turns already resumed, per live agent. */
  const resumed = new WeakMap()

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    const agent = ctx.agents.get(session.id)
    if (agent === undefined || agent.session !== session) return
    if (event.data.reason?.kind !== 'max-tokens') {
      resumed.delete(agent)
      return
    }
    const attempt = (resumed.get(agent) ?? 0) + 1
    if (attempt > maxContinues) {
      ctx.logger.warn(`dsh-encore: agent "${agent.id}" hit the output-token cap ${attempt} turns in a row; leaving it to the user`)
      return
    }
    resumed.set(agent, attempt)
    // This listener runs inside the append that published the event, and the
    // loop has not published its idle phase yet: queueing synchronously would
    // reenter the session append. setImmediate lands after both.
    setImmediate(() => {
      try {
        if (ctx.agents.get(agent.id) !== agent) return
        agent.followup({
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: CONTINUE_TEXT }],
          source: { kind: 'dsh-encore' },
        })
      } catch (error) {
        // A throw here sits outside every loop frame; contain it rather than
        // letting the host's fail-loud guard kill the process.
        ctx.logger.warn(`dsh-encore: could not resume agent "${agent.id}": ${String(error)}`)
      }
    })
  })
}
