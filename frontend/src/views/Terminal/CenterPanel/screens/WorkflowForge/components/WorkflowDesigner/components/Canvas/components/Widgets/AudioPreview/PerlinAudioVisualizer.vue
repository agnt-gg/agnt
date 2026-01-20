<template>
  <div class="perlin-visualizer" ref="container"></div>
</template>

<script>
import * as THREE from 'three';
import { markRaw } from 'vue';

// Cache shaders as constants outside component - they never change
const VERTEX_SHADER = `
  vec3 mod289(vec3 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }

  vec4 mod289(vec4 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }

  vec4 permute(vec4 x) {
    return mod289(((x*34.0)+1.0)*x);
  }

  vec4 taylorInvSqrt(vec4 r) {
    return 1.79284291400159 - 0.85373472095314 * r;
  }

  vec3 fade(vec3 t) {
    return t*t*t*(t*(t*6.0-15.0)+10.0);
  }

  float pnoise(vec3 P, vec3 rep) {
    vec3 Pi0 = mod(floor(P), rep);
    vec3 Pi1 = mod(Pi0 + vec3(1.0), rep);
    Pi0 = mod289(Pi0);
    Pi1 = mod289(Pi1);
    vec3 Pf0 = fract(P);
    vec3 Pf1 = Pf0 - vec3(1.0);
    vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
    vec4 iy = vec4(Pi0.yy, Pi1.yy);
    vec4 iz0 = Pi0.zzzz;
    vec4 iz1 = Pi1.zzzz;

    vec4 ixy = permute(permute(ix) + iy);
    vec4 ixy0 = permute(ixy + iz0);
    vec4 ixy1 = permute(ixy + iz1);

    vec4 gx0 = ixy0 * (1.0 / 7.0);
    vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
    gx0 = fract(gx0);
    vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
    vec4 sz0 = step(gz0, vec4(0.0));
    gx0 -= sz0 * (step(0.0, gx0) - 0.5);
    gy0 -= sz0 * (step(0.0, gy0) - 0.5);

    vec4 gx1 = ixy1 * (1.0 / 7.0);
    vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
    gx1 = fract(gx1);
    vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
    vec4 sz1 = step(gz1, vec4(0.0));
    gx1 -= sz1 * (step(0.0, gx1) - 0.5);
    gy1 -= sz1 * (step(0.0, gy1) - 0.5);

    vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
    vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
    vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
    vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
    vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
    vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
    vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
    vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);

    vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
    g000 *= norm0.x;
    g010 *= norm0.y;
    g100 *= norm0.z;
    g110 *= norm0.w;
    vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
    g001 *= norm1.x;
    g011 *= norm1.y;
    g101 *= norm1.z;
    g111 *= norm1.w;

    float n000 = dot(g000, Pf0);
    float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
    float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
    float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
    float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
    float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
    float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
    float n111 = dot(g111, Pf1);

    vec3 fade_xyz = fade(Pf0);
    vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
    vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
    float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
    return 1.5 * n_xyz;
  }

  varying vec2 vUv;
  varying float noise;
  varying float qnoise;
  varying float displacement;

  uniform float time;
  uniform float pointscale;
  uniform float decay;
  uniform float complex;
  uniform float waves;
  uniform float eqcolor;
  uniform bool fragment;
  uniform float audioLevel;

  float turbulence(vec3 p) {
    float t = -0.1;
    for (float f = 1.0; f <= 3.0; f++) {
      float power = pow(2.0, f);
      t += abs(pnoise(vec3(power * p), vec3(10.0, 10.0, 10.0)) / power);
    }
    return t;
  }

  void main() {
    vUv = uv;

    float audioFactor = 1.0 + audioLevel * 2.0;
    noise = (1.0 - waves) * turbulence(decay * abs(normal + time)) * audioFactor;
    qnoise = (2.0 - eqcolor) * turbulence(decay * abs(normal + time));
    float b = pnoise(complex * position + vec3(1.0 * time), vec3(100.0));

    if (fragment) {
      displacement = -sin(noise) + normalize(b * 0.5);
    } else {
      displacement = -sin(noise) + cos(b * 0.5);
    }

    vec3 newPosition = position + (normal * displacement * audioFactor);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
    gl_PointSize = pointscale;
  }
`;

