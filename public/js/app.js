/**
 * RIKO AI - Voice-first assistant with YouTube control
 * Say "Riko" once → persistent voice mode
 * Say "play [song]", "YouTube open karo" → opens YouTube
 */
import { VRMManager } from './vrm-manager.js';

class RikoApp {
    constructor() {
        this.vrmManager = null;
        this.synthesis = window.speechSynthesis;
        this.hindiVoice = null;
        this.apiKey = localStorage.getItem('riko_api_key') || '';

        this.voiceModeActive = false;
        this.isListening = false;
        this.isProcessing = false;
        this.isSpeaking = false;

        this.wakeRecognition = null;
        this.voiceRecognition = null;

        this.WAKE_WORDS = ['riko', 'rico', 'reeko', 'reko', 'रीको', 'रिको'];
        this.MIN_SPEECH_LENGTH = 2;



        this._init();
    }

    async _init() {
        const canvas = document.getElementById('vrm-canvas');
        this.vrmManager = new VRMManager(canvas);

        await this._loadDefaultVRM();
        this._setupUI();
        this._setupTTS();
        this._checkApiKey();


        setTimeout(() => this._startWakeWordListener(), 1500);
    }

    async _loadDefaultVRM() {
        const urls = [
            '/public/models/model.vrm',
            'https://cdn.jsdelivr.net/gh/pixiv/three-vrm@dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm'
        ];
        for (const url of urls) {
            try { await this.vrmManager.loadModel(url); return; } catch (e) { }
        }
        this._showToast('VRM model upload karo Settings mein', 'error');
    }

    // ========================================
    //  ACTION TAG PARSER
    //  Parses [ACTION:TYPE:value] from AI response
    // ========================================

    _parseAndExecuteActions(response) {
        const actionRegex = /\[ACTION:(YOUTUBE|GOOGLE|OPEN):(.+?)\]/g;
        let match;
        let cleanResponse = response;

        while ((match = actionRegex.exec(response)) !== null) {
            const type = match[1];
            const value = match[2].trim();

            // Remove the action tag from displayed/spoken text
            cleanResponse = cleanResponse.replace(match[0], '').trim();

            switch (type) {
                case 'YOUTUBE':
                    window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(value)}`, '_blank');
                    console.log(`🎵 YouTube: ${value}`);
                    break;
                case 'GOOGLE':
                    window.open(`https://www.google.com/search?q=${encodeURIComponent(value)}`, '_blank');
                    console.log(`🔍 Google: ${value}`);
                    break;
                case 'OPEN':
                    window.open(value, '_blank');
                    console.log(`🌐 Open: ${value}`);
                    break;
            }
        }

