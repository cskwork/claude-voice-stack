# RAM and latency benchmark

Fill this in on the reference Mac. Numbers below are placeholders until measured;
the product does not promise them.

## Environment

| Field | Value |
|---|---|
| Mac model | (e.g. MacBook Pro 14" M-series) |
| Unified RAM | |
| macOS | 26.6.2 |
| Python | 3.12.11 |
| Node | 22.22.3 |
| speech-to-speech | 1.0.0 |
| Supertonic | 1.3.1 |
| STT | mlx-community/parakeet-tdt-0.6b-v3 |
| GLM endpoint | (host, model id) |
| Claude Code | 2.1.269 |

## Procedure

Measure RSS per managed process with `voice-agent status` (sums `ps -o rss`) and
whole-system figures with `memory_pressure` and `vm_stat`. Take each row after
the state has been stable for one minute.

| Step | State | RSS s2s | RSS gateway | RSS claude | Total used | Pressure | Swap |
|---|---|---|---|---|---|---|---|
| 1 | baseline macOS, normal apps open | – | – | – | | | |
| 2 | Gateway only (`node scripts/start.mjs`) | – | | – | | | |
| 3 | + speech-to-speech with STT loaded | | | – | | | |
| 4 | + Supertonic loaded (first synthesis done) | | | – | | | |
| 5 | + full voice session (TUI connected, 5 turns) | | | – | | | |
| 6 | + Claude task running | | | | | | |
| 7 | after 10 minutes of use | | | | | | |
| 8 | after 30 minutes of use | | | | | | |

Acceptance (PRD section 15): no unbounded growth between rows 5, 7 and 8; one
speech-to-speech pipeline (`GET /v1/pool` size 1); one Parakeet and one
Supertonic load (check `logs/speech-to-speech.log` for a single "loaded"
line each); memory returns near row 5 after the Claude task completes.

## Latency

Use `--debug-transcripts` for one run only and read timestamps from
`logs/speech-to-speech.log`; GLM time-to-first-token is printed by
`voice-agent smoke-glm` (streaming row).

| Stage | Target | Measured (median of 10) |
|---|---:|---|
| speech end → final STT | < 700 ms | |
| STT result → first GLM token | < 800 ms | |
| trivial turn → TTS begins | < 1.5 s | |
| delegation acknowledgement | < 1.5 s | |
| interruption → playback stop | < 250 ms | |
| backend completion → spoken notification | < 1.5 s | |

## STT quality (Korean / English)

Record the same 10 sentences per language with the stack's microphone path and
compare `parakeet-tdt` against `whisper-mlx` (word error rate or a simple
"constraint preserved" count). The integration test
`scripts/voice-stack/test/integration/realtime-loop.test.mjs` already checks one
English and one Korean sentence synthesised by Supertonic.
