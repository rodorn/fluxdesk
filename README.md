# Fluxdesk

One window for every Claude Code session you have running.

Fluxdesk replaces a screen full of terminal windows with a single browser page:
every conversation in one list, with its state, what it is doing right now, what
it costs, and whether it is waiting for you. Sessions keep running when you close
the tab, and a small CLI client lets you drop back into any of them from a shell.

Built because 22 forgotten `claude` processes were sitting in separate terminals,
eating 5.3 GB, with no way to tell which one needed an answer.

> Interface language is Polish. Code comments are Polish as well; commit messages
> and this document are English.

## What it does

**Sessions.** Every session in one list with a real state (working, waiting for a
decision, idle), the current activity, context usage and cost. Switch with digits
`1`-`9`, jump by name with `S`, put two side by side with `O`. New sessions start
with a name, directory, model and permission mode in one dialog.

**Real terminals.** Each session is an actual `claude` process in a pty, rendered
with xterm.js, so every CLI command works. A host process owns the pty, which
means restarting or rebuilding the panel does not interrupt the work.

**Watchdog.** Answers the resume prompt that silently blocks a session for hours,
flags sessions repeating the same activity, and feeds queued tasks to a session
as it frees up.

**Tasks.** Own task store with a workflow that separates "done working" from
"closed": `to_do`, `in_progress`, `do_poprawy`, `zlecone`, `testowanie`,
`feedback`, `zrobione`. Tags, assignees, subtasks, blockers, recurrence, time in
each status, a board view, and a one-line syntax: `fix the importer #project
@someone !! za 3d co 7d ~30m`. Imports from taskwarrior and exports back.

**Knowledge.** Search across every transcript on the machine, edit `CLAUDE.md`
and per-project memory, keep a version history of memory edits, and export a
bounded summary of a user profile into the global instructions so every session
knows who it is talking to.

**Money and time.** Cost per conversation, per project and per period, a forecast
of when the weekly limit runs out, real working time measured from five-minute
activity windows, and a count of how often you switch between sessions.

**Calendar.** Google and Microsoft in both directions, several accounts of the
same provider side by side. Type a sentence like `dentist wednesday 4pm`: the
parser handles the date, and when the length is missing a model estimates it
through a tool call, so a dentist visit gets 45 minutes rather than a default
hour. Everything stays editable before saving. Blocks written from the panel
appear in every connected account, conflicts are detected across all calendars
at once, and `find a free slot` returns windows free everywhere. Online meetings
carry a join link pulled from Teams, Meet, Zoom, Whereby, Jitsi and Webex.
Busy-time mirroring copies the hours of one calendar into another as a plain
`Zajęte` block, without the title, so colleagues see the time is taken but not
why; those mirrors are hidden from your own view.

**Two languages.** The interface switches between Polish and English with the
`EN` button in the header. The dictionary maps Polish text to English, so an
untranslated string falls back to the original instead of an empty label.

**Around the work.** GitLab merge requests and issues, failed user services,
repositories with uncommitted changes, project cards, a daily journal that turns
into a standup note, a public `/status` page, and phone notifications through
ntfy when a session needs a decision.

## Requirements

- Node.js 20 or newer (tested on 22 and 26)
- [Claude Code](https://claude.com/claude-code) installed and logged in
- Linux with systemd user services (other systems work, but you start it yourself)
- Transcripts in the standard location, `~/.claude/projects`

## Install

```bash
git clone https://github.com/rodorn/fluxdesk.git
cd fluxdesk
./scripts/install.sh
```

The script installs dependencies, builds the native pty module, builds the app,
registers a `systemd --user` service and links the `fluxdesk` CLI client. The
panel then runs on <http://localhost:4317> and starts with your session.

Manual alternative:

```bash
npm install
npm rebuild node-pty
npm run build
npm start
```

## Configuration

Everything is optional; the panel works with no configuration at all.

| Variable                      | Meaning                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `PORT`                        | Panel port, default `4317`                                                       |
| `CSM_ACCESS_TOKEN`            | Required token for API access; set it before exposing the panel to a network     |
| `CSM_ALLOWED_ROOTS`           | Colon-separated directories where sessions may start; empty means no restriction |
| `CSM_DEFAULT_MODEL`           | Model for new sessions                                                           |
| `CSM_DEFAULT_PERMISSION_MODE` | `default`, `acceptEdits`, `plan` or `bypassPermissions`                          |
| `CLAUDE_CONFIG_DIR`           | Claude Code config directory, default `~/.claude`                                |
| `CSM_USD_PLN`                 | Exchange rate used for cost display, default `4.0`                               |
| `CSM_PIPEDRIVE_HOST`          | Pipedrive subdomain, if you use that panel                                       |

State lives in `~/.claude-session-manager`: tasks, schedule, prompts, attention
log, permission rules and an encrypted secrets file. Nothing leaves the machine
unless you enable phone notifications.

## Using it from a terminal

```bash
fluxdesk            # list sessions, pick one by number
fluxdesk ls         # just the list
fluxdesk attach 3   # enter a session, Ctrl+Q detaches without killing it
fluxdesk new .      # new session in the current directory
fluxdesk todo       # open tasks
```

## Keyboard

Bare keys work when you are not typing; the same key with `Ctrl+Alt` works
anywhere. Press `?` for the full list.

| Key                | Action                                        |
| ------------------ | --------------------------------------------- |
| `1`-`9`, `J`/`K`   | Switch sessions                               |
| `S`                | Jump to a session by name                     |
| `A`                | Jump to a session waiting for a decision      |
| `Y`/`A`/`N`        | Permission: allow, always, deny               |
| `N`, `T`, `R`      | New session, new terminal, resume a saved one |
| `O`, `V`, `G`, `F` | Split, full screen, grid, focus mode          |
| `Z`, `B`, `D`, `C` | Tasks, board, journal, attention              |
| `M`, `L`, `Y`, `E` | Knowledge, GitLab, machine pulse, projects    |
| `/`, `P`           | Search transcripts, command palette           |
| `Esc`              | Interrupt the current turn                    |

## Security

The panel runs commands on your machine. Two things follow from that.

**Do not expose it without a token.** Set `CSM_ACCESS_TOKEN` and sign in at
`/login` before making the port reachable from anywhere but localhost.

**Secrets stay local.** The vault is encrypted with a key stored next to it, both
`0600`. That protects against a stray backup or an accidental commit, not against
someone who already has your account. Secrets reach sessions only when you mark
them as exposed. Nothing is sent anywhere except phone notifications, which are
off by default and carry only a session name and a rule name.

A deny list blocks destructive commands regardless of permission mode, including
sessions started with prompts skipped.

## How it works

- `src/lib/terminals.ts` and `scripts/pty-host.mjs` own the pty processes; the
  panel is only a client of a unix socket, which is why it can restart freely.
- `src/lib/termstate.ts` reads session state off the terminal screen, because
  Claude Code exposes none programmatically.
- `src/lib/lightscan.ts` reads only the edges of transcript files; a full read of
  1.3 GB takes minutes, and the metadata lives at the beginning and the end.
- `src/lib/watchdog.ts` polls sessions, answers blocking prompts and feeds queues.
- Usage counting deduplicates by request id, since the CLI writes the same
  response several times while streaming.

## Licence

MIT. See [LICENSE](LICENSE).
