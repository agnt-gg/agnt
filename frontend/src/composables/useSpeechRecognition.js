import { ref, onUnmounted } from 'vue';
import { API_CONFIG } from '../../user.config.js';
import { authHeaders } from '@/utils/apiFetch.js';
import { MIC_CONSTRAINTS } from '@/voice/micConstraints.js';

// PRD-063: recordings shorter than this are discarded client-side. A click-then-
// immediate-click on the mic button produces ~200ms of audio that Whisper tiny.en
// reliably hallucinates on ("I'm a very happy person." repeated dozens of times).
const MIN_RECORDING_MS = 400;

export function useSpeechRecognition() {
  const isListening = ref(false);
  const isSupported = ref(true); // Always supported with Whisper
  const isTranscribing = ref(false); // PRD-063: true while awaiting the backend transcription
  const transcript = ref('');
  const error = ref(null);

  let mediaRecorder = null;
  let audioChunks = [];
  let stream = null;
  let recordingStartedAt = 0;

  // Detect if running in Electron
  const isElectron = navigator.userAgent.toLowerCase().includes('electron');

  /**
   * Start recording audio using Whisper
   */
  const startWhisperRecording = async () => {
    try {
      // `{ audio: true }` accepts the browser's defaults, which include noise
      // suppression and auto gain — the two things that chew the first syllable
      // off a sentence. See micConstraints.js.
      stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      audioChunks = [];

      // Use webm format for better compatibility
      const options = { mimeType: 'audio/webm' };
      mediaRecorder = new MediaRecorder(stream, options);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log('Recording stopped, processing audio...');

        try {
          // PRD-063 gate 1: discard too-short recordings instead of shipping
          // them to Whisper, which hallucinates on near-empty audio.
          const recordingMs = Date.now() - recordingStartedAt;
          if (recordingMs < MIN_RECORDING_MS) {
            console.log(`Recording too short (${recordingMs}ms < ${MIN_RECORDING_MS}ms) — discarded`);
            error.value = 'Recording too short — hold the mic a bit longer.';
            return;
          }

          // Create blob from recorded chunks
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

          // Send to backend for transcription
          const formData = new FormData();
          formData.append('audio', audioBlob, 'recording.webm');

          console.log('Sending audio to Whisper for transcription...');
          isTranscribing.value = true;

          const response = await fetch(`${API_CONFIG.BASE_URL}/speech/transcribe`, {
            method: 'POST',
            // authHeaders, not jsonAuthHeaders: setting Content-Type on a
            // FormData body suppresses the browser-generated multipart
            // boundary and the upload arrives unparseable.
            headers: authHeaders(),
            body: formData,
          });

          if (!response.ok) {
            throw new Error(`Transcription failed: ${response.statusText}`);
          }

          const result = await response.json();

          if (result.success && result.transcript) {
            transcript.value = result.transcript;
            console.log('Transcription successful:', result.transcript);
          } else if (result.success) {
            // PRD-063: backend silence gate returned an empty transcript —
            // that's a valid "no speech" outcome, not a failure.
            console.log('No speech detected in recording');
            error.value = 'No speech detected.';
          } else {
            throw new Error(result.error || 'No transcript returned');
          }
        } catch (err) {
          console.error('Error transcribing audio:', err);
          error.value = 'Failed to transcribe audio. Please try again.';
        } finally {
          isTranscribing.value = false;
          // Clean up
          if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            stream = null;
          }
          audioChunks = [];
        }
      };

      mediaRecorder.start();
      recordingStartedAt = Date.now();
      isListening.value = true;
      error.value = null;
      transcript.value = '';
      console.log('Started Whisper audio recording');
    } catch (err) {
      console.error('Error starting recording:', err);
      if (err.name === 'NotAllowedError') {
        error.value = 'Microphone access denied. Please allow microphone access.';
      } else {
        error.value = 'Failed to access microphone.';
      }
      isListening.value = false;
    }
  };

  const startListening = () => {
    if (!isSupported.value) {
      error.value = 'Speech recognition is not supported.';
      return;
    }

    if (isListening.value) {
      return; // Already listening
    }

    console.log('Starting Whisper speech recognition...');
    startWhisperRecording();
  };

  const stopListening = () => {
    if (!mediaRecorder || !isListening.value) {
      return;
    }

    try {
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
      isListening.value = false;
    } catch (err) {
      console.error('Error stopping recording:', err);
    }
  };

  const toggleListening = () => {
    if (isListening.value) {
      stopListening();
    } else {
      startListening();
    }
  };

  // Cleanup on unmount
  onUnmounted(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
  });

  return {
    isListening,
    isSupported,
    isTranscribing,
    transcript,
    error,
    startListening,
    stopListening,
    toggleListening,
  };
}
