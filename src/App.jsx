import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  Plus, 
  RotateCcw, 
  Info, 
  Sliders, 
  Music, 
  Globe, 
  Save, 
  Trash2,
  ChevronRight,
  PlusCircle,
  X,
  Radio,
  SlidersHorizontal
} from 'lucide-react';

// ==========================================
// 🎹 WEB AUDIO API MULTI-SYNTHESIZER
// ==========================================
class AdvancedAudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.tanpuraVolume = 0.85; // Increased default Tanpura volume
    this.shaperCurve = null;
    this.tanpuraOscillators = [];
    this.tanpuraLfos = [];
    this.tanpuraMasterGainNode = null;
    
    // Decoded Audio Buffers for real recorded Tabla strokes and loops
    this.buffers = {};
    this.stretchedBufferCache = {}; // Cache for time-stretched loop AudioBuffers
    this.isLoaded = false;
    
    // Real loop source trackers
    this.realTanpuraSource = null;
    this.tablaLoopSource = null;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.shaperCurve = this.makeDistortionCurve(25);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Pre-generate the non-linear waveshaping distortion curve for the Tanpura's Jawari (bridge buzz)
  makeDistortionCurve(amount) {
    const k = typeof amount === 'number' ? amount : 25;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      // Asymmetric saturation mimicking string-bridge contact
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // Loads real recorded Tabla audio samples (.wav) and loops into memory
  async loadAllSamples() {
    this.init();
    if (this.isLoaded) return;
    
    const samples = {
      // One shots
      dha: './audio/dha.wav',
      dhin: './audio/dhin.wav',
      ge: './audio/ge.wav',
      ke: './audio/ke.wav',
      na: './audio/na.wav',
      ta: './audio/ta.wav',
      tin: './audio/tin.wav',
      tun: './audio/tun.wav',
      // Real instrument Tanpura loop (recorded in G)
      tanpura_g: './audio/tanpura_g.wav',
      // Real Tabla loop recordings (recorded in C @ 120 BPM)
      loop_tintal: './audio/loop_tintal.wav',
      loop_dadra: './audio/loop_dadra.wav',
      loop_ektal: './audio/loop_ektal.wav',
      loop_jhaptal: './audio/loop_jhaptal.wav',
      loop_rupak: './audio/loop_rupak.wav',
      loop_kaherwa: './audio/loop_kaherwa.wav'
    };
    
    try {
      const promises = Object.entries(samples).map(async ([name, path]) => {
        const response = await fetch(path);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
        this.buffers[name] = audioBuffer;
      });
      await Promise.all(promises);
      this.isLoaded = true;
      console.log("All Tabla audio samples and loops loaded successfully!");
    } catch (e) {
      console.error("Failed to load Tabla audio samples/loops:", e);
    }
  }

  playAudioBuffer(buffer, time, vol) {
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    
    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(vol * this.volume, time);
    
    source.connect(gainNode);
    gainNode.connect(this.ctx.destination);
    
    source.start(time);
  }

  // --- REAL INSTRUMENT TANPURA PLAYBACK ---
  startRealTanpura(freq) {
    this.init();
    this.stopRealTanpura();

    const buffer = this.buffers['tanpura_g'];
    if (!buffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    // Pitch G3 = 196.0Hz
    const rate = freq / 196.0;
    source.playbackRate.setValueAtTime(rate, this.ctx.currentTime);

    this.tanpuraMasterGain = this.ctx.createGain();
    this.tanpuraMasterGain.gain.setValueAtTime(this.tanpuraVolume * 1.4, this.ctx.currentTime); // Boosted volume

    source.connect(this.tanpuraMasterGain);
    this.tanpuraMasterGain.connect(this.ctx.destination);

    source.start(0);
    this.realTanpuraSource = source;
    this.tanpuraMasterGainNode = this.tanpuraMasterGain;
  }

  stopRealTanpura() {
    if (this.realTanpuraSource) {
      try { this.realTanpuraSource.stop(); } catch (e) {}
      this.realTanpuraSource = null;
    }
    this.tanpuraMasterGainNode = null;
  }

  // --- OLA TIME STRETCHING ENGINE ---
  getOrCreateStretchedBuffer(loopName, bpm) {
    const originalBuffer = this.buffers[loopName];
    if (!originalBuffer) return null;

    // Round BPM to avoid caching minor fractional float variations
    const roundedBpm = Math.round(bpm * 10) / 10;
    const cacheKey = `${loopName}_${roundedBpm}`;
    if (this.stretchedBufferCache[cacheKey]) {
      return this.stretchedBufferCache[cacheKey];
    }

    const stretchFactor = roundedBpm / 120.0;
    
    // If tempo matches base recording, skip stretching to preserve raw quality
    if (Math.abs(stretchFactor - 1.0) < 0.005) {
      this.stretchedBufferCache[cacheKey] = originalBuffer;
      return originalBuffer;
    }

    try {
      const numChannels = originalBuffer.numberOfChannels;
      const sampleRate = originalBuffer.sampleRate;
      
      // Standard 45ms frame size is ideal for transient acoustic drums
      const frameSize = Math.floor(sampleRate * 0.045);
      const hopSizeInput = Math.floor(frameSize / 2);
      const hopSizeOutput = Math.floor(hopSizeInput / stretchFactor);
      
      const numFrames = Math.floor((originalBuffer.length - frameSize) / hopSizeInput);
      const outputLength = Math.floor(numFrames * hopSizeOutput + frameSize);
      
      const outputBuffer = this.ctx.createBuffer(numChannels, outputLength, sampleRate);
      
      // Hann Window to crossfade overlapping grains cleanly
      const windowFn = new Float32Array(frameSize);
      for (let i = 0; i < frameSize; i++) {
        windowFn[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)));
      }
      
      for (let c = 0; c < numChannels; c++) {
        const inputData = originalBuffer.getChannelData(c);
        const outputData = outputBuffer.getChannelData(c);
        
        const accumulator = new Float32Array(outputLength);
        const windowSum = new Float32Array(outputLength);
        
        for (let f = 0; f < numFrames; f++) {
          const inputOffset = f * hopSizeInput;
          const outputOffset = f * hopSizeOutput;
          
          for (let i = 0; i < frameSize; i++) {
            const inIdx = inputOffset + i;
            const outIdx = Math.floor(outputOffset + i);
            
            if (inIdx < inputData.length && outIdx < outputLength) {
              const val = inputData[inIdx] * windowFn[i];
              accumulator[outIdx] += val;
              windowSum[outIdx] += windowFn[i];
            }
          }
        }
        
        // Normalize overlap gain flat across all samples
        for (let i = 0; i < outputLength; i++) {
          if (windowSum[i] > 0.01) {
            outputData[i] = accumulator[i] / windowSum[i];
          } else {
            outputData[i] = accumulator[i];
          }
        }
      }
      
      this.stretchedBufferCache[cacheKey] = outputBuffer;
      return outputBuffer;
    } catch (e) {
      console.error("Failed to stretch audio loop buffer:", e);
      return originalBuffer;
    }
  }

  // --- REAL TABLA LOOP PLAYBACK ---
  startTablaLoop(taalId, bpm, scaleFreq) {
    this.init();
    this.stopTablaLoop();

    const loopName = `loop_${taalId}`;
    
    // Fetch time-stretched, pitch-preserved buffer from our OLA engine
    const buffer = this.getOrCreateStretchedBuffer(loopName, bpm);
    if (!buffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    // Pitch shift ONLY to match scale key (Reference C3 = 130.81Hz). Tempo changes have 0% pitch effect!
    const rate = scaleFreq / 130.81;
    source.playbackRate.setValueAtTime(rate, this.ctx.currentTime);

    this.tablaLoopGain = this.ctx.createGain();
    this.tablaLoopGain.gain.setValueAtTime(this.volume * 0.95, this.ctx.currentTime);

    source.connect(this.tablaLoopGain);
    this.tablaLoopGain.connect(this.ctx.destination);

    source.start(0);
    this.tablaLoopSource = source;
  }

  stopTablaLoop() {
    if (this.tablaLoopSource) {
      try { this.tablaLoopSource.stop(); } catch (e) {}
      this.tablaLoopSource = null;
    }
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.tablaLoopGain) {
      this.tablaLoopGain.gain.setValueAtTime(this.volume * 0.95, this.ctx.currentTime);
    }
  }

  setTanpuraVolume(val) {
    this.tanpuraVolume = Math.max(0, Math.min(1, val));
    if (this.tanpuraMasterGainNode && this.ctx) {
      this.tanpuraMasterGainNode.gain.setValueAtTime(this.tanpuraVolume * 1.4, this.ctx.currentTime); // Boosted volume
    }
  }

  // --- TABLA STROKES SYNTHESIS (Modal Physical Modeling) ---

  playTablaStroke(type, time) {
    this.init();
    const stroke = (type || '').toLowerCase();
    
    // Map rhythmic syllables (Bols) to specific audio samples
    let sampleName = 'na';
    if (stroke.includes('dha')) sampleName = 'dha';
    else if (stroke.includes('dhin')) sampleName = 'dhin';
    else if (stroke.includes('tin')) sampleName = 'tin';
    else if (stroke.includes('tun')) sampleName = 'tun';
    else if (stroke.includes('ge')) sampleName = 'ge';
    else if (stroke.includes('ke') || stroke.includes('ka') || stroke.includes('kat')) sampleName = 'ke';
    else if (stroke.includes('ta') || stroke.includes('na')) sampleName = 'na';
    
    const buffer = this.buffers[sampleName];
    if (buffer) {
      this.playAudioBuffer(buffer, time, 1.0);
    } else {
      // Fallback synthesis if samples are not loaded yet
      if (sampleName === 'dha') this.playDha(time);
      else if (sampleName === 'dhin') this.playDhin(time);
      else if (sampleName === 'tin') this.playTin(time, 0.8);
      else if (sampleName === 'ke') this.playKe(time, 0.65);
      else this.playNa(time, 0.7);
    }
  }

  playDha(time) {
    this.playGhe(time, 0.9); // Deep Bayan
    this.playNa(time, 0.8);   // Ringing Dahina
  }

  playDhin(time) {
    this.playGhe(time, 0.85); // Deep Bayan
    this.playTin(time, 0.85);  // Resonant Dahina
  }

  // Synthesizes the deep resonant bass Bayan "Ghe" stroke with finger skin-slap transient
  playGhe(time, vol) {
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    
    // Fundamental deep bass frequency glide (the "wobble")
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(75, time);
    osc1.frequency.exponentialRampToValueAtTime(108, time + 0.16);
    
    // Second harmonic to give the wood/metal shell body depth
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(150, time);
    osc2.frequency.exponentialRampToValueAtTime(216, time + 0.16);

    gainNode.gain.setValueAtTime(0, time);
    gainNode.gain.linearRampToValueAtTime(vol * this.volume, time + 0.015);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.42);
    
    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(this.ctx.destination);
    
    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + 0.45);
    osc2.stop(time + 0.45);

    // Finger skin-strike noise transient (click)
    const bufferSize = this.ctx.sampleRate * 0.018; // 18ms transient
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 240;
    filter.Q.value = 4;
    
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(vol * 0.3 * this.volume, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.018);
    
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);
    
    noise.start(time);
    noise.stop(time + 0.02);
  }

  // Synthesizes the Dahina metallic ringing edge stroke "Na" using modal frequencies
  playNa(time, vol) {
    const gainNode = this.ctx.createGain();
    
    // Modal frequencies for tuned Dahina shell (ratios 1.0, 1.5, 2.0, 2.5)
    // Detuning the harmonics slightly creates a beautiful organic beating timbre.
    const modes = [360, 541, 722, 903];
    const decays = [0.24, 0.16, 0.10, 0.07];
    const amplitudes = [1.0, 0.5, 0.3, 0.15];
    
    modes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);
      
      oscGain.gain.setValueAtTime(0, time);
      oscGain.gain.linearRampToValueAtTime(amplitudes[idx] * vol * this.volume * 0.45, time + 0.004);
      oscGain.gain.exponentialRampToValueAtTime(0.001, time + decays[idx]);
      
      osc.connect(oscGain);
      oscGain.connect(this.ctx.destination);
      osc.start(time);
      osc.stop(time + decays[idx] + 0.05);
    });
  }

  // Synthesizes the deeper ringing center stroke "Tin"
  playTin(time, vol) {
    const modes = [300, 451, 602];
    const decays = [0.35, 0.22, 0.14];
    const amplitudes = [1.0, 0.6, 0.25];
    
    modes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);
      
      oscGain.gain.setValueAtTime(0, time);
      oscGain.gain.linearRampToValueAtTime(amplitudes[idx] * vol * this.volume * 0.45, time + 0.008);
      oscGain.gain.exponentialRampToValueAtTime(0.001, time + decays[idx]);
      
      osc.connect(oscGain);
      oscGain.connect(this.ctx.destination);
      osc.start(time);
      osc.stop(time + decays[idx] + 0.05);
    });
  }

  // Synthesizes the damped flat hand strike "Ke/Ka"
  playKe(time, vol) {
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, time);
    oscGain.gain.setValueAtTime(this.volume * vol * 0.5, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    
    osc.connect(oscGain);
    oscGain.connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);

    // Brush noise component
    const bufferSize = this.ctx.sampleRate * 0.07;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 220;
    filter.Q.value = 3;
    
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(this.volume * vol * 0.65, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
    
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);
    
    noise.start(time);
    noise.stop(time + 0.08);
  }

  // --- TWO-TONE CLEAN STUDIO METRONOME ---
  playStudioMetronome(isAccent, time) {
    this.init();
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    
    osc.type = 'triangle';
    if (isAccent) {
      osc.frequency.setValueAtTime(1000, time);
    } else {
      osc.frequency.setValueAtTime(650, time);
    }
    
    gainNode.gain.setValueAtTime(0, time);
    gainNode.gain.linearRampToValueAtTime(this.volume * 0.75, time + 0.002);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    
    osc.connect(gainNode);
    gainNode.connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  // --- DRUM KIT METRONOME ---
  playDrumMetronome(beatIndex, time) {
    this.init();
    if (beatIndex === 0) {
      this.playKick(time);
      this.playHihat(time, false);
    } else if (beatIndex % 4 === 2) {
      this.playSnare(time);
      this.playHihat(time, false);
    } else {
      this.playHihat(time, false);
    }
  }

  playKick(time) {
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.1);
    gainNode.gain.setValueAtTime(this.volume * 0.85, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    osc.connect(gainNode);
    gainNode.connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.15);
  }

  playSnare(time) {
    const osc = this.ctx.createOscillator();
    const gainOsc = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, time);
    gainOsc.gain.setValueAtTime(this.volume * 0.35, time);
    gainOsc.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    osc.connect(gainOsc);
    gainOsc.connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.12);
    
    const bufferSize = this.ctx.sampleRate * 0.1;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1000;
    const gainNoise = this.ctx.createGain();
    gainNoise.gain.setValueAtTime(this.volume * 0.45, time);
    gainNoise.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    noise.connect(filter);
    filter.connect(gainNoise);
    gainNoise.connect(this.ctx.destination);
    noise.start(time);
    noise.stop(time + 0.12);
  }

  playHihat(time, open = false) {
    const duration = open ? 0.22 : 0.05;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 8000;
    filter.Q.value = 6;
    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(this.volume * 0.25, time);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + duration);
    noise.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.ctx.destination);
    noise.start(time);
    noise.stop(time + duration + 0.01);
  }

  // --- 🎻 HIGH-FIDELITY CONTINUOUS TANPURA DRONE ---
  startTanpura(freq, tuning) {
    this.init();
    this.stopTanpura(); // Stop any existing running drone

    const ctx = this.ctx;
    
    // Master gain for Tanpura
    this.tanpuraMasterGain = ctx.createGain();
    this.tanpuraMasterGain.gain.setValueAtTime(this.tanpuraVolume * 0.45, ctx.currentTime);
    
    // Determine frequencies for the 4 strings
    let factor1 = 1.5; // Pa
    if (tuning === 'ma') factor1 = 1.3333;
    else if (tuning === 'ni') factor1 = 1.875;
    
    const freqs = [
      freq * factor1, // String 1
      freq * 2.0,     // String 2
      freq * 2.0,     // String 3
      freq            // String 4
    ];
    
    // We will create continuous warm sawtooth oscillators with slow LFOs
    this.tanpuraOscillators = [];
    this.tanpuraLfos = [];
    
    freqs.forEach((baseFreq, idx) => {
      // 1. Harmonics structure for each string to simulate rich string timbre
      const harmonics = [1, 2, 3, 4, 5];
      const amplitudes = [1.0, 0.6, 0.4, 0.2, 0.05];
      
      const stringGain = ctx.createGain();
      stringGain.gain.setValueAtTime(0.18, ctx.currentTime);
      
      // Slow LFO to modulate the amplitude of this string (simulates breathing)
      const ampLfo = ctx.createOscillator();
      const ampLfoGain = ctx.createGain();
      ampLfo.frequency.value = 0.05 + idx * 0.02; // Very slow (0.05Hz - 0.1Hz)
      ampLfoGain.gain.value = 0.08; // modulate gain slightly
      ampLfo.connect(ampLfoGain);
      ampLfoGain.connect(stringGain.gain);
      ampLfo.start();
      this.tanpuraLfos.push(ampLfo);
      
      harmonics.forEach((h, hIdx) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(baseFreq * h, ctx.currentTime);
        
        // Slow detuning LFO for each harmonic to create shimmering beating
        const detuneLfo = ctx.createOscillator();
        const detuneLfoGain = ctx.createGain();
        detuneLfo.frequency.value = 0.08 + idx * 0.03 + hIdx * 0.01;
        detuneLfoGain.gain.value = 6; // detune range of +/- 6 cents
        detuneLfo.connect(detuneLfoGain);
        detuneLfoGain.connect(osc.detune);
        
        detuneLfo.start();
        this.tanpuraLfos.push(detuneLfo);
        
        const harmonicGain = ctx.createGain();
        harmonicGain.gain.setValueAtTime(amplitudes[hIdx], ctx.currentTime);
        
        osc.connect(harmonicGain);
        harmonicGain.connect(stringGain);
        
        osc.start();
        this.tanpuraOscillators.push(osc);
      });
      
      stringGain.connect(this.tanpuraMasterGain);
    });
    
    // WaveShaper for Jawari bridge buzzing
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.shaperCurve;
    shaper.oversample = '4x';
    
    const dryGain = ctx.createGain();
    const wetGain = ctx.createGain();
    dryGain.gain.setValueAtTime(0.6, ctx.currentTime);
    wetGain.gain.setValueAtTime(0.4, ctx.currentTime);
    
    this.tanpuraMasterGain.connect(dryGain);
    this.tanpuraMasterGain.connect(shaper);
    shaper.connect(wetGain);
    
    // Low pass filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 3.0, ctx.currentTime);
    filter.Q.value = 1.0;
    
    dryGain.connect(filter);
    wetGain.connect(filter);
    
    // Physical Body Resonance
    const delay = ctx.createDelay();
    const feedback = ctx.createGain();
    delay.delayTime.setValueAtTime(0.015, ctx.currentTime); 
    feedback.gain.setValueAtTime(0.4, ctx.currentTime);   
    
    filter.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    
    filter.connect(ctx.destination);
    delay.connect(ctx.destination);
    
    // Save master gain node so we can update volume in real-time
    this.tanpuraMasterGainNode = this.tanpuraMasterGain;
  }
  
  stopTanpura() {
    this.tanpuraOscillators.forEach(osc => {
      try { osc.stop(); } catch (e) {}
    });
    this.tanpuraLfos.forEach(lfo => {
      try { lfo.stop(); } catch (e) {}
    });
    this.tanpuraOscillators = [];
    this.tanpuraLfos = [];
    this.tanpuraMasterGainNode = null;
  }

  // --- 🪈 RAAG MELODY SYNTHESIZER ---
  // Beautiful flute-like sitar sound to guide Raag scale notes
  playRaagNote(freq, time) {
    this.init();
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);
    
    // Slow LFO for vibrato
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 6.5; // 6.5 Hz vibrato
    lfoGain.gain.value = 3;     // frequency modulation range
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    
    gainNode.gain.setValueAtTime(0, time);
    gainNode.gain.linearRampToValueAtTime(this.volume * 0.28, time + 0.06);
    gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.6);
    
    osc.connect(gainNode);
    gainNode.connect(this.ctx.destination);
    
    lfo.start(time);
    osc.start(time);
    
    lfo.stop(time + 0.7);
    osc.stop(time + 0.7);
  }
}

