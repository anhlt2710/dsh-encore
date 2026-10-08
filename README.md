<div align="center">

# dsh-encore

**The show isn't over. The model just ran out of stage.**

Automatic continuation for [DeepSeek Harness](https://deepseek.com): when a turn is cut off by the
output-token cap, `dsh-encore` sends the follow-up for you.

[![tests](https://github.com/ltanh2710/dsh-encore/actions/workflows/test.yml/badge.svg)](../../actions/workflows/test.yml)
![license](https://img.shields.io/badge/license-MIT-111111)
![deps](https://img.shields.io/badge/dependencies-0-111111)

</div>

---

You have seen this:

> **Output token limit reached** — The reply was cut off; earlier output is preserved in the
> conversation. Send "continue" to let the model resume.

Long answer, truncated mid-sentence, and now it is your job to notice and type `continue`. Every
time. `dsh-encore` notices instead.

## What it does

The harness ends a cut-off turn with a `turn/end` event whose reason is `max-tokens`, and then
stops. There is no built-in resume. `dsh-encore` listens for exactly that event and queues the same
continuation the notice asks you to send by hand.

One file. No dependencies. ~60 lines. This is the core of it, with the ceiling check elided:

```mjs
ctx.on('session/event', (session, event) => {
  if (event.type !== 'turn/end') return
  const agent = ctx.agents.get(session.id)
  if (agent === undefined || agent.session !== session) return
  if (event.data.reason?.kind !== 'max-tokens') {
    resumed.delete(agent)
    return
  }
  // …bounded by maxContinues, then:
  setImmediate(() => {
    agent.followup({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: CONTINUE_TEXT }],
      source: { kind: 'dsh-encore' },
    })
  })
})
```

## Install

```sh
git clone https://github.com/ltanh2710/dsh-encore "$DSH_HOME/plugins/dsh-encore"
```

Then add the row to `$DSH_HOME/cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-encore
      name: ./plugins/dsh-encore/index.mjs
      config:
        maxContinues: 5
```

Restart the app once. That is the whole install. Step by step for a fresh machine, including how to
check it actually loaded: **[INSTALL.md](INSTALL.md)**.

`$DSH_HOME` defaults to `~/.dsh`. The patch file is the **home layer**, so the row applies to every
profile (Desktop, Web, Headless), every workspace, and every session — not just one project.

## Config

| Field | Default | Meaning |
|---|---|---|
| `maxContinues` | `5` | How many **consecutive** capped turns to resume. |

Change it in the patch file; `dsh-hmr` reloads live, no restart.

**Why there is a ceiling.** A model that burns its whole output budget every turn would otherwise
loop forever and bill you for it. After `maxContinues` consecutive capped turns, `dsh-encore` stops,
logs a warning, and hands back to you. Any turn that ends normally resets the counter, so the limit
is "in a row", not "per session".

## How it is wired

Two details that are easy to get wrong, both load-bearing:

**The continuation is deferred with `setImmediate`.** The `session/event` listener runs *inside* the
append that publishes the event, and the agent loop has not published its idle phase yet. Calling
`followup` synchronously reenters the session append, which the harness rejects. Deferring lands
after both.

**The message is attributed as `source: { kind: 'dsh-encore' }`.** Session format v4 accepts any
non-empty source kind except `plugin`, and the Chat UI renders unknown kinds as an injected-context
row. So a resumed turn is visibly marked as coming from this plugin, not disguised as something you
typed — and it stays distinguishable in the durable log.

## Verify

```sh
node index.test.mjs
```

Expected: `ok — dsh-encore self-check passed (…)`.

Then check the install itself — a clean boot prints **no** warning, and a broken one prints:

```
dsh: warning: 1 entry did not activate
dsh-encore (file:///…/index.mjs): failed to import
```

That contrast is the real test that the row activates. It is also how this plugin was verified:
renaming `index.mjs` produces exactly that failure, leaving it in place produces a silent clean boot.

## Limits

- **Applies to subagents too.** An in-process subagent is an agent in the same registry, so a capped
  subagent turn is resumed as well. Usually what you want.
- **No per-model or per-provider rules.** One ceiling for everything.
- **No UI toggle.** Config lives in the patch file, on purpose.
- **Only while the process is alive.** A closed session has nothing left to resume.
- **The counter is per agent** and lives in a `WeakMap`, so it disappears with the agent.

## Uninstall

Delete the `dsh-encore` entry from `$DSH_HOME/cordis.patch.yml` and remove
`$DSH_HOME/plugins/dsh-encore/`. HMR applies it live.

## Prior art

[dietrichgebert/ponytail](https://github.com/dietrichgebert/ponytail) — for the shape of this repo,
and for the discipline that kept this to one file with no dependencies.

## License

[MIT](LICENSE).
