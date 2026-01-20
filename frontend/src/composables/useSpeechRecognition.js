import { ref, onUnmounted } from 'vue';

export function useSpeechRecognition() {
  const isListening = ref(false);
  const isSupported = ref(true); // Always supported with Whisper
  const transcript = ref('');
  const error = ref(null);

  let mediaRecorder = null;
  let audioChunks = [];
  let stream = null;

  // Detect if running in Electron
  const isElectron = navigator.userAgent.toLowerCase().includes('electron');

  /**
   * Start recording audio using Whisper
   */
  const startWhisperRecording = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
          // Create blob from recorded chunks
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

          // Send to backend for transcription
          const formData = new FormData();
          formData.append('audio', audioBlob, 'recording.webm');

          console.log('Sending audio to Whisper for transcription...');

          const response = await fetch('http://localhost:3333/api/speech/transcribe', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            throw new Error(`Transcription failed: ${response.statusText}`);
          }

          const result = await response.json();

          if (result.success && result.transcript) {
            transcript.value = result.transcript;
            console.log('Transcription successful:', result.transcript);
          } else {
            throw new Error('No transcript returned');
          }
        } catch (err) {
          console.error('Error transcribing audio:', err);
          error.value = 'Failed to transcribe audio. Please try again.';
        } finally {
          // Clean up
          if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            stream = null;
          }
          audioChunks = [];
        }
      };

      mediaRecorder.start();
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
    transcript,
    error,
    startListening,
    stopListening,
    toggleListening,
  };
}
