---
name: dsh-encore
description: >
  Install, verify, tune or remove dsh-encore, the DeepSeek Harness plugin that
  automatically continues a turn the output-token cap cut off. Use when the user
  says "encore", "dsh-encore", "auto continue", "tự động continue", "hết output
  token", "bị cắt giữa chừng", "output token limit reached", "reply was cut off",
  or asks to install, configure, debug or uninstall automatic continuation for
  DSH. Also use when a DSH turn keeps ending mid-answer and the user wants it
  resumed without typing "continue" by hand, and when the user asks about the
  output cap (maxTokens) versus the context window, auto-compaction, /compact,
  thresholdRatio, retainRatio or headroomTokens in DSH — this skill documents
  both limits and which one dsh-encore actually reacts to. Also covers why a goal
  stops advancing (the Goal dock showing "Inactive Goal") after an output-token
  cut, and how dsh-encore re-arms it. Only for DeepSeek Harness — not for other
  agents.
argument-hint: "[install|verify|uninstall]"
license: MIT
---

# dsh-encore

Automatic continuation for DeepSeek Harness. A turn cut off by the output-token cap ends with
`turn/end` and reason `max-tokens`, and the harness then stops — there is no built-in resume. The
plugin listens for that exact event and queues the follow-up for the user.

You are operating an installed plugin, not writing one from scratch. The plugin is one dependency-free
file. Prefer configuring and verifying over rewriting.

## First: find the home

Everything lives under `$DSH_HOME`, default `~/.dsh` (`C:\Users\<you>\.dsh` on Windows). If
`DSH_HOME` is set, it wins. Resolve it before touching any path — installing into the wrong home is
the usual cause of a silent no-op.

## Install

The repo root **is** the plugin directory:

```sh
git clone https://github.com/anhlt2710/dsh-encore "$DSH_HOME/plugins/dsh-encore"
```

Then add one row to `$DSH_HOME/cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-encore
      name: ./plugins/dsh-encore/index.mjs
      config:
        maxContinues: 5
```

**If that file already exists, append the entry to the existing array — never replace the file.**
The patch is a top-level YAML array; one `- insert:` per element. A file that is empty or
comments-only is a hard boot failure (`must be a top-level YAML array of loader entries`); to disable
the layer, write `[]`.

The relative `name` resolves next to the patch file. Use an absolute path only if the plugin lives
elsewhere.

> **Write the module before the row.** `dsh-hmr` watches the *patch file*, not the plugin directory.
> A row reconciled while `index.mjs` is missing fails its import and goes permanently inert —
> re-saving the patch does **not** retry it, and neither does the module appearing a moment later.
> If you find a dead row, make its `config` differ (bump `maxContinues`, then set it back) to force a
> re-import, or restart the app.

## Verify — do not skip this

An unreachable module leaves an **inactive row** and the app boots normally. So "it started fine" is
not evidence, and neither is `--dump-config` — that proves the row *composes*, not that it *activates*.

Run the self-check:

```sh
node "$DSH_HOME/plugins/dsh-encore/index.test.mjs"
```

Then prove activation by the boot log:

- Clean boot → prints **nothing**. The row loaded.
- Broken row → prints `dsh: warning: 1 entry did not activate` and
  `dsh-encore (file:///…): failed to import`.

If you want to confirm the check itself is meaningful, rename `index.mjs`, boot, observe the warning,
rename it back. That control is how the plugin was verified before release.

No Node on the machine? Use the harness-bundled one under
`<install>/resources/runtime/primary-runtime/dependencies/node/bin/`.

The `desktop` profile is managed by the Electron app and refuses `--dump-config`
(`profile "desktop" is managed exclusively by the Electron application`) — use the boot log there.
Other profiles: `dsh web --dump-config | grep -A3 dsh-encore`, where a `name` resolved to a
`file:///…` URL confirms the relative path was picked up.

## Restart

`dsh-hmr` watches the home patch and usually applies it live. If the app was already running *before*
the patch file existed, restart once.

## Two limits — do not confuse them

The single most common misdiagnosis. A turn can end for two unrelated reasons:

| Limit | What ran out | Handled by |
|---|---|---|
| **Output cap** (`maxTokens`) | the reply was longer than the model may emit in one turn | **dsh-encore** |
| **Context window** (`contextWindow`) | the whole conversation no longer fits in the prompt | DSH auto-compaction (built in) |

If the user sees *Output token limit reached*, that is the **output cap**. Compaction cannot prevent it:
compaction shrinks what goes *in*, not what the model may write *out*. Do not try to fix a recurring
output-cap problem by tuning compaction — the setting is `maxTokens` on the model route, and when the
provider will not allow a larger value, dsh-encore is the mitigation.

Conversely, if the conversation is being summarized and truncated in the *input*, that is compaction
doing its job, and dsh-encore is irrelevant to it.

