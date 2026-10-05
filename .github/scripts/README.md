# AI review workflows

Codex (`.github/workflows/codex-review.yml`) and Claude
(`.github/workflows/claude-review.yml`) review every same-repository pull request
with one onchain-midi-player reviewer role and one shared output policy. The design
mirrors the Provable-Games TinySynth fork's review workflows
(`webaudio-tinysynth`, `.github/` on `improve/integration`), adapted to this
repository's prompt, paths and job names, plus one addition: a review whose
secret or variables are not configured is skipped (see Policies).

| File | Purpose |
| --- | --- |
| `.github/review-agents.json` | Reviewer role, scope (`"."`, the whole repository), blocking severities, and per-provider variable names and pins |
| `.github/prompts/review-policy.md` | Shared review policy and output contract, including the non-blocking Skill opportunities section |
| `.github/prompts/onchain-midi-player-review.md` | Repository reviewer role: Cairo/Starknet, base64 splicing and alignment, the SETTINGS wire format, the permanent declared API, CSP-safe player JS, Cairo/JS byte parity, Scarb dependencies, agent skill consistency |
| `review_lib.py`, `review.py` | Configuration, prompt, result parsing, comment and gate helpers (Python standard library) |
| `run-codex-review.sh` | Runs the pinned Codex CLI once |
| `codex-cli/package.json`, `package-lock.json` | The Codex CLI pin |
| `test_review.py` | Helper and workflow regression tests |
| `ci-detect.sh` | Not part of the review: `ci.yml` uses it to switch on checks for files that exist (root `package.json` scripts, `player/`) |

## Checks

Each provider workflow runs four jobs. Require the two gates in the branch ruleset:

| Check name | Required | Meaning |
| --- | --- | --- |
| `Codex review gate` | yes | Codex review outcome for this head |
| `Claude review gate` | yes | Claude review outcome for this head |
| `Codex review credential check`, `Claude review credential check` | no | Reports only whether the provider's secret is set |
| `Codex review setup`, `Claude review setup` | no | Policy, trusted configuration, change detection and the dependency sources |
| `Codex review / onchain-midi-player`, `Claude review / onchain-midi-player` | no | The credential-bearing review run |
| `Codex review comment`, `Claude review comment` | no | Publishes the bot comment |
| `Review helper tests` (`review-helpers.yml`) | optional | Runs `test_review.py`, shellcheck, and actionlint on every workflow |

The merge gate is the pair of required gates: a HIGH finding from either
provider fails that provider's gate, so one clean provider cannot override the
other. A required-check change is a ruleset change; these workflows do not make it.

### Events

Reviews run on `opened`, `synchronize`, `reopened`, `ready_for_review`, and on
`edited` only when the base branch changed (`github.event.changes.base`), so a
retargeted pull request is reviewed against its new base. A title or body edit
starts no job and joins a separate concurrency group, so it never cancels a
review in progress. GitHub reports a job skipped by a condition as successful,
so in such a run the gate job carries a different name, "… review gate (title
or body edit, not evaluated)". It can never stand in for the required gate,
and the gate from the latest real run stays in force.

## Configuration

| Name | Kind | Use |
| --- | --- | --- |
| `CODEX_REVIEW_MODEL` | Actions variable | Codex model, passed as `codex exec -m` |
| `CODEX_REVIEW_EFFORT` | Actions variable | Codex reasoning effort, passed as `-c model_reasoning_effort="…"` |
| `CLAUDE_REVIEW_MODEL` | Actions variable | Claude model, passed as `--model` and `ANTHROPIC_MODEL` |
| `CLAUDE_REVIEW_EFFORT` | Actions variable | Claude effort, passed as `--effort` |
| `CODEX_AUTH_DOT_JSON` | secret | Codex `auth.json`, written to a fresh `CODEX_HOME` for the run only |
| `CLAUDE_CODE_OAUTH_TOKEN` | secret | Claude Code OAuth token for the base action |

The Provable-Games organization already defines all six; repository-level
secrets or variables with the same names override them for this repository
only. There are no in-repository defaults. To change a model or effort, edit the
organization variable or create a repository variable with the same name. The
next run uses the new value without any file change. The organization variable
`CODEX_CLI_VERSION` is not read.

