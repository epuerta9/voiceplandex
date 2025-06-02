class VoicePlandex {
    constructor() {
        this.terminal = null;
        this.fitAddon = null;
        this.ptyWebSocket = null;
        this.audioWebSocket = null;
        this.mediaRecorder = null;
        this.audioContext = null;
        this.isRecording = false;
        this.isConnected = false;
        this.settings = {
            ttsEnabled: true,
            ttsRate: 1.0,
            autoApply: true
        };
        this.jwtToken = null;
        
        this.init();
    }

    async init() {
        await this.initializeUI();
        await this.setupTerminal();
        await this.loadSettings();
        await this.checkHealth();
        await this.getAuthToken();
        await this.connectWebSockets();
        this.setupEventListeners();
    }

    async initializeUI() {
        // Update UI elements
        this.updateConnectionStatus(false);
        this.updateMicButton(false);
        
        // Show loading state
        const caption = document.getElementById('caption');
        caption.textContent = 'Initializing...';
        caption.className = 'caption partial';
    }

    async setupTerminal() {
        // Initialize xterm.js terminal
        this.terminal = new Terminal({
            cursorBlink: true,
            theme: {
                background: '#0d1117',
                foreground: '#f0f6fc',
                cursor: '#2f81f7',
                black: '#484f58',
                red: '#ff7b72',
                green: '#7ee787',
                yellow: '#d29922',
                blue: '#79c0ff',
                magenta: '#ffa657',
                cyan: '#39c5cf',
                white: '#b1bac4',
                brightBlack: '#6e7681',
                brightRed: '#ffa198',
                brightGreen: '#56d364',
                brightYellow: '#e3b341',
                brightBlue: '#79c0ff',
                brightMagenta: '#d2a8ff',
                brightCyan: '#39c5cf',
                brightWhite: '#f0f6fc'
            },
            fontSize: 14,
            fontFamily: 'SF Mono, Consolas, Liberation Mono, Menlo, monospace',
            rows: 24,
            cols: 80
        });

        this.fitAddon = new FitAddon.FitAddon();
        this.terminal.loadAddon(this.fitAddon);
        
        this.terminal.open(document.getElementById('terminal'));
        this.fitAddon.fit();

        // Handle terminal input
        this.terminal.onData((data) => {
            if (this.ptyWebSocket && this.ptyWebSocket.readyState === WebSocket.OPEN) {
                this.ptyWebSocket.send(data);
            }
        });

        // Handle window resize
        window.addEventListener('resize', () => {
            this.fitAddon.fit();
        });
    }

    async loadSettings() {
        try {
            const saved = localStorage.getItem('voicePlandexSettings');
            if (saved) {
                this.settings = { ...this.settings, ...JSON.parse(saved) };
            }
            this.applySettings();
        } catch (error) {
            console.warn('Failed to load settings:', error);
        }
    }

    applySettings() {
        document.getElementById('tts-enabled').checked = this.settings.ttsEnabled;
        document.getElementById('tts-rate').value = this.settings.ttsRate;
        document.getElementById('tts-rate-value').textContent = this.settings.ttsRate.toFixed(1);
        document.getElementById('auto-apply').checked = this.settings.autoApply;
    }

    saveSettings() {
        try {
            localStorage.setItem('voicePlandexSettings', JSON.stringify(this.settings));
        } catch (error) {
            console.warn('Failed to save settings:', error);
        }
    }

    async checkHealth() {
        try {
            const response = await fetch('/api/health');
            const health = await response.json();
            
            const openaiStatus = document.getElementById('openai-status');
            if (health.openai_configured) {
                openaiStatus.textContent = 'OpenAI: Ready';
                openaiStatus.className = 'status-indicator online';
            } else {
                openaiStatus.textContent = 'OpenAI: Not configured';
                openaiStatus.className = 'status-indicator offline';
            }

            if (!health.plandex_available) {
                this.showError('Plandex not found in system PATH. Please install Plandex CLI.');
            }
        } catch (error) {
            console.warn('Health check failed:', error);
            this.showError('Failed to connect to server');
        }
    }

    async getAuthToken() {
        try {
            const response = await fetch('/api/token');
            const data = await response.json();
            this.jwtToken = data.token;
        } catch (error) {
            console.error('Failed to get auth token:', error);
            this.showError('Authentication failed');
        }
    }

    async connectWebSockets() {
        await this.connectPtyWebSocket();
        await this.connectAudioWebSocket();
    }

    async connectPtyWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/pty?token=${this.jwtToken}`;
        
        this.ptyWebSocket = new WebSocket(wsUrl);
        
        this.ptyWebSocket.onopen = () => {
            console.log('PTY WebSocket connected');
            this.updateConnectionStatus(true);
            this.terminal.clear();
            this.terminal.writeln('Welcome to Voice Plandex!');
            this.terminal.writeln('Terminal connected. You can type commands or use voice input.');
            this.terminal.writeln('');
        };

        this.ptyWebSocket.onmessage = (event) => {
            const data = event.data;
            this.terminal.write(data);
            
            // Text-to-speech for terminal output (filtered)
            if (this.settings.ttsEnabled && data.trim().length > 0) {
                this.speakText(data, true);
            }
        };

        this.ptyWebSocket.onclose = () => {
            console.log('PTY WebSocket disconnected');
            this.updateConnectionStatus(false);
            this.showError('Terminal connection lost. Attempting to reconnect...');
            setTimeout(() => this.connectPtyWebSocket(), 3000);
        };

        this.ptyWebSocket.onerror = (error) => {
            console.error('PTY WebSocket error:', error);
            this.showError('Terminal connection error');
        };
    }

    async connectAudioWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/audio?token=${this.jwtToken}`;
        
        this.audioWebSocket = new WebSocket(wsUrl);
        
        this.audioWebSocket.onopen = () => {
            console.log('Audio WebSocket connected');
            this.updateMicButton(true);
            document.getElementById('caption').textContent = 'Ready for voice input';
            document.getElementById('caption').className = 'caption';
        };

        this.audioWebSocket.onmessage = (event) => {
            try {
                const response = JSON.parse(event.data);
                this.handleTranscription(response);
            } catch (error) {
                console.error('Failed to parse audio response:', error);
            }
        };

        this.audioWebSocket.onclose = () => {
            console.log('Audio WebSocket disconnected');
            this.updateMicButton(false);
            setTimeout(() => this.connectAudioWebSocket(), 3000);
        };

        this.audioWebSocket.onerror = (error) => {
            console.error('Audio WebSocket error:', error);
            this.showError('Audio connection error');
        };
    }

    setupEventListeners() {
        // Microphone button
        const micButton = document.getElementById('mic-button');
        micButton.addEventListener('mousedown', () => this.startRecording());
        micButton.addEventListener('mouseup', () => this.stopRecording());
        micButton.addEventListener('mouseleave', () => this.stopRecording());
        
        // Touch events for mobile
        micButton.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.startRecording();
        });
        micButton.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.stopRecording();
        });

        // Settings panel
        document.getElementById('settings-button').addEventListener('click', () => {
            document.getElementById('settings-panel').classList.remove('hidden');
        });

        document.getElementById('close-settings').addEventListener('click', () => {
            document.getElementById('settings-panel').classList.add('hidden');
        });

        // Settings controls
        document.getElementById('tts-enabled').addEventListener('change', (e) => {
            this.settings.ttsEnabled = e.target.checked;
            this.saveSettings();
        });

        document.getElementById('tts-rate').addEventListener('input', (e) => {
            this.settings.ttsRate = parseFloat(e.target.value);
            document.getElementById('tts-rate-value').textContent = this.settings.ttsRate.toFixed(1);
            this.saveSettings();
        });

        document.getElementById('auto-apply').addEventListener('change', (e) => {
            this.settings.autoApply = e.target.checked;
            this.saveSettings();
        });

        // Error panel
        document.getElementById('close-error').addEventListener('click', () => {
            document.getElementById('error-panel').classList.add('hidden');
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === ' ') {
                e.preventDefault();
                if (this.isRecording) {
                    this.stopRecording();
                } else {
                    this.startRecording();
                }
            }
        });
    }

    async startRecording() {
        if (this.isRecording || !this.audioWebSocket || this.audioWebSocket.readyState !== WebSocket.OPEN) {
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                } 
            });

            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000
            });

            const source = this.audioContext.createMediaStreamSource(stream);
            const processor = this.audioContext.createScriptProcessor(4096, 1, 1);

            processor.onaudioprocess = (event) => {
                if (this.isRecording && this.audioWebSocket.readyState === WebSocket.OPEN) {
                    const inputData = event.inputBuffer.getChannelData(0);
                    const pcmData = this.float32ToPCM16(inputData);
                    this.audioWebSocket.send(pcmData);
                }
            };

            source.connect(processor);
            processor.connect(this.audioContext.destination);

            this.isRecording = true;
            this.updateMicButtonState();
            
            document.getElementById('caption').textContent = 'Listening...';
            document.getElementById('caption').className = 'caption partial';

        } catch (error) {
            console.error('Failed to start recording:', error);
            this.showError('Microphone access denied or not available');
        }
    }

    stopRecording() {
        if (!this.isRecording) return;

        this.isRecording = false;
        this.updateMicButtonState();

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        document.getElementById('caption').textContent = 'Processing...';
        document.getElementById('caption').className = 'caption partial';
    }

    float32ToPCM16(input) {
        const output = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
            let sample = Math.max(-1, Math.min(1, input[i]));
            output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }
        return output.buffer;
    }

    handleTranscription(response) {
        const caption = document.getElementById('caption');
        
        if (response.is_final) {
            caption.textContent = response.text || 'No speech detected';
            caption.className = 'caption final';
            
            if (response.text && this.settings.ttsEnabled) {
                this.speakText(`Command: ${response.text}`);
            }
            
            // Clear caption after a delay
            setTimeout(() => {
                caption.textContent = 'Ready for voice input';
                caption.className = 'caption';
            }, 3000);
        } else {
            caption.textContent = response.text || 'Listening...';
            caption.className = 'caption partial';
        }
    }

    speakText(text, filter = false) {
        if (!this.settings.ttsEnabled || !window.speechSynthesis) return;

        // Filter out terminal control sequences and noise
        if (filter) {
            // Skip very short outputs, control sequences, prompts
            if (text.length < 5 || text.includes('\x1b') || text.match(/^\s*[\$#>]\s*$/)) {
                return;
            }
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = this.settings.ttsRate;
        utterance.volume = 0.7;
        
        // Use a more natural voice if available
        const voices = speechSynthesis.getVoices();
        const preferredVoice = voices.find(voice => 
            voice.lang.startsWith('en') && !voice.name.includes('Google')
        );
        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }

        speechSynthesis.speak(utterance);
    }

    updateConnectionStatus(connected) {
        this.isConnected = connected;
        const status = document.getElementById('connection-status');
        if (connected) {
            status.textContent = 'Connected';
            status.className = 'status-indicator online';
        } else {
            status.textContent = 'Disconnected';
            status.className = 'status-indicator offline';
        }
    }

    updateMicButton(enabled) {
        const micButton = document.getElementById('mic-button');
        micButton.disabled = !enabled;
        if (!enabled) {
            micButton.innerHTML = '<span class="mic-icon">🎤</span><span class="mic-text">Connecting...</span>';
        } else {
            micButton.innerHTML = '<span class="mic-icon">🎤</span><span class="mic-text">Hold to Speak</span>';
        }
    }

    updateMicButtonState() {
        const micButton = document.getElementById('mic-button');
        if (this.isRecording) {
            micButton.className = 'mic-button recording';
            micButton.innerHTML = '<span class="mic-icon">⏹️</span><span class="mic-text">Recording...</span>';
        } else {
            micButton.className = 'mic-button';
            micButton.innerHTML = '<span class="mic-icon">🎤</span><span class="mic-text">Hold to Speak</span>';
        }
    }

    showError(message) {
        const errorPanel = document.getElementById('error-panel');
        const errorMessage = document.getElementById('error-message');
        
        errorMessage.textContent = message;
        errorPanel.classList.remove('hidden');
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            errorPanel.classList.add('hidden');
        }, 5000);
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new VoicePlandex();
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Stop speech synthesis when tab is hidden
        if (window.speechSynthesis) {
            speechSynthesis.cancel();
        }
    }
});
