/** Actionable UI text; receipt codes remain unchanged in controller evidence. */
export function voiceErrorMessage(code) {
  const messages = {
    voice_input_unconfirmed: 'Native voice did not confirm a complete instruction in time. Listening stopped and this unconfirmed input was not submitted. Switch to Local ASR in Voice settings, speak the complete instruction, then click Send voice utterance. No provider was switched automatically.',
    voice_invalid_settings: 'Choose a registered Codex account and a supported input voice in Voice settings. No other account will be used.',
    voice_narration_unavailable: 'Speech output is unavailable in this browser. Read the answer in chat or enable an installed browser/OS voice; your task was not cancelled.',
    voice_narration_blocked: 'The browser blocked speech playback. Allow audio playback and try again; the answer remains in chat.',
    voice_narration_zero_audio: 'The speech engine produced no playable audio. The answer is available in chat.',
    'voice_narration_zero-audio': 'The speech engine produced no playable audio. The answer is available in chat.',
    voice_narration_timeout: 'Speech output timed out and playback was stopped. Read the answer in chat; your task was not cancelled.',
    voice_narration_unconfirmed: 'The speech engine did not confirm playback. Read the answer in chat.',
    voice_narration_failed: 'Speech playback failed. Read the answer in chat; your task was not cancelled.',
    voice_fresh_turn_required: 'Listening resumed. Please say the command again; delayed input from before the pause was not submitted.',
  };
  return messages[code] || code;
}