If a provider's secret or either of its variables is not set (empty or not
visible to this repository), that provider's setup job chooses the policy
`unconfigured`: no review job runs, the setup job emits a warning naming what is
missing, and the gate passes with "Review skipped: not configured for this
repository (…)". The setup job receives only whether the secret is set, from
the separate credential-check job (`secrets.NAME != ''`), never its value. The
setup job must not reference the secret itself: a job that references a secret
masks it, line by line for the multi-line `auth.json`, and GitHub then drops any
job output containing a masked string, such as `{` in the matrix JSON. This is deliberately not fail-closed:
it lets the workflows land before the credentials exist. Once the gates are
required checks, removing a secret turns them into skips, so watch for the
warning.

Validation of set values happens before any paid run, and errors name the variable:

- Missing or empty values skip the review (see above); the review job's own
  check still fails if a value disappears between setup and review.
- Model IDs must match `[A-Za-z0-9][A-Za-z0-9._:@/-]*`, with an optional
  `[suffix]` such as `[1m]`. Efforts must be lowercase slugs.
- The model each provider reports must equal the configured variable: the Codex
  CLI header and Claude's init message are checked after the run, and a
  mismatch fails the review. Configure a full model ID, not an alias such as
  `opus`, because an alias resolves to a different ID.
- Claude Code 2.1.288 ignores an unknown `--effort` value with only a warning
  and does not report effort in its transcript. The workflow therefore accepts
  only the values listed in `providers.claude.accepted_effort_levels`. That list
  is the vocabulary of the pinned CLI, not a default; update it in the same pull
  request that moves the Claude action pin. The docs say an effort the selected
  model does not support falls back to the next lower supported level, and no
  workflow can observe that. `CLAUDE_CODE_EFFORT_LEVEL` would override
  `--effort`, so the action step clears it.
- Codex sends `model_reasoning_effort` to the API without checking it locally;
  an unsupported value is expected to fail the API request. After the run, the
  result step requires the CLI header to show exactly the configured `model:`
  and `reasoning effort:`, which proves what was sent.

### Codex credential lifetime

`CODEX_AUTH_DOT_JSON` is a ChatGPT-mode `auth.json` with an access token and a
refresh token. It is organization-managed and shared with other repositories.
Each run writes it to a fresh `CODEX_HOME`. Codex may refresh the tokens during
the run, but the workflow discards that file afterwards and never writes
secrets. If the refresh token expires, is revoked, or rotates when used
elsewhere, the stored secret goes stale and every Codex review fails until an
organization admin replaces it.

