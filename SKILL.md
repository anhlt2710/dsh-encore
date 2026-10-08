---
name: dsh-encore
description: >
  Install, verify, tune or remove dsh-encore, the DeepSeek Harness plugin that
  automatically continues a turn the output-token cap cut off. Use when the user
  says "encore", "dsh-encore", "auto continue", "tự động continue", "hết output
  token", "bị cắt giữa chừng", "output token limit reached", "reply was cut off",
  or asks to install, configure, debug or uninstall automatic continuation for
  DSH. Also use when a DSH turn keeps ending mid-answer and the user wants it
  resumed without typing "continue" by hand. Only for DeepSeek Harness — not for
  other agents.
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
git clone https://github.com/ltanh2710/dsh-encore "$DSH_HOME/plugins/dsh-encore"
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

## Tune

`config.maxContinues` (default `5`) is how many **consecutive** capped turns to resume. Edit the
patch file; HMR reloads live, no restart.

Keep the ceiling. A model that exhausts its output budget every turn would otherwise resume forever,
unattended, on the user's bill. After the ceiling the plugin stops, logs
`hit the output-token cap`, and hands back to the user. Any normally-completed turn resets the
counter, so it is "in a row", not "per session". Do not raise it to make a looping model "finish" —
that is a symptom, not a setting.

## When it does not fire

In order of likelihood:

1. The row never activated — do the boot-log check, not a glance at the config.
2. The app predates the patch file — restart.
3. `maxContinues` was already exhausted — look for the cap warning.
4. The model finished inside the cap — nothing was cut off, so nothing needed resuming.

## Uninstall

Remove the `dsh-encore` entry from `$DSH_HOME/cordis.patch.yml` (leave `[]` if it was the only row),
then delete `$DSH_HOME/plugins/dsh-encore/`. HMR applies it live.

## If you must change the plugin

Read `index.mjs` first. Three invariants are load-bearing, and "simplifying" any of them breaks the
host:

- **Trigger** stays `turn/end` + `reason.kind === 'max-tokens'`.
- **`setImmediate`** stays. The listener runs inside the append publishing the event, and the loop has
  not published its idle phase; a synchronous `followup` reenters the session append and is rejected.
- **The try/catch** stays. A throw inside `setImmediate` is outside every loop frame and trips the
  host's fail-loud guard, killing the process.

Keep the agent lookup identity-checked, keep the counter bounded, keep `source.kind` distinct from
`user` so a resumed turn is attributable rather than disguised as the human's own message. Change
behavior → change `index.test.mjs` in the same commit. `node:assert` only, no frameworks.
