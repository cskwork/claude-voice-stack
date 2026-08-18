# TUI Usage Notes

## Platform Differences

| Platform | Default Mode | Interruption Method |
| --- | --- | --- |
| macOS | Full-duplex with echo cancellation | Speak directly |
| Linux / Windows | Half-duplex | Press `x` during playback |

## Text and Attachment Input

In addition to voice, the TUI accepts text, images, and regular files:

- Press `t` to enter text. An `@file-path` in the text is sent as an attachment.
- Press `a` to select an image or file for the next voice or text turn.
- Press `c` to clear attachments that have not been sent.

The TUI reads attachment content and sends it to the Gateway. The realtime voice
frontend receives metadata only. When it delegates through `spawn_thinking`, the
Gateway converts the original attachments into ACP ContentBlocks for the backend
agent. Text anchors such as `[Image 1]` or `@file-path` remain bound to their file
parts for multi-attachment references, replay, and backend interpretation. Each
attachment is limited to 8 MB and the per-turn total is limited to 12 MB.

## macOS

macOS always uses CoreAudio AEC full-duplex: audio is continuously captured during playback, supporting direct-speech interruption,
without additional configuration. The CoreAudio helper program is compiled by default to
`~/Library/Caches/qwaudio/tui/macos-voice-io` and is automatically built on first launch.

## Linux / Windows

By default, half-duplex mode is used via the bundled Python audio bridge using `sounddevice` / PortAudio:
the microphone is paused during reply playback, only supporting manual interruption with the `x` key, and resumes after playback ends or is interrupted.
Before first use, install `sounddevice` and the system PortAudio.

You can also enable full-duplex mode without echo cancellation:

```bash
qwenaudio tui --audio-mode full
```

This mode has no echo cancellation; please wear headphones to avoid misrecognition or false interruptions caused by speaker audio.
Different sound cards and Bluetooth headsets have varying levels of support for simultaneous input and output streams at different sample rates; if you continuously
experience input overflow, output underflow, or device errors, please exit and fall back to `--audio-mode half`.

## Configuration

The default audio mode can also be set persistently via an environment variable:

```dotenv
QWEN_AUDIO_AGENT_TUI_AUDIO_MODE=half
```

Setting it to `full` is equivalent to `--audio-mode full`. For full parameter details, see
[Configuration](../configuration.md).