The failure is explicit. The review comment reads "Review not completed: Codex
authentication failed: the org secret CODEX_AUTH_DOT_JSON needs to be refreshed
(or switch to an API-key credential)", and the `Codex review gate` fails with
the same message. The result step recognizes the pinned CLI's refresh-failure
messages ("Your access token could not be refreshed…", "Please log out and sign
in again") and HTTP `401 Unauthorized`. Any other CLI failure reports its exit
status with a hint to check the secret. The log is printed only when it contains
no credential value.

Persisting refreshed tokens back into the secret, or switching to an API-key
credential, is an organization-level decision. These workflows do neither.

## Pins

Each pin has one place:

- Codex CLI: `codex-cli/package-lock.json` (`@openai/codex` 0.160.0, with
  integrity hashes for every platform package, including linux-arm64).
  Installed with `npm ci --ignore-scripts`. To update it, run
  `npm install --package-lock-only --ignore-scripts @openai/codex@<version>` in
  `codex-cli/`, then re-check the `codex exec` flags this workflow uses.
- Claude: `anthropics/claude-code-action/base-action@<sha> # v1.0.240` in
  `claude-review.yml`. The base action installs Claude Code 2.1.288 through the
  official installer and runs it with Bun 1.3.14. When moving it, re-check
  `--effort`, `--restricted`, `--setting-sources`, `--strict-mcp-config`,
  `--tools`, the `CLAUDE_WORKING_DIR` handling, the environment variables the
  action passes through, and the execution-file format, and update
  `accepted_effort_levels`.
- Every other action is pinned to a full commit SHA with a version comment.

All jobs run on `ubuntu-24.04-arm`. Both CLIs publish linux-arm64 builds.

## Policies

| Situation | Gate |
| --- | --- |
| Draft pull request | Passes with "Review intentionally skipped: draft PR". Marking it ready runs the review. |
| Fork pull request (including a deleted fork) | Fails with "AI review unavailable for fork PRs". The review job never runs for a head repository other than this one, whatever the repository's fork-secret setting, and a skipped job would count as success. A maintainer must review the fork's changes manually; only code a maintainer has reviewed and trusts may be mirrored to a branch here. |
| Dependabot pull request (author or sender `dependabot[bot]`) | Fails with "AI review unavailable for Dependabot PRs". Dependabot runs receive no Actions secrets, so a maintainer reviews the update manually. Giving Dependabot review credentials (Dependabot secrets) is an organization decision. |
| Title or body edit | No review and no required check (see Events) |
| Secret or model/effort variable not set | Passes with "Review skipped: not configured for this repository (…)" and a setup warning naming the missing secret or variable. Checked after the fork, Dependabot and draft rules. |
| Base without review configuration | Fails setup, unless the base is `main` (see Bootstrap) |
| No changed files (git and GitHub agree) | Passes with an explicit skip notice |
| Git finds no changes but GitHub reports some | Fails: a detection failure is not an empty diff |
| Invalid variable value, or a secret that disappears after setup | Fails, naming the variable or secret |
| Expired, revoked or rejected Codex credential | Fails with "Codex authentication failed: the org secret CODEX_AUTH_DOT_JSON needs to be refreshed (or switch to an API-key credential)" |
| Claude transcript without an init message, from another working directory, session or file, with a non-read-only tool, or with another model | Fails; a final result alone is never accepted |
| Trusted configuration changed during the run | Fails before any result is recorded |
| Dependency sources cannot be prepared (Scarb install, fetch, a lockfile out of date, upload or download) | No effect on the gate by itself: a warning names the step, the review runs, and its prompt says the sources are unavailable |
| CLI failure, cancellation, timeout, missing or blank output | Fails. Partial output from a failed run is discarded, even `lgtm`. |
| Output that is not exactly `lgtm`, valid findings, or `Review incomplete: …` | Fails as incomplete; the raw text is shown in the comment |
| Output containing a credential value in any detected form | Fails; the output is withheld |
| Result for a different base or head, or a newer head at publish time | Fails; nothing is published for a stale head |
| Complete review with only MEDIUM or LOW findings | Passes; the findings stay visible |
| Skill opportunities: bullets or `none`, including severity words, locations and fenced examples | No effect: recorded as `skill_opportunities` and shown in the comment, never read by the gate. A finding or heading inside the section makes the review incomplete (see Output contract and parsing) |
| Complete review with a CRITICAL or HIGH finding | Fails after the comment is published |

## Output contract and parsing

A complete clean review's verdict is exactly `lgtm`. Otherwise the output is
only findings in the form defined in `review-policy.md`:

```text
### [HIGH] src/base64.cairo:123 — concise issue
- **Evidence/trigger:** …
- **Impact:** …
- **Recommended action:** …
```

The policy and the last line of the prompt tell the model to start with `lgtm`
or `### [`, end with the Skill opportunities section (below), and write
nothing else before, between or after them.
`review_lib.parse_review` is deterministic and fails closed:

- Finding headings count only outside code fences, and every field is required.
- Unknown severities, a missing line number, `lgtm` next to any other text, and
  any other heading or line that starts like a finding (a severity tag followed
  by a location, such as `**HIGH** b.js:2`) make the review incomplete,
  wherever they appear. Severity words in prose or in code examples are ignored.
- Inside a finding, list semantics apply: after a blank line, only a field
  bullet, a list item, an indented line or a code fence continues it. An
  unindented prose paragraph between or after findings makes the review
  incomplete.
- One bounded tolerance: up to three lines (500 characters) of prose before the
  first finding, without a code fence or `lgtm`, are discarded when every
  finding is valid. If that prose names a severity (CRITICAL, HIGH, MEDIUM or
  LOW, in any case) or a `path:line` location, the whole output is incomplete
  instead, because it could describe an issue the gate would miss. The result
  records a warning and the discarded text, and the comment shows that text in
  a collapsed "Discarded text before the first finding" block after the
  findings. Models sometimes add a sentence such as "I've finished
  reading the files", and rejecting an otherwise valid review for it adds
  noise without adding safety.

### Skill opportunities (non-blocking)

The reviewer role also checks the agent skills in
`plugins/onchain-midi-player/skills/` against the change. A skill that the pull
request makes wrong, or that misses a new capability, is an ordinary finding at
the skill's file and line (at least MEDIUM when it would lead an integrator or
composer to broken output, LOW for stale but harmless wording), so it counts
like any other finding. `scripts/skills.test.mjs` covers the mechanical drift;
the reviewer looks for drift in meaning.