### Auto-compaction is already on

`dsh-compaction-basic` ships enabled inside the agent presets (the top-level rows are disabled, the
preset groups enable them). Default trigger, with `W = contextWindow`, `O = maxTokens`,
`B = headroomTokens` (65536):

```
floor(min(W × 0.8, W − O − B))
```

For a 300K window with a 65536 output cap: `floor(min(240000, 168928))` = **168,928 tokens**, keeping
the newest `0.16 × (W − O)` ≈ **37,514 tokens** verbatim. Tunable per model:

```yaml
- id: compaction-basic
  name: '@deepseek-ai/dsh-compaction-basic'
  config:
    thresholdRatio: 0.8
    headroomTokens: 65536
    retainRatio: 0.16
    auto: true          # false = manual /compact only
    modelPolicies:
      - provider: deepseek-official
        model: deepseek-v4.1-flash
        thresholdRatio: 0.7
```

Misconfiguration fails fast at load: both retention forms together, a retention ratio ≥ the threshold
ratio, unknown settings, or a window where `W − O − B` is not positive all reject the plugin.

## Tune

`config.maxContinues` (default `5`) is how many **consecutive** capped turns to resume. Edit the
patch file; HMR reloads live, no restart.

Keep the ceiling. A model that exhausts its output budget every turn would otherwise resume forever,
unattended, on the user's bill. After the ceiling the plugin stops, logs
`hit the output-token cap`, and hands back to the user. Any normally-completed turn resets the
counter, so it is "in a row", not "per session". Do not raise it to make a looping model "finish" —
that is a symptom, not a setting.

## Goals — the cut also disarms them

If the user runs goals and complains that a long goal "stopped by itself" or that the Goal dock shows
*Inactive Goal* after a cut, this is why: the goal-round driver treats `turn/end` with reason
`max-tokens` as a stop signal and **disarms** the goal. The durable phase stays `active` and the work
is not lost, but no further rounds are queued until something re-arms it.

`dsh-encore` handles that. Before sending its own continuation, it asks for the cut agent's goal; if
there is one and it is `active` but `disarmed`, it calls `goals.resume` with the exact
`{id, revision}` instead. The driver then queues the next round itself — exactly one prompt, a real
goal round with the correct round number.

Two things to know before debugging this path:

- **`goals` is read through `ctx.reflect.get('goals')`, not `ctx.goals`, and is not in `inject`.**
  Reading an uninjected service always throws; injecting it would deactivate the plugin in
  compositions without the goal subsystem, defeating its purpose as a global safety net. If you are
  editing the plugin, keep the optional read.
- **Only `active` goals are re-armed.** `paused`, `blocked` and `complete` goals are left alone on
  purpose — resuming a goal the user deliberately stopped would override their decision. Those turns
  get the plain continuation instead.

A failing `resume` (stale ref, spent round cap, goal paused mid-turn) is caught and logged, and the
plain continuation goes out instead. A warning containing `could not re-arm the goal` in the log
means the goal path was attempted and failed — the turn still resumed.

## When it does not fire

In order of likelihood:

1. The row never activated — do the boot-log check, not a glance at the config.
2. The row went inert at install time because the module was missing when the patch was first
   reconciled. Touching the file will not fix it — change `config` or restart.
3. The app predates the patch file — restart.
4. `maxContinues` was already exhausted — look for the cap warning.
5. The model finished inside the cap — nothing was cut off, so nothing needed resuming.

## Uninstall

Remove the `dsh-encore` entry from `$DSH_HOME/cordis.patch.yml` (leave `[]` if it was the only row),
then delete `$DSH_HOME/plugins/dsh-encore/`. HMR applies it live.

## If you must change the plugin

Read `index.mjs` first. Four invariants are load-bearing, and "simplifying" any of them breaks the
host:

- **Trigger** stays `turn/end` + `reason.kind === 'max-tokens'`.
- **`setImmediate`** stays. The listener runs inside the append publishing the event, and the loop has
  not published its idle phase; a synchronous `followup` reenters the session append and is rejected.
  It is also what lands *after* the goal driver's own synchronous `max-tokens` disarm, which the
  re-arm has to see.
- **The try/catch** stays. A throw inside `setImmediate` is outside every loop frame and trips the
  host's fail-loud guard, killing the process.
- **`ctx.reflect.get('goals')`** stays. Never `ctx.goals`, and never add `goals` to `inject`.

Keep the agent lookup identity-checked, keep the counter bounded, keep `source.kind` distinct from
`user` so a resumed turn is attributable rather than disguised as the human's own message, and keep
the goal re-arm ahead of the plain continuation with every failure falling back to it. Change
behavior → change `index.test.mjs` in the same commit. `node:assert` only, no frameworks.
