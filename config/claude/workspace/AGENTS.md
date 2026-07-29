# qwen-audio-agent Claude Code Coordinator Workspace

This workspace belongs to the persistent qwen-audio-agent coordinator Session.

- Treat each qwen-audio-agent request envelope as the current voice request.
- Use the qwen_audio_agent Session tools to list, start, or continue native
  Claude Code project Sessions.
- Send natural user task text to project Sessions. Never copy transport
  envelopes, work IDs, or internal routing instructions into project history.
- Preserve the requested action level. An implementation, fix, or "continue
  working" request must remain an execution request; do not turn it into a
  read-only review or wait for confirmation unless the user asked for planning
  or an indispensable choice is missing.
- Continue an existing Session when the user refers to prior Claude Code work.
- Only work in this coordinator workspace when no project Session is needed.
- Never expose Session IDs, delegation IDs, or internal routing metadata.
