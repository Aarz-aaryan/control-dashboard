# Voice, Echo Dot and WhatsApp

Verified 2026-11-15 from production source and owner-local deployment documentation. Service state was checked; physical audio and phone delivery were not retested.

## Shared speech plane

On **agent-server**, `whatsapp-stt.service` and `whatsapp-tts.service` keep GPU models warm behind mode-0600 Unix sockets under `~/.local/share/whatsapp-pi`.

- STT: faster-whisper large-v3-turbo, CUDA, local VAD and automatic language detection.
- TTS: Kokoro-82M, `af_heart`; output uses pitch-preserving 1.25× playback.
- Browser voice can request PCM; WhatsApp uses Ogg/Opus voice notes.
- Workers use cached weights/offline model loading. Pi's reasoning provider remains separate.

These historical service names do not imply that voice depends on the old OpenWA gateway. Speech workers are shared; conversations and transports are not.

## Browser / terminal voice

Production source: `/home/Aarz/pi-live-voice`.

The installed native voice extension attaches the current Pi harness through an owner-only Unix socket. Browser microphone/speaker audio travels over WebRTC to the loopback audio service (`127.0.0.1:8797`). The default browser path launches **no separate Pi brain**. An explicit standalone prototype flag is historical/developer-only.

`/voice on`, `/voice off`, `/voice status`, `/voice open` belong to the attached harness. Turning audio off does not stop Pi or ongoing tools. Approval dialogs stay in that harness; private thinking/raw tool arguments are not spoken. Browser voice supports interruption, but completed actions are not rolled back.

Remote microphone access requires a browser on the user's device and a secure context: an SSH localhost forward or explicitly approved private HTTPS proxy. Do not expose the loopback HTTP listener publicly. Private owner access links/cookies must not be committed or pasted into documentation.

## Echo Dot: independent automatic conversation

```text
Echo custom Wyoming interface → home Wi-Fi → homescreen relay
  → restricted SSH forwarding over Tailscale → agent-server loopback :18700
  → Echo adapter → dedicated Pi conversation + shared GPU speech
```

- Wake word: Alexa. No browser microphone, Home Assistant, or manual `/voice on` is required for Echo.
- homescreen runs `~/echo-pi-relay/echo_relay.py` via `echo-relay.service`; it handles device discovery and forwarding, not speech models.
- Relay credentials are restricted to the loopback forward, not general shell access.
- Server adapter: `echo_transport.py`, `echo_sessions.py`, separate `ECHO_SYSTEM.md`; enabled by the private `state/echo.enabled` marker.
- About 30 seconds of quiet returns the device to wake-word mode without discarding the conversation.
- Three hours of inactivity expires context. Active work prevents expiry. Disconnects do not cancel tasks; an unexpired conversation can resume after restart.
- Echo has a separate session pointer from browser/terminal Pi. Resetting context does not erase memories, history files or completed actions.
- Spoken barge-in is **disabled for Echo** to prevent speaker feedback. Microphone audio is silenced during playback and for a 0.6-second tail. Use the action button to stop playback.
- Approvals are not automatically granted. Owner-local approval/reset helpers are privileged controls, not public APIs.

Read-only checks:

```sh
python3 ~/pi-live-voice/echo_status.py
systemctl --user status pi-live-voice.service
# On homescreen:
systemctl --user status echo-relay.service
```

`waiting-for-wake-word` means ready; `waiting-for-tunnel` means the device/relay is unavailable. Browser `waiting-for-harness` does not mean Echo is broken. Prior physical/USB and synthetic tests do not establish a successful natural conversation over the home Wi-Fi path; that remains an owner acceptance check.

## WhatsApp: independent Pi integration

Upstream: [RaphaCastelloes/whatsapp-pi](https://github.com/RaphaCastelloes/whatsapp-pi). The local checkout has deployment patches and is **not** an Aarz-owned upstream repository.

`whatsapp-pi.service` runs a dedicated tmux/Pi process with profile `~/.pi/whatsapp-agent`. Authentication uses Baileys/WhatsApp Web, not OpenWA or the Business API. Pairing and allowlists remain private. Unauthorized contacts/groups must not invoke Pi; trusted LID-to-phone mapping fixes identity matching without broadening the allowlist.

The three-hour idle policy creates a new Pi conversation **without restarting the WhatsApp transport, process or speech workers**. In-flight turns/media/compaction/queued work prevent rotation. Old JSONL histories remain local. Transport callbacks rebind to the replacement runtime.

Voice input normally gets a voice reply; text gets text. Explicit reply-format controls override this. Failed synthesis/upload falls back to text. Generated message identity tracking prevents self-chat audio feedback.

```sh
systemctl --user status whatsapp-pi.service
systemctl --user status whatsapp-stt.service whatsapp-tts.service
```

Do not run upstream `npm test` against the real HOME: upstream storage tests can overwrite live allowlists. Deployment regression tests use the owner-local isolated test wrapper. This documentation update did not rerun model/GPU/phone integration tests.

## What was retired

The owner's previous WhatsApp/OpenWA deployment was removed on 2026-10-31. The later standalone WhatsApp-Pi authorization does not restore OpenWA containers, watchdogs, QR jobs, scheduled WhatsApp delivery, or old credentials. Discord remains the scheduler's delivery channel.

## Evidence and source gaps

`pi-live-voice/README.md`, `README-ECHO.md`, `config.py`, `server.py`, `echo_transport.py`, `echo_sessions.py`; `~/.local/share/whatsapp-pi/SETUP.md` and `voice-worker.py`; local WhatsApp diff. Voice has no configured Git remote in the inspected checkout. Local patches, supervisor code and the restricted homescreen relay need a separate reviewed source-publication pass; no auth/state/firmware signing keys belong in that publication.
