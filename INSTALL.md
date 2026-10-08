# Install

Step by step for a machine that has never had this plugin. Ten minutes, most of it finding your
`$DSH_HOME`.

`$DSH_HOME` is the harness home. It defaults to `~/.dsh`:

| OS | Default |
|---|---|
| Windows | `C:\Users\<you>\.dsh` |
| macOS | `/Users/<you>/.dsh` |
| Linux | `/home/<you>/.dsh` |

If `DSH_HOME` is set in your environment, that wins. Confirm it before you start — every path below
is relative to it, and installing into the wrong home is the most common way to get a silent no-op.

---

## 1. Get the files

```sh
git clone https://github.com/anhlt2710/dsh-encore "$DSH_HOME/plugins/dsh-encore"
```

The repo root **is** the plugin directory, so this one command lands everything where the patch
expects it:

```
$DSH_HOME/
├── cordis.patch.yml                        ← you add one row here (step 2)
└── plugins/
    └── dsh-encore/
        ├── index.mjs                       ← the plugin
        ├── index.test.mjs                  ← self-check
        └── README.md
```

No build step. No `npm install`. No dependencies to resolve.

---

## 2. Add the row to the home patch

Open `$DSH_HOME/cordis.patch.yml` — create it if it does not exist — and add:

```yaml
- insert:
    - id: dsh-encore
      name: ./plugins/dsh-encore/index.mjs
      config:
        maxContinues: 5
```

**If the file already exists with rows in it, append this entry to the existing list. Do not replace
the file.** The patch is a top-level YAML array; each `- insert:` is one element. Two rows look like
this:

```yaml
- insert:
    - id: some-existing-row
      name: ./plugins/some-existing/index.mjs

- insert:
    - id: dsh-encore
      name: ./plugins/dsh-encore/index.mjs
      config:
        maxContinues: 5
```

> **The file must be a top-level YAML array.** A patch file that is empty, or that contains only
> comments, is a hard boot failure:
> `dsh: patches … must be a top-level YAML array of loader entries`.
> If you want to disable the layer, write `[]` — do not leave it blank.

The `name` is relative and resolves **next to the patch file**, which is why the clone path above
matters. To keep the plugin somewhere else, use an absolute path.

---

## 3. Run the self-check

```sh
node "$DSH_HOME/plugins/dsh-encore/index.test.mjs"
```

Expected:

```
ok — dsh-encore self-check passed (/…/.dsh/plugins/dsh-encore/index.mjs)
```

Any other output means the file is damaged — stop here and re-clone.

No Node on the machine? Use the one bundled with the harness:

```sh
# Windows
"$LOCALAPPDATA/Programs/DeepSeek Harness/resources/runtime/primary-runtime/dependencies/node/bin/node.exe" index.test.mjs

# macOS
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" index.test.mjs
```

---

## 4. Restart the app

`dsh-hmr` watches the home patch and usually applies it live. But if the app was already running
*before* the patch file existed, restart once to be sure.

---

## 5. Confirm it actually loaded

This is the step worth doing. The plugin fails quietly by design: an unreachable module leaves an
**inactive** row and the app boots normally, so "it seems fine" is not evidence.

**Clean boot = success.** Start the app and watch the startup output. A correctly loaded row prints
**nothing**.

**A broken row prints this:**

```
dsh: warning: 1 entry did not activate
dsh-encore (file:///…/index.mjs): failed to import
```

If you see it, the path in the patch does not resolve, or the module throws on import.

To prove the difference to yourself, rename `index.mjs` and boot again — you get the warning. Rename
it back and the warning disappears. That is the whole test, and it is how this plugin was verified
before release.

**On a non-Desktop profile** you can also dump the composed tree:

```sh
dsh web --dump-config | grep -A3 dsh-encore
```

```yaml
# == /home/<you>/.dsh/cordis.patch.yml
- id: dsh-encore
  name: >-
    file:///home/<you>/.dsh/plugins/dsh-encore/index.mjs
  config:
    maxContinues: 5
```

The `name` being resolved to a `file:///…` URL is the signal that the relative path was picked up.
The `desktop` profile is managed by the Electron app and refuses `--dump-config`
(`profile "desktop" is managed exclusively by the Electron application`) — use the boot-log check
instead.

---

## 6. See it work

Ask the model for something long enough to exceed the output-token cap. When the turn is cut off, the
reply should continue on its own, and the resumed turn appears in the conversation marked as
injected context rather than as a message from you.

If it does not fire, in order of likelihood:

1. The row never activated — do step 5 properly.
2. The app predates the patch file — restart it.
3. `maxContinues` was already exhausted — look for the `hit the output-token cap` warning.
4. The model finished inside the cap, so nothing was cut off and nothing needed resuming.

If it *never* fires and the model keeps stopping early, check which limit you are actually hitting.
`dsh-encore` reacts to the **output cap** (`maxTokens` on the model route) — not the **context window**.
Auto-compaction (`dsh-compaction-basic`, already enabled in the shipped presets) handles the context
window by summarizing old history, and cannot help with a long reply. The full explanation, the default
compaction threshold formula, and a 300K-window model config are in
[README.md → Model config and auto-compaction](README.md#model-config-and-auto-compaction).

---

## Changing the ceiling

Edit `config.maxContinues` in the patch file. `dsh-hmr` reloads live.

The ceiling exists because a model that exhausts its output budget every single turn would otherwise
resume forever, unattended, on your bill. After `maxContinues` consecutive capped turns the plugin
stops, logs a warning, and hands back to you. Any normally-completed turn resets the counter.

---

## Uninstall

Remove the `dsh-encore` entry from `$DSH_HOME/cordis.patch.yml` (leave `[]` if it was the only row),
then delete `$DSH_HOME/plugins/dsh-encore/`. HMR applies it live.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `must be a top-level YAML array` on boot | Patch file empty or comments-only. Write `[]` or real rows. |
| `dsh-encore (…): failed to import` | Wrong path in the patch, or the clone landed elsewhere. |
| Boots fine, never continues | Row inactive (check for the warning) or the app predates the patch. |
| Continues, then stops with a warning | Working as designed — `maxContinues` reached. |
| Only some sessions resume | Sessions without a live agent cannot be resumed. |