Separately, every completed review ends with a section of suggestions for
refining a skill or adding one, or `none`:

```text
lgtm

## Skill opportunities

- **Refine `midi-guide`** (`plugins/onchain-midi-player/skills/midi-guide/SKILL.md:40`): … Evidence: `player/player.js:120`.
```

`parse_review` splits the output at the first `## Skill opportunities` heading
(`###` and any letter case also count) outside a code fence and parses the part before it exactly as
above. The section is recorded as `skill_opportunities` in `result.json`
(`"none"` or the Markdown text; the key is absent when the model omitted the
section, so older output parses as before, and `schema` stays 1) and shown in
the comment under **Skill opportunities** (non-blocking). `blocking` and the
gate read only the findings, so nothing in the section, including severity
words, locations or a fenced finding heading, can change the gate. A finding
heading, any other heading, a line that starts like a finding, a bare `lgtm`
or an unterminated code fence inside the section still makes the review
incomplete: a finding written after the section is never dropped silently.

## Static review and dependency sources

Both reviews are static. The reviewer reads the code and the review context,
but it has no network access and the project's toolchains are not installed:
the required CI checks (`cairo`, `javascript`, `generated`, `browser`) build
and test every head. The shared policy therefore keeps `Review incomplete` for
missing review material (git history or the merge base, a diff or changed file
too large to read or unreadable, truncated output), and states that a build,
test, tool or dependency fetch that cannot run is expected and is not such a
reason. Before this rule, Codex answered pull request #22, which replaced the
base64 encoder with a git dependency, with "Review incomplete" because it could
neither fetch the dependency nor run Scarb.

So that a dependency change can still be judged on its source, the setup job
fetches the head's Scarb dependencies for the review job:

1. Only for the `review` policy, it installs Scarb with
   `software-mansion/setup-scarb` (the SHA `ci.yml` uses) at the version in the
   head's `.tool-versions`, without a cache.
2. In a copy of the head (`git archive`), never in `src/`, it runs
   `scarb --no-proc-macros fetch` and then
   `scarb --offline --no-proc-macros metadata` for the root package and
   `examples/beast_consumer`. Scarb 2.20.1 has no `--locked` flag, so the step
   stops if either command changed a committed `Scarb.lock`.
3. For each git and registry package in the metadata, it copies the source to
   `$RUNNER_TEMP/deps/<package>@<locked commit or version>`. A git dependency
   gets its whole repository at the locked commit (checked with
   `git rev-parse HEAD`), without `.git`; a registry package gets its published
   files without `target/` (prebuilt plugin binaries). Package names and
   revisions are validated before they become paths. `SOURCES.txt` gives each
   package's directory and its `source`. Links and special files are deleted.
4. It uploads the directory as the `codex-dependency-sources` (or
   `claude-dependency-sources`) artifact. The publish and gate jobs read
   results from `codex-review-*` (`claude-review-*`), which never matches it,
   so no file in a dependency can pose as a review result.

The review job downloads the artifact to `$RUNNER_TEMP/deps`, deletes anything
but regular files and directories, makes it read-only, and passes the path to
`review.py prompt` in `REVIEW_DEPS_DIR`. Claude also gets it as an `--add-dir`.
The prompt lists the package directories, taking only names of the form
`<package>@<revision>` from them. Each of these steps has a timeout and
continues on error: if one fails, the review still runs, and the prompt says
the dependency sources could not be prepared, which is not a reason for
`Review incomplete`.

`REVIEW_DEPS_DIR` is an environment variable rather than an option because the
helpers come from the base revision, and a base revision whose helpers predate
it must ignore it rather than fail.

Security, within the trust boundary below:

- Fork and Dependabot pull requests never reach the fetch, because it runs only
  for the `review` policy. The setup job holds no secret and only
  `contents: read`, so no runner that processes the pull request's manifests
  later holds a credential, and Scarb is never on the review job's `PATH`,
  which Codex's sandbox inherits.