// Global Audio Engine Instance
const engine = new AdvancedAudioEngine();

// ==========================================
// 📊 SCALES & PITCH FREQUENCIES
// ==========================================
const SCALES = [
  { note: 'C', freq: 130.81 },
  { note: 'C#', freq: 138.59 },
  { note: 'D', freq: 146.83 },
  { note: 'D#', freq: 155.56 },
  { note: 'E', freq: 164.81 },
  { note: 'F', freq: 174.61 },
  { note: 'F#', freq: 185.00 },
  { note: 'G', freq: 196.00 },
  { note: 'G#', freq: 207.65 },
  { note: 'A', freq: 220.00 },
  { note: 'A#', freq: 233.08 },
  { note: 'B', freq: 246.94 }
];

// ==========================================
// 🪕 RAAG SCALE DEFINITIONS (Hindustani)
// ==========================================
const RAAGS = [
  {
    id: 'yaman',
    name: 'Raag Yaman',
    notes: 'S R G M# P D N S\'',
    desc: 'Sweet, evening Raag. Uses Teevra Madhyam (M#).',
    scaleSteps: [1, 1.122, 1.26, 1.414, 1.5, 1.682, 1.888, 2.0], // Relative frequencies
    aroha: ['N\'', 'R', 'G', 'M#', 'D', 'N', 'S\''],
    avroha: ['S\'', 'N', 'D', 'P', 'M#', 'G', 'R', 'S'],
    melodyPattern: [0, 1, 2, 3, 2, 4, 3, 5, 4, 6, 7, 6, 5, 4, 3, 2] // Index in scale steps
  },
  {
    id: 'bhairav',
    name: 'Raag Bhairav',
    notes: 'S r G M P d N S\'',
    desc: 'Grand, morning Raag. Uses Komal Re (r) and Komal Dha (d).',
    scaleSteps: [1, 1.067, 1.26, 1.333, 1.5, 1.6, 1.888, 2.0],
    aroha: ['S', 'r', 'G', 'M', 'P', 'd', 'N', 'S\''],
    avroha: ['S\'', 'N', 'd', 'P', 'M', 'G', 'r', 'S'],
    melodyPattern: [0, 1, 2, 3, 4, 5, 4, 6, 7, 6, 5, 4, 3, 2, 1, 0]
  },
  {
    id: 'bilawal',
    name: 'Raag Bilawal',
    notes: 'S R G M P D N S\'',
    desc: 'Bright, morning Raag. Equivalent to major scale.',
    scaleSteps: [1, 1.122, 1.26, 1.333, 1.5, 1.682, 1.888, 2.0],
    aroha: ['S', 'R', 'G', 'M', 'P', 'D', 'N', 'S\''],
    avroha: ['S\'', 'N', 'D', 'P', 'M', 'G', 'R', 'S'],
    melodyPattern: [0, 1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1, 0]
  },
  {
    id: 'bhimpalasi',
    name: 'Raag Bhimpalasi',
    notes: 'S R g M P D n S\'',
    desc: 'Late afternoon Raag. Uses Komal Ga (g) and Komal Ni (n).',
    scaleSteps: [1, 1.122, 1.189, 1.333, 1.5, 1.682, 1.782, 2.0],
    aroha: ['n\'', 'S', 'g', 'M', 'P', 'n', 'S\''],
    avroha: ['S\'', 'n', 'D', 'P', 'M', 'g', 'R', 'S'],
    melodyPattern: [0, 2, 3, 4, 6, 7, 6, 4, 3, 2, 1, 0, 0, 0, 0, 0]
  }
];

