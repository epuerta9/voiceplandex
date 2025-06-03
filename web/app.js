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
        this.isFirstTime = true;
        this.settings = {
            ttsEnabled: true,
            ttsRate: 1.0,
            autoApply: true,
            micSensitivity: 0.5
        };
        this.jwtToken = null;
        this.recordingTimeout = null;
        
        this.init();
    }

    async init() {
        try {
            this.showLoading(true);
            await this.initializeUI();
            await this.setupTerminal();
            await this.loadSettings();
            await this.checkHealth();
            await this.getAuthToken();
            await this.connectWebSockets();
            this.setupEventListeners();
            this.showQuickStart();
        } catch (error) {
            console.error('Initialization error:', error);
            this.showError('Failed to initialize Voice Plandex. Please refresh the page.');
        } finally {
            this.showLoading(false);
        }
    }

    async initializeUI() {
        this.updateConnectionStatus(false);
        this.updateMicButton(false);
        this.updateTerminalStatus('Initializing...');
    }

    showLoading(show) {
        const overlay = document.getElementById('loading-overlay');
        if (show) {
            overlay.classList.remove('hidden');
        } else {
            overlay.classList.add('hidden');
        }
    }

    showQuickStart() {
        if (this.isFirstTime && !localStorage.getItem('voicePlandexQuickStartDismissed')) {
            const quickStart = document.getElementById('quick-start');
            quickStart.classList.remove('hidden');
        }
    }

    dismissQuickStart() {
        const quickStart = document.getElementById('quick-start');
        quickStart.classList.add('hidden');
        localStorage.setItem('voicePlandexQuickStartDismissed', 'true');
        this.isFirstTime = false;
    }

    async setupTerminal() {
        this.terminal = new Terminal({
            cursorBlink: true,
            theme: {
                background: 'transparent',
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
            fontFamily: 'JetBrains Mono, SF Mono, Consolas, Liberation Mono, Menlo, monospace',
            rows: 24,
            cols: 80,
            allowProposedApi: true
        });

        this.fitAddon = new FitAddon.FitAddon();
        this.terminal.loadAddon(this.fitAddon);
        
        const terminalElement = document.getElementById('terminal');
        this.terminal.open(terminalElement);
        this.fitAddon.fit();

        // Ensure terminal gets focus and can receive input
        this.terminal.focus();
        
        // Make terminal container focusable
        terminalElement.setAttribute('tabindex', '0');
        terminalElement.addEventListener('click', () => {
            this.terminal.focus();
        });

        this.terminal.onData((data) => {
            if (this.ptyWebSocket && this.ptyWebSocket.readyState === WebSocket.OPEN) {
                this.ptyWebSocket.send(data);
            }
        });

        window.addEventListener('resize', () => {
            setTimeout(() => this.fitAddon.fit(), 100);
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
        document.getElementById('tts-rate-value').textContent = this.settings.ttsRate.toFixed(1) + 'x';
        document.getElementById('auto-apply').checked = this.settings.autoApply;
        document.getElementById('mic-sensitivity').value = this.settings.micSensitivity;
        document.getElementById('mic-sensitivity-value').textContent = this.settings.micSensitivity.toFixed(1);
    }

    saveSettings() {
        try {
            localStorage.setItem('voicePlandexSettings', JSON.stringify(this.settings));
        } catch (error) {
            console.warn('Failed to save settings:', error);
        }
    }

    resetSettings() {
        this.settings = {
            ttsEnabled: true,
            ttsRate: 1.0,
            autoApply: true,
            micSensitivity: 0.5
        };
        this.applySettings();
        this.saveSettings();
        this.showSuccess('Settings reset to defaults');
    }

    async checkHealth() {
        try {
            const response = await fetch('/api/health');
            const health = await response.json();
            
            const openaiStatus = document.getElementById('openai-status');
            const statusText = openaiStatus.querySelector('.status-text');
            
            if (health.openai_configured) {
                statusText.textContent = 'AI Ready';
                openaiStatus.className = 'status-indicator online';
            } else {
                statusText.textContent = 'AI Not Configured';
                openaiStatus.className = 'status-indicator offline';
                this.showError('OpenAI API key not configured. Voice features will not work.');
            }

            if (!health.plandex_available) {
                this.showError('Plandex CLI not found. Please install Plandex CLI first.');
            } else if (!health.plandex_server_running) {
                this.showError('Plandex server not running. Please run: plandex server start');
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
            throw error;
        }
    }

    async connectWebSockets() {
        await Promise.all([
            this.connectPtyWebSocket(),
            this.connectAudioWebSocket()
        ]);
    }

    async connectPtyWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/pty?token=${this.jwtToken}`;
        
        this.ptyWebSocket = new WebSocket(wsUrl);
        
        this.ptyWebSocket.onopen = () => {
            console.log('PTY WebSocket connected');
            this.updateConnectionStatus(true);
            this.updateTerminalStatus('Connected');
            this.terminal.clear();
            this.terminal.writeln('\r\n🎤 \x1b[1;35mVoice Plandex\x1b[0m - Hands-free AI coding assistant');
            this.terminal.writeln('\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
            this.terminal.writeln('Terminal connected. You can type commands or use voice input.');
            this.terminal.writeln('Press the microphone button or \x1b[1mCtrl+Space\x1b[0m to start voice recording.');
            this.terminal.writeln('');
        };

        this.ptyWebSocket.onmessage = (event) => {
            const data = event.data;
            this.terminal.write(data);
            
            if (this.settings.ttsEnabled && data.trim().length > 0) {
                this.speakText(data, true);
            }
        };

        this.ptyWebSocket.onclose = () => {
            console.log('PTY WebSocket disconnected');
            this.updateConnectionStatus(false);
            this.updateTerminalStatus('Disconnected');
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
        micButton.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.startRecording();
        });
        micButton.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.stopRecording();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.code === 'Space') {
                e.preventDefault();
                if (this.isRecording) {
                    this.stopRecording();
                } else {
                    this.startRecording();
                }
            }
            if (e.key === '?' && !e.ctrlKey && !e.altKey) {
                const activeElement = document.activeElement;
                if (activeElement.tagName !== 'INPUT' && activeElement.tagName !== 'TEXTAREA') {
                    this.showHelp();
                }
            }
            if (e.key === 'F11') {
                e.preventDefault();
                this.toggleFullscreen();
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.ctrlKey && e.code === 'Space') {
                e.preventDefault();
            }
        });

        // Quick start dismissal
        document.getElementById('dismiss-quick-start').addEventListener('click', () => {
            this.dismissQuickStart();
        });

        // Settings
        document.getElementById('settings-button').addEventListener('click', () => {
            this.showSettings();
        });
        document.getElementById('close-settings').addEventListener('click', () => {
            this.hideSettings();
        });
        document.getElementById('reset-settings').addEventListener('click', () => {
            this.resetSettings();
        });

        // Settings controls
        document.getElementById('tts-enabled').addEventListener('change', (e) => {
            this.settings.ttsEnabled = e.target.checked;
            this.saveSettings();
        });

        document.getElementById('tts-rate').addEventListener('input', (e) => {
            this.settings.ttsRate = parseFloat(e.target.value);
            document.getElementById('tts-rate-value').textContent = this.settings.ttsRate.toFixed(1) + 'x';
            this.saveSettings();
        });

        document.getElementById('auto-apply').addEventListener('change', (e) => {
            this.settings.autoApply = e.target.checked;
            this.saveSettings();
        });

        document.getElementById('mic-sensitivity').addEventListener('input', (e) => {
            this.settings.micSensitivity = parseFloat(e.target.value);
            document.getElementById('mic-sensitivity-value').textContent = this.settings.micSensitivity.toFixed(1);
            this.saveSettings();
        });

        // Help
        document.getElementById('help-button').addEventListener('click', () => {
            this.showHelp();
        });
        document.getElementById('close-help').addEventListener('click', () => {
            this.hideHelp();
        });

        // Terminal controls
        document.getElementById('clear-terminal').addEventListener('click', () => {
            this.terminal.clear();
        });
        document.getElementById('fullscreen-terminal').addEventListener('click', () => {
            this.toggleFullscreen();
        });

        // Command chips
        document.querySelectorAll('.command-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const command = chip.dataset.command;
                this.executeVoiceCommand(command);
                this.showCaption(`Executed: "${command}"`, 'final');
            });
        });

        // Toggle command visibility
        document.getElementById('toggle-commands').addEventListener('click', (e) => {
            const chips = document.getElementById('command-chips');
            const button = e.target;
            if (chips.classList.contains('hidden')) {
                chips.classList.remove('hidden');
                button.textContent = 'Hide';
            } else {
                chips.classList.add('hidden');
                button.textContent = 'Show';
            }
        });

        // Notification dismissals
        document.getElementById('close-error').addEventListener('click', () => {
            this.hideError();
        });
        document.getElementById('close-success').addEventListener('click', () => {
            this.hideSuccess();
        });

        // Click outside to close panels
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('settings-backdrop')) {
                this.hideSettings();
            }
            if (e.target.classList.contains('help-backdrop')) {
                this.hideHelp();
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
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });

            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            const source = this.audioContext.createMediaStreamSource(stream);
            const processor = this.audioContext.createScriptProcessor(4096, 1, 1);

            // Accumulate audio data instead of sending fragments
            this.audioBuffer = [];
            this.audioDataCount = 0;
            this.silenceCount = 0;
            this.speechDetected = false;

            processor.onaudioprocess = (event) => {
                if (this.isRecording) {
                    const inputData = event.inputBuffer.getChannelData(0);
                    
                    // Simple voice activity detection
                    let sum = 0;
                    for (let i = 0; i < inputData.length; i++) {
                        sum += inputData[i] * inputData[i];
                    }
                    const rms = Math.sqrt(sum / inputData.length);
                    const volume = Math.max(0, Math.min(1, rms * 10));

                    // Detect speech vs silence
                    if (volume > this.settings.micSensitivity) {
                        this.speechDetected = true;
                        this.silenceCount = 0;
                        
                        const pcmData = this.float32ToPCM16(inputData);
                        this.audioBuffer.push(new Uint8Array(pcmData));
                        this.audioDataCount += pcmData.byteLength;
                    } else if (this.speechDetected) {
                        this.silenceCount++;
                        
                        // If we have speech and then 0.5 seconds of silence, stop
                        if (this.silenceCount > 24) { // ~0.5 seconds at 48kHz
                            this.stopRecording();
                            return;
                        }
                        
                        // Still accumulate some silence after speech
                        const pcmData = this.float32ToPCM16(inputData);
                        this.audioBuffer.push(new Uint8Array(pcmData));
                        this.audioDataCount += pcmData.byteLength;
                    }
                }
            };

            source.connect(processor);
            processor.connect(this.audioContext.destination);

            this.mediaProcessor = processor;
            this.mediaStream = stream;
            this.isRecording = true;
            this.updateMicButtonState();
            this.showCaption('Listening...', 'partial');

            // Auto-stop after 10 seconds and send accumulated audio
            this.recordingTimeout = setTimeout(() => {
                this.stopRecording();
            }, 10000);

        } catch (error) {
            console.error('Failed to start recording:', error);
            this.showError('Microphone access denied. Please enable microphone permissions.');
        }
    }

    stopRecording() {
        if (!this.isRecording) return;

        this.isRecording = false;
        
        if (this.recordingTimeout) {
            clearTimeout(this.recordingTimeout);
            this.recordingTimeout = null;
        }

        // Send accumulated audio data
        if (this.audioBuffer && this.audioBuffer.length > 0 && this.audioDataCount > 8192) { // Minimum 8KB
            const combinedBuffer = new Uint8Array(this.audioDataCount);
            let offset = 0;
            
            for (const chunk of this.audioBuffer) {
                combinedBuffer.set(chunk, offset);
                offset += chunk.length;
            }

            if (this.audioWebSocket && this.audioWebSocket.readyState === WebSocket.OPEN) {
                this.audioWebSocket.send(combinedBuffer);
            }
        }

        // Cleanup
        this.audioBuffer = [];
        this.audioDataCount = 0;

        if (this.mediaProcessor) {
            this.mediaProcessor.disconnect();
            this.mediaProcessor = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.updateMicButtonState();
        this.showCaption('Processing...', 'partial');
    }

    float32ToPCM16(input) {
        const output = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
            const sample = Math.max(-1, Math.min(1, input[i]));
            output[i] = sample * 0x7FFF;
        }
        return output.buffer;
    }

    handleTranscription(response) {
        if (response.type === 'error') {
            this.showError('Speech recognition failed. Please try again.');
            this.showCaption('', '');
            return;
        }

        if (response.type === 'partial') {
            this.showCaption(response.text || 'Listening...', 'partial');
        } else if (response.type === 'final' && response.text) {
            const text = response.text.trim();
            
            // Filter out very short or meaningless transcriptions
            if (text.length < 3 || /^(you|uh|um|ah|the|a|and|or|but)$/i.test(text)) {
                this.showCaption('Speech too short, please try again', 'error');
                setTimeout(() => {
                    this.showCaption('', '');
                }, 2000);
                return;
            }

            this.showCaption(`"${text}"`, 'final');
            
            if (this.settings.autoApply) {
                this.executeVoiceCommand(text);
            } else {
                // Show execute button if auto-apply is disabled
                this.showCaption(`"${text}" - Click to execute`, 'final');
            }
        }
    }

    executeVoiceCommand(text) {
        console.log('Executing voice command:', text);
        
        const lowerText = text.toLowerCase().trim();
        
        // Check for special voice keywords first
        const voiceCommands = {
            'stop': '\x03',
            'background': 'b',
            'apply changes': ':apply\n',
            'apply': ':apply\n',
            'quit': ':quit\n',
            'help': ':help\n',
            'clear': 'clear\n'
        };

        if (voiceCommands[lowerText]) {
            this.sendToPlandex(voiceCommands[lowerText]);
            this.showSuccess(`Executed command: "${lowerText}"`);
            return;
        }

        // For longer commands, use "tell" command
        if (text.length > 5) {
            const command = `tell "${text}"\n`;
            this.sendToPlandex(command);
            this.showSuccess(`Sent to Plandex: "${text}"`);
        } else {
            this.showError('Command too short. Please speak a complete instruction.');
        }
    }

    sendToPlandex(command) {
        if (this.ptyWebSocket && this.ptyWebSocket.readyState === WebSocket.OPEN) {
            this.ptyWebSocket.send(command);
        }
    }

    speakText(text, filter = false) {
        if (!this.settings.ttsEnabled || !window.speechSynthesis) return;

        // Filter out ANSI escape sequences and control characters
        if (filter) {
            text = text.replace(/\x1b\[[0-9;]*m/g, ''); // Remove ANSI colors
            text = text.replace(/[\x00-\x1F\x7F]/g, ''); // Remove control chars
            text = text.trim();
            
            // Skip very short or repetitive text
            if (text.length < 5 || /^[^\w\s]*$/.test(text)) return;
        }

        // Cancel previous speech
        speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = this.settings.ttsRate;
        utterance.volume = 0.8;
        utterance.pitch = 1.0;

        speechSynthesis.speak(utterance);
    }

    showCaption(text, type = '') {
        const caption = document.getElementById('caption');
        caption.textContent = text;
        caption.className = `caption ${type}`;
        
        if (type === 'final') {
            setTimeout(() => {
                caption.textContent = '';
                caption.className = 'caption';
            }, 3000);
        }
    }

    updateConnectionStatus(connected) {
        const status = document.getElementById('connection-status');
        const statusText = status.querySelector('.status-text');
        
        this.isConnected = connected;
        if (connected) {
            statusText.textContent = 'Connected';
            status.className = 'status-indicator online';
        } else {
            statusText.textContent = 'Disconnected';
            status.className = 'status-indicator offline';
        }
    }

    updateTerminalStatus(status) {
        const terminalStatus = document.getElementById('terminal-status');
        terminalStatus.textContent = status;
    }

    updateMicButton(enabled) {
        const micButton = document.getElementById('mic-button');
        micButton.disabled = !enabled;
    }

    updateMicButtonState() {
        const micButton = document.getElementById('mic-button');
        const recordingIndicator = document.getElementById('recording-indicator');
        
        if (this.isRecording) {
            micButton.classList.add('recording');
            recordingIndicator.classList.add('active');
        } else {
            micButton.classList.remove('recording');
            recordingIndicator.classList.remove('active');
        }
    }

    showSettings() {
        document.getElementById('settings-panel').classList.remove('hidden');
    }

    hideSettings() {
        document.getElementById('settings-panel').classList.add('hidden');
    }

    showHelp() {
        document.getElementById('help-panel').classList.remove('hidden');
    }

    hideHelp() {
        document.getElementById('help-panel').classList.add('hidden');
    }

    showError(message) {
        const panel = document.getElementById('error-panel');
        const messageEl = document.getElementById('error-message');
        messageEl.textContent = message;
        panel.classList.remove('hidden');
        
        // Auto-hide after 5 seconds
        setTimeout(() => this.hideError(), 5000);
    }

    hideError() {
        document.getElementById('error-panel').classList.add('hidden');
    }

    showSuccess(message) {
        const panel = document.getElementById('success-panel');
        const messageEl = document.getElementById('success-message');
        messageEl.textContent = message;
        panel.classList.remove('hidden');
        
        // Auto-hide after 3 seconds
        setTimeout(() => this.hideSuccess(), 3000);
    }

    hideSuccess() {
        document.getElementById('success-panel').classList.add('hidden');
    }

    toggleFullscreen() {
        const terminalContainer = document.getElementById('terminal-container');
        terminalContainer.classList.toggle('fullscreen');
        
        // Resize terminal after fullscreen toggle
        setTimeout(() => this.fitAddon.fit(), 100);
    }
}

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.voicePlandex = new VoicePlandex();
});

// Note: Service worker registration removed since we don't have sw.js file
