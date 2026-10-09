# dsh-encore, working on this repo

The whole plugin is `index.mjs`. Read it before changing it — it is short, and every line in it is
load-bearing.

## The contract

Four things must stay true, or the plugin silently stops working or breaks the host:

1. **The trigger is `turn/end` with `reason.kind === 'max-tokens'`.** That is the only durable signal
   that a turn was cut off. Do not switch to a UI hook or a token count.
2. **The continuation is queued with `setImmediate`.** The `session/event` listener runs inside the
   append that publishes the event, and the agent loop has not published its idle phase yet. A
   synchronous `followup` reenters the session append and the harness rejects it. Do not "simplify"
   this away.
3. **`followup` failures are caught and logged.** A throw inside `setImmediate` sits outside every
   loop frame and trips the host's fail-loud guard, killing the process.
4. **`goals` is read optionally, through `ctx.reflect.get('goals')`.** Never write `ctx.goals` here.
   `goals` is deliberately absent from `inject`: reading a service that is not injected *always*
   throws (`cannot get property "goals" without inject`), and injecting it would flip this row to
   inactive in every composition that ships no goal subsystem — but this plugin is a global safety
   net and must keep working there. The reflect read is non-throwing, returns `undefined` when the
   service is absent *or* unloading, and leaves `inject = ['agents']` alone.

## Changing it

- Keep the plugin dependency-free. `node:crypto` is the only import; nothing here needs more.
- Keep the agent lookup identity-checked (`agent.session !== session`) and re-checked inside
  `setImmediate`. Forked, disposed and stale sessions must be ignored.
- Keep the resume counter bounded, reset on any non-capped turn, and keep the warning when the
  ceiling trips. An unbounded resume loop spends the user's money.
- Keep the `source.kind` distinct from `user`. The resumed turn must be visibly attributable to the
  plugin, not disguised as something the human typed.
- Keep the goal re-arm ahead of the plain continuation. When the agent has an `active` goal that a
  cut left `disarmed`, resuming it hands the turn back to the goal-round driver, which is what keeps
  a long goal advancing; only fall back to the plain continuation when there is no such goal. Any
  failure in that path (stale ref, exhausted round cap, a goal paused mid-turn) must fall back
  rather than throw — a lost resume is worse than a plain one.

## The check

`index.test.mjs` is the runnable check and the reason this repo has a CI workflow:

```sh
node index.test.mjs
```

It fakes a `ctx`, drives `turn/end` events, and asserts every branch: a completed turn does not
continue, a capped turn does, the ceiling stops it, a normal turn resets the counter, unknown and
stale sessions are ignored, and a bad `maxContinues` throws. It also covers the goal re-arm: an
`active`+`disarmed` goal is resumed with its exact `{id, revision}` and no plain continuation is
queued, an already-`armed` goal and every non-`active` phase fall through to the plain continuation,
a composition with no `goals` service still continues, and a failing `resume` falls back with a
warning.

**Change behavior, change the test in the same commit.** No test framework, no fixtures, no
dependencies — `node:assert` only. Keep it that way.

## Verifying against a real harness

`--dump-config` proves the row *composes*, not that it *activates*. To prove activation, boot and
look for `warning: 1 entry did not activate`; a clean boot means the row loaded. Renaming
`index.mjs` is the control. The `desktop` profile is Electron-managed and refuses `--dump-config`.