- The fetch only downloads: nothing is built, and `--no-proc-macros` stops Scarb
  loading any procedural macro or plugin. The Scarb version comes from the
  head, but `setup-scarb` installs only official Software Mansion releases.
- The review still runs in Codex's read-only sandbox, behind the unchanged
  write and network probes, or with Claude's read-only tools. Dependency
  sources are review material: `AGENTS.md` and `CLAUDE.md` files in them do not
  load as instructions (`project_doc_max_bytes=0` for Codex,
  `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=0` for Claude).

## Comments

Each provider keeps one bot comment per reviewer. A comment belongs to a
provider and reviewer only if `github-actions[bot]` (type `Bot`) wrote it and
its first line is exactly the hidden marker
`<!-- onchain-midi-player-ai-review:<provider>:<agent> -->`. Both providers post as the
same bot, so a comment that merely quotes another marker, including the other
provider's comment, is never edited or deleted. A second hidden comment records
the base, head, merge base, configuration revision, model, effort and run.

Every comment, clean or not, starts with one visible heading built from the
result record, for example:

```text
**Claude review** · model `<CLAUDE_REVIEW_MODEL>` · effort `<CLAUDE_REVIEW_EFFORT>` · head `0123456789ab`
```

It shows the requested model and effort, and adds `(resolved …)` when the
provider reported a different model ID (which also fails the review). A
bootstrap review shows a BOOTSTRAP notice below the heading. A clean review's
body is then `lgtm`; findings and failures follow the same heading. A completed
review's Skill opportunities follow its verdict or findings, as one line
`**Skill opportunities** (non-blocking): none` or a short list. The heading is
only presentation: the model's verdict must still be exactly `lgtm`, and the
gate reads `result.json`, never comment or review text. A
failed or incomplete run replaces an earlier verdict with "Review not
completed", so an old `lgtm` never stays under a new head.

## Trust boundary

- The workflows use `pull_request`, not `pull_request_target`. Top-level
  permissions are empty. Review jobs have `contents: read`, and only the comment
  job has `pull-requests: write`.
- The review job runs only when the setup job chose the `review` policy and the
  head repository is this repository. Forks and Dependabot never reach a job with
  secrets. The setup job sees only a true/false flag for the secret, computed
  by the credential-check job, which has no permissions and runs no code.
- Configuration, prompts and helpers come from the pull request's **base
  revision**, checked out sparsely into `trusted/`. The head is checked out
  separately into `src/` with `persist-credentials: false` and is only read:
  no install scripts, hooks or helpers from the pull request run. Every helper
  runs as `python3 -I -B`, so neither the working directory, `PYTHON*`
  variables, user site-packages nor stale bytecode can supply a module.
- The review job fingerprints `trusted/.github` before the provider runs and
  verifies it afterwards; the result is recorded only if nothing changed.
- Codex runs with a fresh `CODEX_HOME` holding only `auth.json`, with
  `--ignore-user-config --ignore-rules --sandbox read-only --ephemeral` and an
  environment reduced to `HOME`, `PATH`, `CODEX_HOME`, locale and terminal
  variables. Codex reads `.env` only from `CODEX_HOME`. A trusted Codex home
  would load the pull request's `.codex/` layer, including MCP server commands.
  `-c project_doc_max_bytes=0` stops Codex loading the pull request's
  `AGENTS.md` and `AGENTS.override.md` as instructions, and
  `-c skills.include_instructions=false` keeps its `.agents/skills` and
  `.codex/skills` out of the prompt. Codex can still read those files as data.
- Before the Codex review, the sandbox must run `git`, refuse a write, and fail
  an HTTPS request to `api.github.com` that succeeds from the runner outside the
  sandbox; both curl exit codes are logged. This proves that the read-only
  sandbox blocks a TCP and TLS connection the runner itself can make. It does
  not prove that every protocol is blocked. Reads are not blocked: the sandbox
  can read `auth.json`, which is why the output is screened.
- Claude runs through the base action, so no GitHub token or GitHub tools reach
  it. The action changes into `CLAUDE_WORKING_DIR` and runs Bun there, and Bun
  loads `bunfig.toml` (including preload scripts) and `.env` files from that
  directory. `CLAUDE_WORKING_DIR` is therefore an empty trusted directory under
  `$RUNNER_TEMP`, verified empty first. The checkout and the precomputed
  context are passed to Claude with `--add-dir` as read-only data.