// ==========================================
// 📊 TAALS DATA (10 TRADITIONAL INDIAN TAALS)
// ==========================================
const DEFAULT_TAALS = [
  {
    id: 'tintal',
    name: 'Tintal',
    beats: 16,
    division: '4+4+4+4',
    description: 'The most popular taal. Symmetric 16 beats.',
    structure: ['tali', 'dhin', 'dhin', 'normal', 'tali', 'dhin', 'dhin', 'normal', 'khali', 'tin', 'tin', 'normal', 'tali', 'dhin', 'dhin', 'normal'],
    bols: ['Dha', 'Dhin', 'Dhin', 'Dha', 'Dha', 'Dhin', 'Dhin', 'Dha', 'Dha', 'Tin', 'Tin', 'Ta', 'Ta', 'Dhin', 'Dhin', 'Dha']
  },
  {
    id: 'dadra',
    name: 'Dadra',
    beats: 6,
    division: '3+3',
    description: 'Light classical & folk taal. Quick syncopation.',
    structure: ['tali', 'dhin', 'normal', 'khali', 'tin', 'normal'],
    bols: ['Dha', 'Dhin', 'Na', 'Dha', 'Tin', 'Na']
  },
  {
    id: 'rupak',
    name: 'Rupak',
    beats: 7,
    division: '3+2+2',
    description: 'Unique taal that starts with a Wave (Khali) on beat 1.',
    structure: ['khali', 'tin', 'normal', 'tali', 'dhin', 'tali', 'dhin'],
    bols: ['Tin', 'Tin', 'Na', 'Dhin', 'Na', 'Dhin', 'Na']
  },
  {
    id: 'kaherwa',
    name: 'Kaherwa',
    beats: 8,
    division: '4+4',
    description: 'Extremely popular in ghazals, bhajans, and Bollywood.',
    structure: ['tali', 'dhin', 'normal', 'normal', 'khali', 'dhin', 'normal', 'normal'],
    bols: ['Dha', 'Ge', 'Na', 'Tin', 'Na', 'Ka', 'Dhin', 'Dha']
  },
  {
    id: 'matta',
    name: 'Matta',
    beats: 9,
    division: '2+2+2+3',
    description: 'A rare 9-beat classical rhythm cycle (Matt Taal).',
    structure: ['tali', 'normal', 'tali', 'normal', 'khali', 'normal', 'tali', 'normal', 'normal'],
    bols: ['Dhin', 'Ta', 'Dhin', 'Na', 'Tun', 'Na', 'Dhin', 'Dhin', 'Na']
  },
  {
    id: 'jhaptal',
    name: 'Jhaptal',
    beats: 10,
    division: '2+3+2+3',
    description: 'Classical taal with structured phrases.',
    structure: ['tali', 'normal', 'tali', 'dhin', 'normal', 'khali', 'normal', 'tali', 'dhin', 'normal'],
    bols: ['Dhin', 'Na', 'Dhin', 'Dhin', 'Na', 'Tin', 'Na', 'Dhin', 'Dhin', 'Na']
  },
  {
    id: 'rudra',
    name: 'Rudra',
    beats: 11,
    division: '2+2+2+2+3',
    description: 'Fierce and dynamic 11-beat rhythm cycle.',
    structure: ['tali', 'normal', 'tali', 'normal', 'khali', 'normal', 'tali', 'normal', 'tali', 'normal', 'normal'],
    bols: ['Dha', 'Dhin', 'Ta', 'Na', 'Kat', 'Ta', 'Dha', 'Ge', 'Dhi', 'Na', 'Dha']
  },
  {
    id: 'ektaal',
    name: 'Ektaal',
    beats: 12,
    division: '2+2+2+2+2+2',
    description: 'Used in classical khyal singing, both slow & fast tempos.',
    structure: ['tali', 'normal', 'khali', 'normal', 'tali', 'normal', 'khali', 'normal', 'tali', 'normal', 'tali', 'normal'],
    bols: ['Dhin', 'Dhin', 'Dha', 'Ge', 'Tu', 'Na', 'Kat', 'Ta', 'Dha', 'Ge', 'Dhi', 'Na']
  },
  {
    id: 'adachautal',
    name: 'Ada Chautal',
    beats: 14,
    division: '2+2+2+2+2+2+2',
    description: 'Complex 14-beat cycle with alternating accents.',
    structure: ['tali', 'normal', 'tali', 'normal', 'khali', 'normal', 'tali', 'normal', 'khali', 'normal', 'tali', 'normal', 'khali', 'normal'],
    bols: ['Dha', 'Dhin', 'Dha', 'Dhin', 'Ta', 'Tin', 'Dha', 'Ge', 'Na', 'Ti', 'Ta', 'Ke', 'Ta', 'Dhi']
  },
  {
    id: 'panchamsawari',
    name: 'Pancham Sawari',
    beats: 15,
    division: '3+4+4+4',
    description: 'An advanced, rare 15-beat rhythm cycle.',
    structure: ['tali', 'normal', 'normal', 'tali', 'normal', 'normal', 'normal', 'khali', 'normal', 'normal', 'normal', 'tali', 'normal', 'normal', 'normal'],
    bols: ['Dha', 'Dhin', 'Na', 'Dha', 'Dha', 'Dhin', 'Na', 'Dha', 'Dha', 'Tin', 'Na', 'Na', 'Ka', 'Dhi', 'Na']
  }
];