const FRAGMENT_SHADER = `
  varying float qnoise;
  uniform float time;
  uniform bool redhell;

  void main() {
    float r, g, b;

    if (!redhell) {
      r = cos(qnoise + 0.5);
      g = cos(qnoise - 0.5);
      b = 0.0;
    } else {
      r = cos(qnoise + 0.5);
      g = cos(qnoise - 0.5);
      b = abs(qnoise);
    }
    gl_FragColor = vec4(r, g, b, 1.0);
  }
`;

export default {
  name: 'PerlinAudioVisualizer',
  props: {
    audioElement: {
      type: HTMLAudioElement,
      default: null,
    },
    isPlaying: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      scene: null,
      camera: null,
      renderer: null,
      mesh: null,
      material: null,
      animationId: null,
      audioContext: null,
      analyser: null,
      dataArray: null,
      sourceNode: null,
      startTime: performance.now(),
      resizeObserver: null,
      resizeTimeout: null,
      lastAudioLevel: 0.01,
    };
  },
  watch: {
    audioElement(newAudio, oldAudio) {
      if (oldAudio && oldAudio !== newAudio) {
        this.cleanupAudioContext();
      }
      if (newAudio) {
        this.setupAudioContext();
      }
    },
  },
  mounted() {
    this.initThreeJS();
    if (this.audioElement) {
      this.setupAudioContext();
    }
    this.startAnimation();
  },
  beforeUnmount() {
    this.cleanup();
  },
  methods: {
    initThreeJS() {
      const container = this.$refs.container;
      if (!container) return;

      const width = container.clientWidth;
      const height = container.clientHeight;

      // Scene - mark as raw to prevent Vue reactivity
      this.scene = markRaw(new THREE.Scene());
      this.scene.background = new THREE.Color(0x000000);

      // Camera - mark as raw to prevent Vue reactivity
      this.camera = markRaw(new THREE.PerspectiveCamera(55, width / height, 1, 1000));
      this.camera.position.z = 12;

      // Renderer - mark as raw to prevent Vue reactivity
      this.renderer = markRaw(new THREE.WebGLRenderer({ antialias: true, alpha: false }));
      this.renderer.setSize(width, height);
      container.appendChild(this.renderer.domElement);

      // Create shader material with cached shaders
      this.material = markRaw(
        new THREE.ShaderMaterial({
          wireframe: false,
          uniforms: {
            time: { value: 0.0 },
            pointscale: { value: 1.0 },
            decay: { value: 0.03 },
            complex: { value: 0.1 },
            waves: { value: 0.5 },
            eqcolor: { value: 8.0 },
            fragment: { value: true },
            redhell: { value: true },
            audioLevel: { value: 0.01 },
          },
          vertexShader: VERTEX_SHADER,
          fragmentShader: FRAGMENT_SHADER,
        })
      );

      // Reduced geometry complexity from 50 to 30 subdivisions - still looks great but much faster
      const geometry = new THREE.IcosahedronGeometry(3, 128);
      this.mesh = markRaw(new THREE.Points(geometry, this.material));
      this.scene.add(this.mesh);

      // Use only ResizeObserver for container size changes (more efficient than window resize)
      this.resizeObserver = new ResizeObserver(() => {
        this.onWindowResizeThrottled();
      });
      this.resizeObserver.observe(container);
    },

    setupAudioContext() {
      if (!this.audioElement) return;

      // Don't recreate if already connected to this element
      if (this.audioContext && this.sourceNode) return;

      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContext();

        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 64; // Reduced from 256 - less data to process
        this.analyser.smoothingTimeConstant = 0.8;

        this.sourceNode = this.audioContext.createMediaElementSource(this.audioElement);
        this.sourceNode.connect(this.analyser);
        this.analyser.connect(this.audioContext.destination);

        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      } catch (error) {
        console.error('Failed to setup audio context:', error);
      }
    },

    cleanupAudioContext() {
      if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = null;
      }
      if (this.analyser) {
        this.analyser.disconnect();
        this.analyser = null;
      }
      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
      }
      this.dataArray = null;
    },

    startAnimation() {
      if (this.animationId) return;

      const animate = () => {
        this.animationId = requestAnimationFrame(animate);

        // Get audio level only when playing
        let audioLevel = this.lastAudioLevel;
        if (this.isPlaying && this.analyser && this.dataArray) {
          this.analyser.getByteFrequencyData(this.dataArray);
          // Optimized: use a simple average of first 32 bins instead of all bins
          let sum = 0;
          const sampleSize = Math.min(32, this.dataArray.length);
          for (let i = 0; i < sampleSize; i++) {
            sum += this.dataArray[i];
          }
          audioLevel = sum / (sampleSize * 255);
          this.lastAudioLevel = audioLevel;
        } else {
          // Smoothly decay to idle state when not playing
          audioLevel = this.lastAudioLevel * 0.5;
          if (audioLevel < 0.01) audioLevel = 0.01;
          this.lastAudioLevel = audioLevel;
        }

        // Update time uniform
        const elapsed = (performance.now() - this.startTime) * 0.001;
        this.material.uniforms.time.value = elapsed * 0.25;
        this.material.uniforms.audioLevel.value = audioLevel;

        // Scale parameters based on audio level
        const baseDecay = 0.01;
        const maxDecay = 0.5;
        const baseWaves = 0.1;
        const maxWaves = 10;
        const baseComplex = 0.1;
        const maxComplex = 1;

        const targetDecay = this.isPlaying ? baseDecay + (maxDecay - baseDecay) * audioLevel : baseDecay;
        const targetWaves = this.isPlaying ? baseWaves + (maxWaves - baseWaves) * audioLevel : baseWaves;
        const targetComplex = this.isPlaying ? baseComplex + (maxComplex - baseComplex) * audioLevel : baseComplex;

        // Smooth transition instead of instant change
        this.material.uniforms.decay.value += (targetDecay - this.material.uniforms.decay.value) * 0.1;
        this.material.uniforms.waves.value += (targetWaves - this.material.uniforms.waves.value) * 0.5;
        this.material.uniforms.complex.value += (targetComplex - this.material.uniforms.complex.value) * 0.5;

        // Render
        this.renderer.render(this.scene, this.camera);
      };

      animate();
    },

    stopAnimation() {
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
    },

    onWindowResizeThrottled() {
      // Throttle resize events to avoid excessive recalculations
      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
      }

      this.resizeTimeout = setTimeout(() => {
        this.onWindowResize();
      }, 100);
    },

    onWindowResize() {
      const container = this.$refs.container;
      if (!container) return;

      const width = container.clientWidth;
      const height = container.clientHeight;

      // Only update if size actually changed
      if (this.camera.aspect !== width / height) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
      }
    },

    cleanup() {
      this.stopAnimation();

      if (this.renderer) {
        this.renderer.dispose();
        if (this.$refs.container && this.renderer.domElement) {
          this.$refs.container.removeChild(this.renderer.domElement);
        }
      }

      if (this.audioContext) {
        if (this.sourceNode) {
          this.sourceNode.disconnect();
        }
        if (this.analyser) {
          this.analyser.disconnect();
        }
        this.audioContext.close();
      }

      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }

      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
        this.resizeTimeout = null;
      }
    },
  },
};
</script>

<style scoped>
.perlin-visualizer {
  width: 100%;
  height: 100%;
  min-height: 200px;
  position: relative;
  overflow: hidden;
}

.perlin-visualizer canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