        return cleanResponse;
    }

    // ========================================
    //  WAKE WORD LISTENER
    // ========================================

    _startWakeWordListener() {
        if (this.voiceModeActive) return;
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return;

        this.wakeRecognition = new SR();
        this.wakeRecognition.lang = 'hi-IN';
        this.wakeRecognition.continuous = true;
        this.wakeRecognition.interimResults = true;
        this.wakeRecognition.maxAlternatives = 3;

        this.wakeRecognition.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                for (let j = 0; j < event.results[i].length; j++) {
                    const text = event.results[i][j].transcript.toLowerCase().trim();
                    if (this.WAKE_WORDS.some(w => text.includes(w))) {
                        this._stopWakeListener();
                        let afterWake = '';
                        for (const w of this.WAKE_WORDS) {
                            const idx = text.indexOf(w);
                            if (idx >= 0) { afterWake = text.substring(idx + w.length).trim(); break; }
                        }
                        this._enterVoiceMode(afterWake);
                        return;
                    }
                }
            }
        };

        this.wakeRecognition.onend = () => {
            if (!this.voiceModeActive) {
                setTimeout(() => {
                    if (!this.voiceModeActive) try { this.wakeRecognition.start(); } catch (e) { }
                }, 200);
            }
        };

        this.wakeRecognition.onerror = (e) => {
            if (e.error !== 'no-speech' && e.error !== 'aborted') console.warn('Wake:', e.error);
        };

        try { this.wakeRecognition.start(); } catch (e) { }
    }

    _stopWakeListener() {
        try { this.wakeRecognition?.stop(); } catch (e) { }
    }

    // ========================================
    //  PERSISTENT VOICE MODE
    // ========================================

    _enterVoiceMode(initialMessage = '') {
        this.voiceModeActive = true;
        this._setStatus('voice-mode', '🎤');
        document.getElementById('micBtn').classList.add('voice-mode');
        document.getElementById('miniStatus').classList.add('active');

        if (initialMessage && initialMessage.length > this.MIN_SPEECH_LENGTH) {
            this._processMessage(initialMessage);
        } else {
            this._showSubtitle('✨');
            setTimeout(() => this._clearSubtitle(), 1000);
            this._startPersistentListening();
        }
    }

    _startPersistentListening() {
        if (this.isProcessing || this.isSpeaking || !this.voiceModeActive) return;

        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return;

        if (this.voiceRecognition) try { this.voiceRecognition.stop(); } catch (e) { }

        this.voiceRecognition = new SR();
        this.voiceRecognition.lang = 'hi-IN';
        this.voiceRecognition.continuous = true;
        this.voiceRecognition.interimResults = true;
        this.voiceRecognition.maxAlternatives = 1;

        this.voiceRecognition.onresult = (event) => {
            let final = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const t = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    final += t;
                } else {
                    this._setStatus('listening', '🎤');
                    document.getElementById('miniDot').className = 'mini-dot listening';
                }
            }

            if (final) {
                const cleaned = this._cleanTranscript(final);
                if (cleaned.length > this.MIN_SPEECH_LENGTH) {
                    this._stopVoiceRecognition();
                    this._processMessage(cleaned);
                }
            }
        };

        this.voiceRecognition.onend = () => {
            this.isListening = false;
            if (this.voiceModeActive && !this.isProcessing && !this.isSpeaking) {
                setTimeout(() => this._startPersistentListening(), 300);
            }
        };

        this.voiceRecognition.onerror = (e) => {
            if (e.error !== 'no-speech' && e.error !== 'aborted') console.warn('Voice:', e.error);
        };

        this.voiceRecognition.onstart = () => {
            this.isListening = true;
            document.getElementById('miniDot').className = 'mini-dot voice-mode';
            this._setStatus('voice-mode', '🎤');
        };

        try { this.voiceRecognition.start(); }
        catch (e) { setTimeout(() => this._startPersistentListening(), 500); }
    }

    _stopVoiceRecognition() {
        try { this.voiceRecognition?.stop(); } catch (e) { }
        this.isListening = false;
    }

    _cleanTranscript(text) {
        let cleaned = text.toLowerCase();
        for (const w of this.WAKE_WORDS) cleaned = cleaned.replace(w, '');
        return cleaned.trim();
    }



    // ========================================
    //  MESSAGE PROCESSING
    // ========================================

    async _processMessage(message, isRetry = false) {
        if (!message || (this.isProcessing && !isRetry)) return;

        this.isProcessing = true;
        this._setStatus('thinking', '🤔');
        document.getElementById('miniDot').className = 'mini-dot thinking';

        if (this.vrmManager?.isLoaded) this.vrmManager.showThinking();
        if (!isRetry) this._storeMessage('user', message);



        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, api_key: this.apiKey })
            });

            if (!res.ok) throw new Error((await res.json()).detail || 'Server error');
            const data = await res.json();

            if (this.vrmManager?.isLoaded) this.vrmManager.stopThinking();

            // Parse action tags from AI response and execute them
            const cleanResponse = this._parseAndExecuteActions(data.response);

            this._showSubtitle(cleanResponse);
            this._storeMessage('assistant', cleanResponse);
            this._showEmotion(cleanResponse);
            this._speak(cleanResponse);

        } catch (error) {
            console.error('Processing Error:', error);

            // SILENT RETRY LOGIC
            if (!isRetry) {
                console.log('🔄 Silent Retry initiated...');
                await new Promise(r => setTimeout(r, 1500)); // Wait 1.5s
                this._processMessage(message, true); // Retry once
                return;
            }

            if (this.vrmManager?.isLoaded) this.vrmManager.stopThinking();

            // Force reset TTS
            this.synthesis.cancel();

            // Show error only after retry failed
            const errorMsg = 'Sorry yaar, connection weak hai. Phir se bolo? 😅';
            this._showSubtitle(errorMsg);
            this._speak(errorMsg);

            this.isProcessing = false;

            // Ensure we restart listening even after error
            if (this.voiceModeActive) {
                setTimeout(() => {
                    console.log('🔄 Restarting listener after error...');
                    this._startPersistentListening();
                }, 3000);
            }
        }
    }

    _showEmotion(response) {
        if (!this.vrmManager?.isLoaded) return;
        const r = response.toLowerCase();
        if (r.includes('😊') || r.includes('good') || r.includes('nice') || r.includes('cool')) this.vrmManager.showHappy();
        else if (r.includes('😅') || r.includes('sorry') || r.includes('maaf')) this.vrmManager.showSad();
        else if (r.includes('!') || r.includes('wow') || r.includes('amazing')) this.vrmManager.showSurprised();
        else this.vrmManager.nod();
    }

    // ========================================
    //  TTS
    // ========================================

    _speak(text) {
        this.synthesis.cancel();
        const clean = text.replace(/\*\*/g, '').replace(/[😊🙏🤔😅🎉💡❤️👋🔥✨🤖⚡💪🎊😄😁🥰😢🎵🎬🌐🔍]/g, '').replace(/\s+/g, ' ').trim();
        if (!clean) { this._onSpeechEnd(); return; }

        const utt = new SpeechSynthesisUtterance(clean);
        if (this.hindiVoice) utt.voice = this.hindiVoice;
        utt.lang = 'hi-IN'; // Force Hindi lang code
        utt.rate = 1.0;
        utt.pitch = 1.0;
        utt.volume = 1.0;

        console.log(`🗣️ Speaking: "${clean}" using ${utt.voice ? utt.voice.name : 'default'}`);

        utt.onstart = () => {
            this.isSpeaking = true;
            this._setStatus('speaking', '🔊');
            document.getElementById('miniDot').className = 'mini-dot speaking';
            if (this.vrmManager?.isLoaded) this.vrmManager.startSpeaking();
        };

        utt.onend = () => this._onSpeechEnd();
        utt.onerror = () => this._onSpeechEnd();

        this.synthesis.speak(utt);
    }

    _onSpeechEnd() {
        this.isSpeaking = false;
        this.isProcessing = false;
        if (this.vrmManager?.isLoaded) this.vrmManager.stopSpeaking();
        setTimeout(() => this._clearSubtitle(), 3000);

        if (this.voiceModeActive) {
            this._setStatus('voice-mode', '🎤');
            document.getElementById('miniDot').className = 'mini-dot voice-mode';
            setTimeout(() => this._startPersistentListening(), 500);
        }
    }

    // ========================================
    //  UI
    // ========================================

    _setupUI() {
        document.getElementById('micBtn').addEventListener('click', () => {
            if (this.voiceModeActive) {
                this.voiceModeActive = false;
                this._stopVoiceRecognition();
                document.getElementById('micBtn').classList.remove('active', 'voice-mode');
                document.getElementById('miniStatus').classList.remove('active');
                this._setStatus('', '');
                setTimeout(() => this._startWakeWordListener(), 500);
            } else {
                this._stopWakeListener();
                this._enterVoiceMode();
            }
        });

        document.getElementById('settingsBtn').addEventListener('click', () => this._openSettings());
        document.getElementById('closeSettings').addEventListener('click', () => this._closeSettings());
        document.getElementById('saveKeyBtn').addEventListener('click', () => this._saveApiKey());
        document.getElementById('testAudioBtn')?.addEventListener('click', () => this._testAudio());
        document.getElementById('clearShortBtn').addEventListener('click', () => this._clearMemory('short'));
        document.getElementById('clearAllBtn').addEventListener('click', () => this._clearMemory('all'));

        const dz = document.getElementById('vrmDropzone');
        dz.addEventListener('click', () => document.getElementById('vrmFileInput').click());
        dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
        dz.addEventListener('drop', (e) => {
            e.preventDefault(); dz.classList.remove('drag-over');
            const f = e.dataTransfer.files[0];
            if (f?.name.endsWith('.vrm')) this._loadVRM(f);
        });
        document.getElementById('vrmFileInput').addEventListener('change', (e) => {
            if (e.target.files[0]) this._loadVRM(e.target.files[0]);
        });
        document.getElementById('settingsModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('settingsModal')) this._closeSettings();
        });
    }

    _setupTTS() {
        const load = () => {
            let voices = this.synthesis.getVoices();

            // If no voices, retry for a bit
            if (voices.length === 0) {
                setTimeout(load, 500);
                return;
            }

            console.log('🎤 Loaded voices:', voices.length);

            // Try to find a good Hindi voice
            this.hindiVoice =
                voices.find(v => v.lang === 'hi-IN' && v.name.includes('Google')) ||
                voices.find(v => v.lang === 'hi-IN' && v.name.includes('Neural')) ||
                voices.find(v => v.lang === 'hi-IN') ||
                voices.find(v => v.lang.startsWith('hi')) ||
                voices.find(v => v.lang === 'en-IN') ||
                voices[0];

            if (this.hindiVoice) {
                console.log('✅ Selected Voice:', this.hindiVoice.name);
            } else {
                console.warn('⚠️ No specific voice found, using system default.');
            }
        };

        load();
        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = load;
        }
    }

    _testAudio() {
        this.synthesis.cancel();
        const utt = new SpeechSynthesisUtterance("Namaste! Meri awaaz aa rahi hai?");
        if (this.hindiVoice) utt.voice = this.hindiVoice;
        utt.lang = 'hi-IN';
        utt.volume = 1.0;
        utt.rate = 1.0;
        console.log('🔊 Testing Audio with:', utt.voice ? utt.voice.name : 'Default');
        this.synthesis.speak(utt);
    }

    _checkApiKey() { if (!this.apiKey) this._showApiKeyOverlay(); }

    _showApiKeyOverlay() {
        const ov = document.createElement('div');
        ov.className = 'api-key-overlay'; ov.id = 'apiKeyOverlay';
        ov.innerHTML = `<div class="api-key-card"><h1>⚡ RIKO</h1><p>Groq API key daalo (Free)</p><input type="password" id="overlayApiKey" placeholder="gsk_xxxx..."><button class="btn-primary" id="overlaySubmit">Start 🚀</button><p style="margin-top:12px"><a href="https://console.groq.com" target="_blank" style="color:#00e5ff">console.groq.com</a></p></div>`;
        document.body.appendChild(ov);
        document.getElementById('overlaySubmit').addEventListener('click', async () => {
            const key = document.getElementById('overlayApiKey').value.trim();
            if (!key) return;
            try {
                const r = await fetch('/api/key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: key }) });
                if (r.ok) { this.apiKey = key; localStorage.setItem('riko_api_key', key); ov.remove(); }
            } catch (e) { this._showToast('Server error', 'error'); }
        });
    }

    _setStatus(state, icon) {
        document.getElementById('miniDot').className = 'mini-dot' + (state ? ' ' + state : '');
        document.getElementById('miniText').textContent = icon;
    }

    _showSubtitle(text) {
        document.getElementById('subtitleBar').innerHTML = `<p>${text.replace(/\*\*/g, '').substring(0, 200)}</p>`;
    }

    _clearSubtitle() { document.getElementById('subtitleBar').innerHTML = ''; }

    _showToast(msg, type = 'error') {
        const t = document.createElement('div');
        t.className = 'toast' + (type === 'success' ? ' success' : '');
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 4000);
    }

    _storeMessage(role, content) {
        const div = document.createElement('div');
        div.dataset.role = role; div.textContent = content;
        document.getElementById('chatMessages').appendChild(div);
    }

    _openSettings() {
        document.getElementById('settingsModal').classList.add('show');
        document.getElementById('apiKeyInput').value = this.apiKey ? '****' + this.apiKey.slice(-4) : '';
        this._loadMemoryStats();
    }

    _closeSettings() { document.getElementById('settingsModal').classList.remove('show'); }

    _saveApiKey() {
        const key = document.getElementById('apiKeyInput').value.trim();
        if (!key || key.startsWith('****')) return;
        this.apiKey = key; localStorage.setItem('riko_api_key', key);
        fetch('/api/key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: key }) })
            .then(r => { if (r.ok) { this._showToast('Saved ✅', 'success'); this._closeSettings(); } });
    }

    async _loadMemoryStats() {
        try {
            const r = await fetch('/api/memory'); const d = await r.json();
            document.getElementById('memoryStats').innerHTML = `<div>📝 Recent: ${d.short_term?.length || 0}</div><div>🧠 Long-term: ${d.long_term?.length || 0}</div>`;
        } catch (e) { }
    }

    async _clearMemory(type) {
        const url = type === 'all' ? '/api/memory/clear-all' : '/api/memory/clear';
        if (type === 'all' && !confirm('Sab delete ho jaega!')) return;
        try { await fetch(url, { method: 'POST' }); this._showToast('Cleared 🧹', 'success'); if (type === 'all') location.reload(); } catch (e) { }
    }

    async _loadVRM(file) {
        try { await this.vrmManager.loadModelFromFile(file); this._showToast('VRM loaded ✅', 'success'); }
        catch (e) { this._showToast('VRM error', 'error'); }
    }
}

window.addEventListener('DOMContentLoaded', () => { window.riko = new RikoApp(); });
