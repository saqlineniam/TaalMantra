# 🥁 TaalMantra (তালমন্ত্র)
> **Indian Classical Metronome & Tanpura Drone Application**

TaalMantra is a standalone mobile metronome and drone accompaniment application designed for Indian Classical music practice (*Riyaz*). It combines real recorded acoustic loops, stroke-by-stroke audio scheduling, and physical-modeling synthesizers to deliver the authentic sounds of the Tabla and Tanpura in a lightweight, offline-first package.

---

## 🛠️ Tech Stack & Architecture

* **Frontend**: React (Functional Components, Hooks)
* **Audio Engine**: Web Audio API (AudioContext, AudioBufferSourceNode, WaveShaperNode, BiquadFilterNode)
* **Mobile Wrapper**: Capacitor CLI & Android SDK (WebView container bridging local assets)
* **Styling**: Vanilla CSS with dark mode aesthetic

### Directory Structure

```text
TaalMantra/
├── android/                 # Native Android Studio Project
├── public/
│   └── audio/               # Acoustic Tabla & Tanpura audio recordings (.wav)
├── src/
│   ├── App.jsx              # Main React Component & Audio Engine definition
│   ├── index.css            # Global styling and dark-mode variables
│   └── main.jsx             # React DOM entrypoint
├── package.json             # App scripts and dependencies configuration
└── capacitor.config.json    # Capacitor bridge configurations
```

---

## 🌟 App Capabilities & Modes

### 1. 🥁 Tabla Rhythm Guide
* **Acoustic Loops Mode**: Plays continuous, recorded cycles of popular Taals (Tintal, Dadra, Ektaal, Jhaptal, Rupak, Kaherwa/Bhajani) synced to the selected BPM.
* **Acoustic Strokes Mode**: Uses lookahead scheduling to play one-shot recordings of individual Tabla Bols (*Dha*, *Dhin*, *Na*, *Ta*, *Tin*, *Tun*, *Ge*, *Ke*) aligned with the Taal's syllable structure.
* **Synthesized metronomes**: Includes clean studio ticks and western drum kit options.

### 2. 🎻 Tanpura Drone
* **Recorded Instrument**: Plays a pitch-shifted acoustic Tanpura recording corresponding to your chosen scale.
* **Synthesized Model**: Synthesizes the four strings of a Tanpura (Pa/Ma/Ni-Sa-Sa-Sa) using additive sawtooth oscillators, slow detune LFOs, and waveshaper distortion curves to replicate the bridge contact buzz.

### 3. 🪈 Raag Melody guide
* Play flute-like sitar guide notes for classical Raags (Yaman, Bhairav, Bilawal, Kafi, Bhupali) pitch-synced to your scale key.

### 4. 🛠️ Custom Taal Creator
* Create custom rhythm cycles by defining the number of beats, stroke structures (Tali/Khali/Normal), and individual Bols.

---

## 🚀 Setup & Installation

### Local Web Development
1. Clone the repository:
   ```bash
   git clone https://github.com/saqlineniam/TaalMantra.git
   cd TaalMantra
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run local dev server:
   ```bash
   npm run dev
   ```

### Android Compilation
1. Build the production assets:
   ```bash
   npm run build
   ```
2. Sync the project files with Capacitor:
   ```bash
   npx cap sync
   ```
3. Assemble the debug APK:
   ```bash
   cd android
   ./gradlew assembleDebug
   ```

---

## 📄 License
This project is open-source under the MIT License.
All audio assets are owned by their respective open-source contributors.