export default function App() {
  const [taals, setTaals] = useState(() => {
    try {
      const saved = localStorage.getItem('custom_taals');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return [...DEFAULT_TAALS, ...parsed];
        }
      }
    } catch (e) {
      console.error("Failed to parse custom taals from localStorage:", e);
    }
    return DEFAULT_TAALS;
  });

  const [currentTaal, setCurrentTaal] = useState(DEFAULT_TAALS[0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [volume, setVolume] = useState(0.8);
  const [soundMode, setSoundMode] = useState('tabla'); // 'tabla' | 'studio' | 'drum'
  const [tablaMode, setTablaMode] = useState('single'); // 'single' | 'loop'

  // Tanpura State
  const [isTanpuraOn, setIsTanpuraOn] = useState(false);
  const [tanpuraScale, setTanpuraScale] = useState(SCALES[0]); // Default C
  const [tanpuraTuning, setTanpuraTuning] = useState('pa'); // 'pa' | 'ma' | 'ni'
  const [tanpuraVolume, setTanpuraVolume] = useState(0.85); // Boosted default volume
  const [tanpuraMode, setTanpuraMode] = useState('real'); // 'synth' | 'real'

  // Raag Melody State
  const [selectedRaag, setSelectedRaag] = useState(RAAGS[0]); // Default Yaman
  const [isRaagMelodyOn, setIsRaagMelodyOn] = useState(false);

  const [activeBeat, setActiveBeat] = useState(0);

  // Custom Taal Creator State
  const [customName, setCustomName] = useState('');
  const [customBeats, setCustomBeats] = useState(8);
  const [customStructure, setCustomStructure] = useState(Array(8).fill('normal'));
  const [customBols, setCustomBols] = useState(Array(8).fill('Dha'));
  const [isCreatorOpen, setIsCreatorOpen] = useState(false);

  // Audio scheduler references
  const schedulerTimerRef = useRef(null);
  const nextNoteTimeRef = useRef(0.0);
  const beatIndexRef = useRef(0);
  const bpmRef = useRef(bpm);
  const volumeRef = useRef(volume);
  const soundModeRef = useRef(soundMode);
  const tablaModeRef = useRef(tablaMode);
  const currentTaalRef = useRef(currentTaal);

  // Tanpura Reference
  const tanpuraVolumeRef = useRef(tanpuraVolume);
  const tanpuraScaleRef = useRef(tanpuraScale);
  const tanpuraTuningRef = useRef(tanpuraTuning);
  const isTanpuraOnRef = useRef(isTanpuraOn);

  // Raag Melody references
  const isRaagMelodyOnRef = useRef(isRaagMelodyOn);
  const selectedRaagRef = useRef(selectedRaag);

  // Metronome state reference
  const isPlayingRef = useRef(isPlaying);

  // Keep references synced
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { volumeRef.current = volume; engine.setVolume(volume); }, [volume]);
  useEffect(() => { soundModeRef.current = soundMode; }, [soundMode]);
  useEffect(() => { tablaModeRef.current = tablaMode; }, [tablaMode]);
  useEffect(() => { currentTaalRef.current = currentTaal; }, [currentTaal]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  useEffect(() => { 
    tanpuraVolumeRef.current = tanpuraVolume; 
    engine.setTanpuraVolume(tanpuraVolume); 
  }, [tanpuraVolume]);
  useEffect(() => { tanpuraScaleRef.current = tanpuraScale; }, [tanpuraScale]);
  useEffect(() => { tanpuraTuningRef.current = tanpuraTuning; }, [tanpuraTuning]);
  useEffect(() => { isTanpuraOnRef.current = isTanpuraOn; }, [isTanpuraOn]);

  useEffect(() => { isRaagMelodyOnRef.current = isRaagMelodyOn; }, [isRaagMelodyOn]);
  useEffect(() => { selectedRaagRef.current = selectedRaag; }, [selectedRaag]);

  // Handle Play/Pause for Metronome
  const togglePlay = () => {
    engine.init();
    setIsPlaying(prev => !prev);
  };

  const resetMetronome = () => {
    setIsPlaying(false);
    setActiveBeat(0);
    beatIndexRef.current = 0;
  };

  // Unified Audio Loop Effect: runs if EITHER Metronome or Melody is active
  useEffect(() => {
    const shouldPlay = isPlaying || isRaagMelodyOn;
    
    if (shouldPlay) {
      engine.init();
      nextNoteTimeRef.current = engine.ctx.currentTime + 0.05;
      
      schedulerTimerRef.current = setInterval(() => {
        scheduler();
      }, 25);
    } else {
      clearInterval(schedulerTimerRef.current);
    }
    
    return () => {
      clearInterval(schedulerTimerRef.current);
    };
  }, [isPlaying, isRaagMelodyOn]);

  // Scheduler: Schedules notes 100ms ahead
  const scheduler = () => {
    const lookahead = 0.1;
    const ctx = engine.init() || engine.ctx;
    
    // Prevent catch-up stutters if the app thread freezes or goes to background
    if (nextNoteTimeRef.current < ctx.currentTime) {
      nextNoteTimeRef.current = ctx.currentTime;
    }
    
    while (nextNoteTimeRef.current < ctx.currentTime + lookahead) {
      scheduleNote(beatIndexRef.current, nextNoteTimeRef.current);
      advanceBeat();
    }
  };

  const scheduleNote = (beatIndex, time) => {
    const taal = currentTaalRef.current;
    const beatType = taal.structure[beatIndex];
    
    // UI update synced
    const visualBeat = beatIndex;
    setTimeout(() => {
      setActiveBeat(visualBeat);
    }, (time - engine.ctx.currentTime) * 1000);

    // 1. Play rhythm beats ONLY if metronome is active
    if (isPlayingRef.current) {
      if (soundModeRef.current === 'tabla') {
        if (tablaModeRef.current === 'single') {
          engine.playTablaStroke(taal.bols[beatIndex], time);
        }
      } else if (soundModeRef.current === 'studio') {
        const isAccent = beatIndex === 0;
        engine.playStudioMetronome(isAccent, time);
      } else {
        engine.playDrumMetronome(beatIndex, time);
      }
    }

    // 2. Play Raag scale note if enabled
    if (isRaagMelodyOnRef.current) {
      const raag = selectedRaagRef.current;
      const melodyIndex = raag.melodyPattern[beatIndex % raag.melodyPattern.length];
      const stepMultiplier = raag.scaleSteps[melodyIndex];
      const fundamental = tanpuraScaleRef.current.freq;
      
      // Calculate specific pitch (transposed to selected scale)
      const noteFreq = fundamental * stepMultiplier;
      engine.playRaagNote(noteFreq, time);
    }
  };

  const advanceBeat = () => {
    const secondsPerBeat = 60.0 / bpmRef.current;
    nextNoteTimeRef.current += secondsPerBeat;
    
    const totalBeats = currentTaalRef.current.beats;
    beatIndexRef.current = (beatIndexRef.current + 1) % totalBeats;
  };

  // Switch Taal
  const selectTaal = (taal) => {
    setCurrentTaal(taal);
    setActiveBeat(0);
    beatIndexRef.current = 0;
    if (isPlaying || isRaagMelodyOn) {
      clearInterval(schedulerTimerRef.current);
      nextNoteTimeRef.current = engine.ctx.currentTime + 0.02;
      schedulerTimerRef.current = setInterval(() => {
        scheduler();
      }, 25);
    }
  };

  // Load real Tabla audio samples on mount
  useEffect(() => {
    engine.loadAllSamples();
  }, []);

  // Continuous Tanpura Drone Effect
  useEffect(() => {
    if (isTanpuraOn) {
      if (tanpuraMode === 'real') {
        engine.stopTanpura();
        engine.startRealTanpura(tanpuraScale.freq);
      } else {
        engine.stopRealTanpura();
        engine.startTanpura(tanpuraScale.freq, tanpuraTuning);
      }
    } else {
      engine.stopTanpura();
      engine.stopRealTanpura();
    }
    return () => {
      engine.stopTanpura();
      engine.stopRealTanpura();
    };
  }, [isTanpuraOn, tanpuraMode, tanpuraScale, tanpuraTuning]);

  // Real Tabla Loop playback controller
  useEffect(() => {
    if (isPlaying && tablaMode === 'loop' && soundMode === 'tabla') {
      engine.startTablaLoop(currentTaal.id, bpm, tanpuraScale.freq);
    } else {
      engine.stopTablaLoop();
    }
    return () => {
      engine.stopTablaLoop();
    };
  }, [isPlaying, tablaMode, soundMode, currentTaal, bpm, tanpuraScale]);

  const setTempoPreset = (speed) => {
    if (speed === 'slow') setBpm(60);
    else if (speed === 'medium') setBpm(120);
    else if (speed === 'fast') setBpm(200);
  };

  // Custom Creator
  const handleCustomBeatsChange = (num) => {
    const count = parseInt(num) || 4;
    setCustomBeats(count);
    setCustomStructure(prev => {
      const copy = [...prev];
      if (count > copy.length) return [...copy, ...Array(count - copy.length).fill('normal')];
      return copy.slice(0, count);
    });
    setCustomBols(prev => {
      const copy = [...prev];
      if (count > copy.length) return [...copy, ...Array(count - copy.length).fill('Dha')];
      return copy.slice(0, count);
    });
  };

  const toggleCreatorBeatType = (idx) => {
    setCustomStructure(prev => {
      const copy = [...prev];
      const types = ['normal', 'tali', 'khali'];
      const currentIdx = types.indexOf(copy[idx]);
      copy[idx] = types[(currentIdx + 1) % types.length];
      return copy;
    });
  };

  const updateCreatorBol = (idx, val) => {
    setCustomBols(prev => {
      const copy = [...prev];
      copy[idx] = val;
      return copy;
    });
  };

  const saveCustomTaal = () => {
    if (!customName.trim()) {
      alert("Please provide a name for your custom Taal.");
      return;
    }
    const newTaal = {
      id: `custom_${Date.now()}`,
      name: customName,
      beats: customBeats,
      division: `${customBeats} Beats Custom`,
      description: 'Your own custom rhythm pattern.',
      structure: customStructure,
      bols: customBols,
      isCustom: true
    };
    try {
      const localSaved = localStorage.getItem('custom_taals');
      const existing = localSaved ? JSON.parse(localSaved) : [];
      const updated = [...existing, newTaal];
      
      localStorage.setItem('custom_taals', JSON.stringify(updated));
      setTaals([...DEFAULT_TAALS, ...updated]);
    } catch (e) {
      console.error("Failed to save custom taal:", e);
    }
    setCustomName('');
    setIsCreatorOpen(false);
    selectTaal(newTaal);
  };

  const deleteCustomTaal = (id, e) => {
    e.stopPropagation();
    try {
      const localSaved = localStorage.getItem('custom_taals');
      if (localSaved) {
        const existing = JSON.parse(localSaved);
        const updated = existing.filter(t => t.id !== id);
        localStorage.setItem('custom_taals', JSON.stringify(updated));
        setTaals([...DEFAULT_TAALS, ...updated]);
      }
    } catch (e) {
      console.error("Failed to delete custom taal:", e);
    }
    if (currentTaal.id === id) {
      selectTaal(DEFAULT_TAALS[0]);
    }
  };

  const getBeatColorClass = (type, isActive) => {
    if (isActive) return 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-lg shadow-emerald-500/30 scale-110';
    if (type === 'tali') return 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30';
    if (type === 'khali') return 'bg-violet-500/20 text-violet-300 border-violet-500/40 hover:bg-violet-500/30';
    return 'bg-slate-800/40 text-slate-300 border-slate-700/60 hover:bg-slate-700/40';
  };

  const getBeadColorHex = (type, isActive) => {
    if (isActive) return '#10b981'; 
    if (type === 'tali') return '#f43f5e'; 
    if (type === 'khali') return '#8b5cf6'; 
    return '#475569'; 
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-12 flex flex-col justify-between selection:bg-emerald-500/20 selection:text-emerald-300 bg-grid-pattern">
      
      {/* 🧭 NAVIGATION HEADER */}
      <header className="sticky top-0 z-40 w-full glass-nav border-b border-slate-900/60 backdrop-blur-lg">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400 shadow-md">
              <Music className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h1 className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-emerald-400 to-teal-200 bg-clip-text text-transparent glow-text">
                TaalMantra
              </h1>
              <p className="text-[10px] text-slate-400 font-medium tracking-widest uppercase">Classical Metronome</p>
            </div>
          </div>
          <button 
            onClick={() => setIsCreatorOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold rounded-lg shadow-lg shadow-emerald-500/10 transition-all duration-300 hover:scale-[1.03] active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Taal</span>
          </button>
        </div>
      </header>

      {/* 🔮 MAIN CONTENT */}
      <main className="max-w-6xl mx-auto px-4 w-full flex-grow mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* LEFT PANEL: PLAYER & CONTROLS (7 columns) */}
        <section className="lg:col-span-7 flex flex-col gap-6 w-full">
          
          {/* Main Visualizer & Player Box */}
          <div className="cyber-card rounded-2xl p-6 flex flex-col items-center justify-center border border-slate-900 relative overflow-hidden bg-slate-900/40 backdrop-blur-md">
            
            {/* Ambient Glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-emerald-500/5 blur-3xl rounded-full pointer-events-none"></div>

            {/* Circular Beat Bead Visualizer */}
            <div className="relative w-60 h-60 mb-6">
              <svg className="w-full h-full transform -rotate-90">
                <circle 
                  cx="120" 
                  cy="120" 
                  r="98" 
                  className="stroke-slate-800 fill-none" 
                  strokeWidth="2" 
                />
                {currentTaal.structure.map((type, idx) => {
                  const angle = (idx / currentTaal.beats) * 2 * Math.PI;
                  const radius = 98;
                  const x = 120 + radius * Math.cos(angle);
                  const y = 120 + radius * Math.sin(angle);
                  const isActive = idx === activeBeat;
                  return (
                    <circle
                      key={idx}
                      cx={x}
                      cy={y}
                      r={isActive ? 8 : 5}
                      fill={getBeadColorHex(type, isActive)}
                      className="transition-all duration-150 cursor-pointer"
                      onClick={() => {
                        setActiveBeat(idx);
                        beatIndexRef.current = idx;
                        if (isPlaying) {
                          nextNoteTimeRef.current = engine.ctx.currentTime + 0.01;
                        }
                      }}
                    />
                  );
                })}
              </svg>
              
              {/* Inner Circle Information */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center flex flex-col items-center justify-center">
                <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Beat</span>
                <span className="text-4xl font-black text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]">
                  {activeBeat + 1}
                </span>
                <span className="text-[11px] font-bold text-slate-300 mt-1 uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-slate-800/80 border border-slate-700/30">
                  {currentTaal.bols[activeBeat]}
                </span>
                <span className="text-[8px] text-slate-400 mt-1 uppercase tracking-widest">
                  {currentTaal.structure[activeBeat] === 'tali' ? '👏 Clap / Tali' : 
                   currentTaal.structure[activeBeat] === 'khali' ? '🫱 Wave / Khali' : '• Matra'}
                </span>
              </div>
            </div>

            {/* Horizontal Syllables Sequence */}
            <div className="w-full flex gap-1.5 overflow-x-auto py-3 px-2 border-y border-slate-800/40 mb-6 scrollbar-thin">
              {currentTaal.bols.map((bol, idx) => {
                const isActive = idx === activeBeat;
                const type = currentTaal.structure[idx];
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      setActiveBeat(idx);
                      beatIndexRef.current = idx;
                      if (isPlaying) {
                        nextNoteTimeRef.current = engine.ctx.currentTime + 0.01;
                      }
                    }}
                    className={`flex-shrink-0 min-w-14 px-2 py-2 border rounded-lg text-center transition-all duration-200 cursor-pointer ${getBeatColorClass(type, isActive)}`}
                  >
                    <div className="text-[10px] font-bold block mb-0.5 text-slate-400 uppercase tracking-widest">
                      {idx + 1}
                    </div>
                    <div className="text-xs font-black tracking-tight">{bol}</div>
                  </button>
                );
              })}
            </div>

            {/* Main Audio Controls */}
            <div className="w-full flex items-center justify-between gap-4">
              <button 
                onClick={resetMetronome}
                className="p-3 bg-slate-800/50 hover:bg-slate-700/60 text-slate-300 hover:text-slate-100 border border-slate-700/40 rounded-xl transition-all duration-200 active:scale-95 cursor-pointer"
                title="Reset Beat"
              >
                <RotateCcw className="w-5 h-5" />
              </button>

              <button 
                onClick={togglePlay}
                className="w-14 h-14 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/20 hover:shadow-emerald-400/40 transition-all duration-300 hover:scale-105 active:scale-95 cursor-pointer"
              >
                {isPlaying ? <Pause className="w-6 h-6 fill-slate-950" /> : <Play className="w-6 h-6 fill-slate-950 ml-0.5" />}
              </button>

              {/* Sound Mode Select Panel */}
              <div className="flex flex-col sm:flex-row gap-2 items-center">
                <div className="flex bg-slate-800/50 border border-slate-700/40 rounded-xl p-1">
                  <button 
                    onClick={() => setSoundMode('tabla')}
                    className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${soundMode === 'tabla' ? 'bg-emerald-500 text-slate-950 font-bold shadow' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    Tabla
                  </button>
                  <button 
                    onClick={() => setSoundMode('studio')}
                    className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${soundMode === 'studio' ? 'bg-emerald-500 text-slate-950 font-bold shadow' : 'text-slate-400 hover:text-slate-200'}`}
                    title="Accented click on Beat 1, simple tick on others"
                  >
                    Metronome
                  </button>
                  <button 
                    onClick={() => setSoundMode('drum')}
                    className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${soundMode === 'drum' ? 'bg-emerald-500 text-slate-950 font-bold shadow' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    Drums
                  </button>
                </div>

                {/* Loop / Stroke Toggle for Tabla Mode */}
                {soundMode === 'tabla' && (
                  <div className="flex bg-slate-800/50 border border-slate-700/40 rounded-xl p-1">
                    <button 
                      onClick={() => setTablaMode('single')}
                      className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${tablaMode === 'single' ? 'bg-emerald-500 text-slate-950 font-bold shadow' : 'text-slate-400 hover:text-slate-200'}`}
                      title="Play recorded individual strokes on each beat"
                    >
                      Strokes
                    </button>
                    <button 
                      onClick={() => setTablaMode('loop')}
                      className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${tablaMode === 'loop' ? 'bg-emerald-500 text-slate-950 font-bold shadow' : 'text-slate-400 hover:text-slate-200'}`}
                      title="Play continuous recorded loop of the Taal"
                    >
                      Real Loop
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Settings Sliders */}
          <div className="cyber-card rounded-2xl p-5 border border-slate-900 bg-slate-900/40 backdrop-blur-md">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-2">
              <Sliders className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Tempo & Volume Settings</h3>
            </div>

            <div className="flex flex-col gap-4">
              {/* Tempo slider */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tempo Speed</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-base font-black text-emerald-400">{bpm}</span>
                    <span className="text-[9px] text-slate-400 font-bold uppercase">BPM</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setBpm(b => Math.max(40, b - 5))}
                    className="w-8 h-8 flex items-center justify-center bg-slate-800/80 hover:bg-slate-700/80 rounded-lg text-slate-300 font-bold text-sm border border-slate-700/40 active:scale-95"
                  >
                    -
                  </button>
                  <input 
                    type="range" 
                    min="40" 
                    max="240" 
                    value={bpm}
                    onChange={(e) => setBpm(parseInt(e.target.value))}
                    className="flex-grow h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                  <button 
                    onClick={() => setBpm(b => Math.min(240, b + 5))}
                    className="w-8 h-8 flex items-center justify-center bg-slate-800/80 hover:bg-slate-700/80 rounded-lg text-slate-300 font-bold text-sm border border-slate-700/40 active:scale-95"
                  >
                    +
                  </button>
                </div>
                
                {/* Tempo Presets */}
                <div className="flex gap-2 mt-3">
                  <button 
                    onClick={() => setTempoPreset('slow')}
                    className="flex-grow py-1 bg-slate-800/40 hover:bg-slate-800/80 border border-slate-700/30 text-[9px] font-extrabold text-slate-300 rounded-md tracking-wider uppercase"
                  >
                    Vilambit (60)
                  </button>
                  <button 
                    onClick={() => setTempoPreset('medium')}
                    className="flex-grow py-1 bg-slate-800/40 hover:bg-slate-800/80 border border-slate-700/30 text-[9px] font-extrabold text-slate-300 rounded-md tracking-wider uppercase"
                  >
                    Madhya (120)
                  </button>
                  <button 
                    onClick={() => setTempoPreset('fast')}
                    className="flex-grow py-1 bg-slate-800/40 hover:bg-slate-800/80 border border-slate-700/30 text-[9px] font-extrabold text-slate-300 rounded-md tracking-wider uppercase"
                  >
                    Drut (200)
                  </button>
                </div>
              </div>

              {/* Rhythm volume */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Metronome Volume</span>
                  <span className="text-xs font-bold text-slate-200">{Math.round(volume * 100)}%</span>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setVolume(v => v === 0 ? 0.8 : 0)}
                    className="text-slate-400 hover:text-slate-200"
                  >
                    {volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                  </button>
                  <input 
                    type="range" 
                    min="0" 
                    max="1" 
                    step="0.05"
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="flex-grow h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>
              </div>
            </div>
          </div>

        </section>

        {/* RIGHT PANEL: TANPURA & RAAG DRONE + TAALS SELECTION (5 columns) */}
        <section className="lg:col-span-5 flex flex-col gap-6 w-full">
          
          {/* 🎻 TANPURA ACCOMPANIMENT CARD */}
          <div className="cyber-card rounded-2xl p-5 border border-slate-900 bg-slate-900/40 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-4">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Tanpura Accompaniment</h3>
              </div>
              
              {/* Tanpura Toggle Switch */}
              <button 
                onClick={() => setIsTanpuraOn(!isTanpuraOn)}
                className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${isTanpuraOn ? 'bg-emerald-500 text-slate-950 shadow' : 'bg-slate-800 text-slate-400 border border-slate-700/60'}`}
              >
                {isTanpuraOn ? 'Active' : 'Muted'}
              </button>
            </div>

            <div className="flex flex-col gap-4">
              {/* Tanpura Tone Engine selector */}
              <div>
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-2">Tone Engine</label>
                <div className="flex bg-slate-950/40 border border-slate-800/60 rounded-xl p-1">
                  <button 
                    onClick={() => setTanpuraMode('real')}
                    className={`flex-grow py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${tanpuraMode === 'real' ? 'bg-emerald-500/20 text-emerald-300 shadow' : 'text-slate-500 hover:text-slate-300'}`}
                    title="Real recorded acoustic Tanpura drone loop"
                  >
                    Real Instrument
                  </button>
                  <button 
                    onClick={() => setTanpuraMode('synth')}
                    className={`flex-grow py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${tanpuraMode === 'synth' ? 'bg-emerald-500/20 text-emerald-300 shadow' : 'text-slate-500 hover:text-slate-300'}`}
                    title="Synthesized mathematical drone model"
                  >
                    Synthesized
                  </button>
                </div>
              </div>

              {/* Scale / Key selector */}
              <div>
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-2">Scale/Key Pitch</label>
                <div className="grid grid-cols-6 gap-1 bg-slate-950/40 p-1.5 rounded-xl border border-slate-800/60 text-center">
                  {SCALES.map((item) => (
                    <button
                      key={item.note}
                      onClick={() => setTanpuraScale(item)}
                      className={`py-1.5 text-xs font-black rounded-lg transition-all ${tanpuraScale.note === item.note ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'}`}
                    >
                      {item.note}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tuning / Volume Row */}
              <div className="grid grid-cols-3 gap-3">
                {/* Tuning selector (Only visible/enabled in Synth mode) */}
                <div className={tanpuraMode === 'synth' ? '' : 'opacity-40 pointer-events-none'}>
                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Tuning Mode</label>
                  <div className="flex bg-slate-950/40 border border-slate-800/60 rounded-xl p-1">
                    <button 
                      onClick={() => setTanpuraTuning('pa')}
                      className={`flex-grow py-1 rounded-lg text-[9px] font-bold uppercase transition-all ${tanpuraTuning === 'pa' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-500 hover:text-slate-300'}`}
                      title="Pancham (Pa-Sa-Sa-Sa)"
                      disabled={tanpuraMode !== 'synth'}
                    >
                      Pa
                    </button>
                    <button 
                      onClick={() => setTanpuraTuning('ma')}
                      className={`flex-grow py-1 rounded-lg text-[9px] font-bold uppercase transition-all ${tanpuraTuning === 'ma' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-500 hover:text-slate-300'}`}
                      title="Madhyam (Ma-Sa-Sa-Sa)"
                      disabled={tanpuraMode !== 'synth'}
                    >
                      Ma
                    </button>
                    <button 
                      onClick={() => setTanpuraTuning('ni')}
                      className={`flex-grow py-1 rounded-lg text-[9px] font-bold uppercase transition-all ${tanpuraTuning === 'ni' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-500 hover:text-slate-300'}`}
                      title="Nishad (Ni-Sa-Sa-Sa)"
                      disabled={tanpuraMode !== 'synth'}
                    >
                      Ni
                    </button>
                  </div>
                </div>
                
                {/* Tanpura volume */}
                <div className={tanpuraMode === 'synth' ? 'col-span-2' : 'col-span-3'}>
                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Tanpura Volume</label>
                  <div className="flex items-center gap-2 mt-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-slate-400" />
                    <input 
                      type="range" 
                      min="0" 
                      max="1" 
                      step="0.05"
                      value={tanpuraVolume}
                      onChange={(e) => setTanpuraVolume(parseFloat(e.target.value))}
                      className="flex-grow h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 🪈 RAAG MELODY GUIDE CARD */}
          <div className="cyber-card rounded-2xl p-5 border border-slate-900 bg-slate-900/40 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-4">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-emerald-400 animate-pulse" />
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Raag Scale Guide</h3>
              </div>
              
              {/* Melody switch */}
              <button 
                onClick={() => setIsRaagMelodyOn(!isRaagMelodyOn)}
                className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${isRaagMelodyOn ? 'bg-emerald-500 text-slate-950 shadow' : 'bg-slate-800 text-slate-400 border border-slate-700/60'}`}
                title="Play notes of the Raag scale in sync with the BPM tempo. Can play over Tanpura."
              >
                {isRaagMelodyOn ? 'Melody On' : 'Melody Off'}
              </button>
            </div>

            <div className="flex flex-col gap-4">
              {/* Select Raag */}
              <div>
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-2">Select Raag</label>
                <div className="grid grid-cols-2 gap-2">
                  {RAAGS.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setSelectedRaag(r)}
                      className={`p-2 text-left rounded-xl border transition-all ${selectedRaag.id === r.id ? 'bg-emerald-500/10 border-emerald-400 text-emerald-300' : 'bg-slate-950/40 hover:bg-slate-800/40 border-slate-800 hover:border-slate-700/60 text-slate-400'}`}
                    >
                      <div className="text-xs font-black tracking-wide">{r.name}</div>
                      <div className="text-[9px] opacity-75 mt-0.5 line-clamp-1">{r.notes}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Raga Details Panel */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900 text-xs">
                <p className="text-slate-400 leading-relaxed mb-2">
                  {selectedRaag.desc}
                </p>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/60">
                  <div>
                    <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest block mb-0.5">Aroha (Ascending)</span>
                    <span className="font-extrabold text-slate-200 tracking-wider">{selectedRaag.aroha.join(' ')}</span>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest block mb-0.5">Avroha (Descending)</span>
                    <span className="font-extrabold text-slate-200 tracking-wider">{selectedRaag.avroha.join(' ')}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* TAAL LIST BOX */}
          <div className="cyber-card rounded-2xl p-5 border border-slate-900 bg-slate-900/40 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Music className="w-4 h-4 text-emerald-400 animate-pulse" />
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Select Taal</h3>
              </div>
              <span className="text-[10px] bg-slate-800 text-emerald-300 px-2 py-0.5 border border-emerald-500/20 rounded-full font-semibold">
                {taals.length} Available
              </span>
            </div>

            <div className="flex flex-col gap-2.5 max-h-[300px] overflow-y-auto pr-1.5 scrollbar-thin">
              {taals.map((taal) => {
                const isSelected = currentTaal.id === taal.id;
                return (
                  <div
                    key={taal.id}
                    onClick={() => selectTaal(taal)}
                    className={`group w-full flex items-center justify-between p-3.5 border rounded-xl cursor-pointer text-left transition-all duration-300 hover:translate-x-1 ${isSelected ? 'bg-emerald-500/10 border-emerald-400 shadow-md shadow-emerald-500/5' : 'bg-slate-900/50 hover:bg-slate-800/40 border-slate-800/80 hover:border-slate-700/60'}`}
                  >
                    <div className="flex-grow">
                      <div className="flex items-center gap-2">
                        <h4 className={`font-extrabold text-sm tracking-wide ${isSelected ? 'text-emerald-400' : 'text-slate-100 group-hover:text-emerald-300'}`}>
                          {taal.name}
                        </h4>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-bold uppercase tracking-wider">
                          {taal.beats} Beats
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 line-clamp-1">
                        {taal.description}
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-1">
                      {taal.isCustom && (
                        <button 
                          onClick={(e) => deleteCustomTaal(taal.id, e)}
                          className="p-1.5 text-slate-400 hover:text-rose-400 rounded-md hover:bg-rose-500/10 transition-colors"
                          title="Delete Custom Taal"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <ChevronRight className={`w-4 h-4 transition-transform duration-300 ${isSelected ? 'text-emerald-400 translate-x-0.5' : 'text-slate-500 group-hover:text-slate-300'}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </section>

      </main>

      {/* 🛠️ CUSTOM TAAL CREATOR MODAL */}
      {isCreatorOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="cyber-card rounded-2xl w-full max-w-xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden relative animate-in fade-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-900/60">
              <div className="flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-emerald-400" />
                <h3 className="font-black text-lg tracking-wide text-slate-100">Create Custom Taal</h3>
              </div>
              <button 
                onClick={() => setIsCreatorOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700/80 border border-slate-700/40 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 flex flex-col gap-5 max-h-[65vh] overflow-y-auto">
              
              {/* Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Taal Name</label>
                <input 
                  type="text"
                  placeholder="e.g. My Raga Taal"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-emerald-500 transition-colors w-full"
                />
              </div>

              {/* Beats count */}
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Number of Beats</label>
                  <span className="text-sm font-black text-emerald-400">{customBeats}</span>
                </div>
                <input 
                  type="range"
                  min="3"
                  max="24"
                  value={customBeats}
                  onChange={(e) => handleCustomBeatsChange(e.target.value)}
                  className="w-full h-1.5 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
              </div>

              {/* Config sequence */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Configure Beats Sequence</label>
                <p className="text-[10px] text-slate-400 leading-normal mb-1">
                  Tap a beat circle to cycle its sound type: <b className="text-slate-300">Normal (Gray)</b> → <b className="text-rose-400">Clap (Red)</b> → <b className="text-violet-400">Wave (Purple)</b>.
                </p>
                
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 bg-slate-950/40 p-3 rounded-xl border border-slate-800/60 max-h-48 overflow-y-auto">
                  {Array.from({ length: customBeats }).map((_, idx) => {
                    const type = customStructure[idx] || 'normal';
                    return (
                      <div 
                        key={idx}
                        className="flex flex-col items-center gap-1.5 bg-slate-900/60 p-1.5 border border-slate-800/40 rounded-lg"
                      >
                        <span className="text-[9px] font-bold text-slate-500">{idx + 1}</span>
                        <button
                          onClick={() => toggleCreatorBeatType(idx)}
                          className={`w-8 h-8 rounded-full border transition-all flex items-center justify-center text-xs font-bold ${getBeatColorClass(type, false)}`}
                        >
                          {type === 'tali' ? '👏' : type === 'khali' ? '🫱' : '•'}
                        </button>
                        <input 
                          type="text"
                          value={customBols[idx] || 'Dha'}
                          onChange={(e) => updateCreatorBol(idx, e.target.value)}
                          className="w-full text-center text-[10px] font-bold py-0.5 bg-slate-950 border border-slate-800 rounded text-slate-300 focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-900/60 flex gap-3 justify-end">
              <button 
                onClick={() => setIsCreatorOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700/80 text-slate-300 hover:text-slate-100 text-xs font-bold rounded-lg border border-slate-700/40 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button 
                onClick={saveCustomTaal}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg shadow-lg shadow-emerald-500/10 transition-all duration-300 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save & Select</span>
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 📜 FOOTER */}
      <footer className="w-full text-center mt-12 pt-6 border-t border-slate-900/60 text-slate-500 text-xs flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-1">
          <Globe className="w-3.5 h-3.5 text-slate-600" />
          <span>TaalMantra Indian Metronome App</span>
        </div>
        <p className="text-[9px] tracking-wide text-slate-600 uppercase font-bold">
          Synthesized natively with Web Audio API. 100% Offline Compatible.
        </p>
      </footer>
    </div>
  );
}