- Claude uses `--restricted --setting-sources user --strict-mcp-config
  --permission-mode dontAsk --tools Read,Glob,Grep`, so project settings, hooks,
  `CLAUDE.md`, `CLAUDE.local.md`, `.claude/` rules, skills, commands and agents,
  and `.mcp.json` servers from the pull request do not load. `--setting-sources`
  must stay `user`: the base action treats an empty value as absent and loads
  every source.
- The action step presets every variable it would pass through:
  - `ANTHROPIC_MODEL` is set to the validated model.
  - `CLAUDE_CODE_EFFORT_LEVEL` is cleared.
  - `CLAUDE_CONFIG_DIR` is set to `~/.claude`.
  - Auto memory is disabled, and `CLAUDE.md` loading from added directories is
    off.
  - The proxy variables, `NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS`, `BUN_OPTIONS`
    and the Bun registry settings are cleared.
- The result step fails the review if Claude's init message is missing, reports
  another working directory, session or model, or reports any tool that runs
  commands, writes, delegates or reaches the network. It also fails if the
  execution file is not the action's own output file.
- The pull request title and body are read from the event file and placed
  between random delimiters as untrusted data. They are never interpolated into
  shell code.
- Before upload, the result step withholds any output that contains a secret
  value or one of its long string leaves. It checks the literal, JSON-escaped,
  reversed, hex (both cases), and standard and URL-safe base64 forms at every
  byte alignment, also after removing whitespace, and includes refreshed Codex
  tokens. Residual risk: a copy split into pieces with other characters between
  them, a partial copy, or another encoding is not detected. Only `result.json`
  and the review text are uploaded, for one day.
- The comment job checks the current head through the API before writing, and
  runs the base revision's helpers without secrets.
- The setup job fetches the head's Scarb dependency sources for the reviewer,
  without building anything or loading a procedural macro (see Static review
  and dependency sources).
- This repository is private. If the base commit is missing from the full-history
  checkout (the base moved after the event), the trusted-configuration step's
  fallback `git fetch` runs without credentials (`persist-credentials: false`)
  and fails. That fails setup and the gate; it never selects other code. Re-run
  the workflow.

Under `pull_request`, GitHub runs the workflow YAML from the pull request merge
commit. A same-repository author can therefore change these workflows, but such
an author can already push workflows that run with secrets. A fork pull request
gets no secrets, but its own edited workflow runs and can report a passing
check named `Codex review gate` or `Claude review gate`. Taking helpers and
prompts from the base revision stops a pull request from weakening its own
review policy without visibly editing a workflow. Recommended settings, which
these workflows do not change:

- Keep "Require approval for all outside collaborators" (or stricter) for fork
  pull request workflows.
- Require the two gates in the `main` ruleset with GitHub Actions as the
  expected source.
- Require code-owner review of `.github/**` (a `CODEOWNERS` entry plus a
  ruleset rule).

## Bootstrap

A base revision without `.github/review-agents.json` normally fails setup with
"Base branch '…' has no .github/review-agents.json. Bootstrap from the pull
request head is allowed only for: main." The one exception
(`BOOTSTRAP_BASE_BRANCHES: main` in both workflows) is the one-time path by
which the review configuration reaches `main`: a pull request into `main`
while `main` lacks it uses the configuration from the pull request head. The
run emits a `::warning::`, the step summary says BOOTSTRAP, the result records
`bootstrap: true`, and the comment shows a BOOTSTRAP notice. The normal
completion and severity rules still apply. Once `main` carries the
configuration, the exception no longer applies and can be removed. A base
revision that has `review-agents.json` but lacks a prompt or helper fails setup;
it never falls back to the head.

## Tests

```bash
python3 -I -B -m unittest discover -s .github/scripts -p 'test_*.py' -v
shellcheck .github/scripts/*.sh
actionlint .github/workflows/*.yml
```

The tests need Python 3.9 or later (CI uses the runner's Python), Git and Bash; the dependency fetch tests also
need `jq` and `timeout`, as on the runner, and are skipped without them. They replace `gh`, Scarb and the Codex CLI
with local fakes. Set `REVIEW_TEST_BUN` to a Bun 1.3.14 binary to also run the
test showing that the action's Bun step loads no `bunfig.toml` or `.env` from
the checkout. The tests cannot show that real credentials, runners or provider
models work; only a real Actions run can.
