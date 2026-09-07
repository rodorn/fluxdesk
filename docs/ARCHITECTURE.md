# Architecture

Notes on why the pieces look the way they do. Written for whoever reads the code
next, including me in six months.

## Two engines, one list

A session is either an SDK session (`@anthropic-ai/claude-agent-sdk`) or a real
`claude` process in a pty. The SDK gives structured events: permission requests,
todo updates, token usage. The pty gives everything else, including every slash
command the CLI supports.

Both appear in one list with shared numbering. Terminals turned out to be the
common case, because parity with the CLI matters more than pretty widgets.

## Why a host process owns the pty

`scripts/pty-host.mjs` runs detached, owns the pty and exposes it on a unix
socket in `~/.claude-session-manager/terminals`. The panel connects as a client.

The alternative, holding the pty inside the web server, means every rebuild kills
every session. That is unacceptable for a tool you develop while using it.

Reconnecting replays the scrollback the host keeps in memory, so switching
sessions or reloading the page costs nothing.

## Reading state off the screen

Claude Code does not expose session state programmatically, so `termstate.ts`
parses the terminal screen: the spinner line, the status bar, permission
questions. This is fragile by nature and the tests for it are the real screens
captured while building.

Two lessons are baked in. The CLI positions the cursor instead of writing spaces,
so stripping escape sequences naively glues words together; column moves are
translated back into a space. And the ellipsis marking work in progress is not
always at the end of the line, because a counter follows it.

## One SSE stream for everything

Browsers cap parallel connections to a single origin at around six. With a dozen
sessions, one stream per session runs out immediately, so `/api/live/stream`
carries events for all of them, and clients keep per-session buffers.

## Reading transcripts

Transcripts reached 1.3 GB. Two decisions follow.

`lightscan.ts` reads only the first 64 KB and last 256 KB of each file, because
`cwd` and creation time live at the start and titles at the end. A cold `/stats`
went from 2.3 s to 97 ms once the scan cache was persisted to disk.

Usage counting deduplicates by `requestId`. The CLI writes the same assistant
message several times while streaming, and counting all copies inflated output
tokens 2.5x and cache reads 2x.

## Identifying conversations

A terminal started with `--resume` knows its session id from its own arguments.
One started fresh does not, so it is matched to a transcript by working directory
and creation time. That matching also reveals when two windows are driving the
same conversation, which would otherwise let them overwrite each other silently.

## Tasks

The workflow separates three things people usually collapse into "done": work
still ahead (`to_do`, `in_progress`, `do_poprawy`, `zlecone`), work finished but
alive (`testowanie`, `feedback`) and closed (`zrobione`). A timer stops on its
own when a task leaves `in_progress`, and every transition records how long the
task spent in the previous status.

## Storage

Everything the panel owns lives in `~/.claude-session-manager` as JSON, except
the secrets vault, which is AES-256-GCM with the key next to it, both `0600`.
There is no database, because the data is small and being able to read the state
with `cat` has been worth more than query power.
