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
            autoApply: true,
            micSensitivity: 0.5
        };
        this.jwtToken = null;
        this.recordingTimeout = null;
        
        // Ensure no TTS is happening globally
        if (typeof speechSynthesis !== 'undefined') {
            speechSynthesis.cancel();
        }
        
        this.init();
    }

    async init() {
        try {
            this.showLoading(true);
            
            // Disable any TTS immediately and continuously
            this.disableTTS();
            
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
            allowProposedApi: true,
            convertEol: true,
            scrollback: 1000,
            fastScrollModifier: 'alt',
            rightClickSelectsWord: true,
            disableStdin: false,
            screenReaderMode: false,
            windowsMode: false
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
            console.log('=== TERMINAL ONDATA TRIGGERED ===');
            console.log('Terminal data received:', JSON.stringify(data));
            console.log('Data bytes:', Array.from(new TextEncoder().encode(data)));
            console.log('PTY WebSocket exists:', !!this.ptyWebSocket);
            console.log('PTY WebSocket readyState:', this.ptyWebSocket?.readyState);
            
            if (this.ptyWebSocket && this.ptyWebSocket.readyState === WebSocket.OPEN) {
                // Filter out terminal capability queries and responses that confuse Plandex
                if (this.shouldFilterTerminalData(data)) {
                    console.log('Filtered out terminal capability data:', data);
                    return;
                }
                
                console.log('Sending terminal input to PTY WebSocket:', JSON.stringify(data));
                try {
                    this.ptyWebSocket.send(data);
                    console.log('✅ Successfully sent data to PTY WebSocket');
                } catch (error) {
                    console.error('❌ Error sending data to PTY WebSocket:', error);
                }
            } else {
                console.error('❌ PTY WebSocket not available');
                console.error('WebSocket state:', this.ptyWebSocket?.readyState);
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
        
        console.log('=== PTY WEBSOCKET CONNECTION ===');
        console.log('Attempting PTY WebSocket connection to:', wsUrl);
        console.log('JWT Token:', this.jwtToken ? 'Present' : 'Missing');
        
        this.ptyWebSocket = new WebSocket(wsUrl);
        
        this.ptyWebSocket.onopen = () => {
            console.log('✅ PTY WebSocket connected successfully');
            this.updateConnectionStatus(true);
            this.updateTerminalStatus('Connected');
        };

        this.ptyWebSocket.onmessage = (event) => {
            const data = event.data;
            console.log('PTY WebSocket received data:', data);
            this.terminal.write(data);
            
            // REMOVED: TTS audio feedback - voice should be input only
            // if (this.settings.ttsEnabled && data.trim().length > 0) {
            //     this.speakText(data, true);
            // }
        };

        this.ptyWebSocket.onclose = (event) => {
            console.log('❌ PTY WebSocket disconnected. Code:', event.code, 'Reason:', event.reason);
            this.updateConnectionStatus(false);
            this.updateTerminalStatus('Disconnected');
            this.showError('Terminal connection lost. Attempting to reconnect...');
            setTimeout(() => this.connectPtyWebSocket(), 3000);
        };

        this.ptyWebSocket.onerror = (error) => {
            console.error('❌ PTY WebSocket error:', error);
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

        // Settings controls - REMOVED TTS event listeners
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
        console.log('=== VOICE COMMAND EXECUTION ===');
        console.log('Executing voice command:', text);
        console.log('PTY WebSocket exists:', !!this.ptyWebSocket);
        console.log('PTY WebSocket readyState:', this.ptyWebSocket?.readyState);
        console.log('WebSocket states: CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3');
        
        const lowerText = text.toLowerCase().trim();
        
        // Check for special voice keywords first
        const voiceCommands = {
            'stop': '\x03',
            'cancel': '\x03',
            'background': 'b',
            'apply changes': ':apply\n',
            'apply': ':apply\n',
            'quit': ':quit\n',
            'exit': ':quit\n',
            'help': ':help\n',
            'clear': 'clear\n',
            'tell mode': 'tt\n',
            'multi line': 'mm\n',
            'chat': 'chat\n'
        };

        if (voiceCommands[lowerText]) {
            // Send special command directly through PTY WebSocket
            if (this.ptyWebSocket && this.ptyWebSocket.readyState === WebSocket.OPEN) {
                console.log('Sending special command to PTY:', voiceCommands[lowerText]);
                console.log('Command bytes:', Array.from(new TextEncoder().encode(voiceCommands[lowerText])));
                this.ptyWebSocket.send(voiceCommands[lowerText]);
                this.showSuccess(`Executed: "${lowerText}"`);
            } else {
                console.error('PTY WebSocket not connected. State:', this.ptyWebSocket?.readyState);
                this.showError('Terminal not connected');
            }
            return;
        }

        // For longer commands, determine the best approach and send through PTY
        if (text && text.length > 2) {
            const isQuestion = lowerText.includes('what') || lowerText.includes('how') || 
                              lowerText.includes('why') || lowerText.includes('where') ||
                              lowerText.includes('explain') || lowerText.includes('show me') ||
                              lowerText.includes('tell me') || lowerText.includes('describe') ||
                              lowerText.includes('can you') || lowerText.startsWith('who') ||
                              text.endsWith('?');
            
            const isDirectCommand = lowerText.startsWith('create') ||
                                   lowerText.startsWith('add') ||
                                   lowerText.startsWith('fix') ||
                                   lowerText.startsWith('refactor') ||
                                   lowerText.startsWith('update') ||
                                   lowerText.startsWith('delete') ||
                                   lowerText.startsWith('remove') ||
                                   lowerText.startsWith('implement') ||
                                   lowerText.startsWith('write');

            if (this.ptyWebSocket && this.ptyWebSocket.readyState === WebSocket.OPEN) {
                console.log('Determined command type for:', text);
                console.log('- lowerText:', lowerText);
                console.log('- isQuestion:', isQuestion);
                console.log('- isDirectCommand:', isDirectCommand);
                
                if (isQuestion) {
                    // For questions, send chat command and question together
                    console.log('=== SENDING COMBINED CHAT COMMAND ===');
                    const combinedCommand = `chat\n${text}\n`;
                    console.log('Sending combined command:', JSON.stringify(combinedCommand));
                    console.log('Combined command bytes:', Array.from(new TextEncoder().encode(combinedCommand)));
                    
                    try {
                        this.ptyWebSocket.send(combinedCommand);
                        console.log('✅ Combined chat command sent successfully');
                        this.showSuccess(`💬 Question sent: "${text}"`);
                    } catch (error) {
                        console.error('❌ Error sending combined chat command:', error);
                        this.showError('Failed to send question to terminal');
                    }
                } else if (isDirectCommand) {
                    // For direct commands, send tell command and text together
                    console.log('=== SENDING COMBINED TELL COMMAND ===');
                    const combinedCommand = `tt\n${text}\n`;
                    console.log('Sending combined command:', JSON.stringify(combinedCommand));
                    console.log('Combined command bytes:', Array.from(new TextEncoder().encode(combinedCommand)));
                    
                    try {
                        this.ptyWebSocket.send(combinedCommand);
                        console.log('✅ Combined tell command sent successfully');
                        this.showSuccess(`🔨 Command sent: "${text}"`);
                    } catch (error) {
                        console.error('❌ Error sending combined tell command:', error);
                        this.showError('Failed to send command to terminal');
                    }
                } else {
                    // Default to tell mode - send tell command and text together
                    console.log('=== SENDING COMBINED DEFAULT COMMAND ===');
                    const combinedCommand = `tt\n${text}\n`;
                    console.log('Sending combined command:', JSON.stringify(combinedCommand));
                    console.log('Combined command bytes:', Array.from(new TextEncoder().encode(combinedCommand)));
                    
                    try {
                        this.ptyWebSocket.send(combinedCommand);
                        console.log('✅ Combined default command sent successfully');
                        this.showSuccess(`📝 Text sent: "${text}"`);
                    } catch (error) {
                        console.error('❌ Error sending combined default command:', error);
                        this.showError('Failed to send text to terminal');
                    }
                }
                
                // Add a test to verify connection works
                console.log('=== TESTING PTY CONNECTION ===');
                this.testPtyConnection();
            } else {
                console.error('PTY WebSocket state:', this.ptyWebSocket?.readyState);
                console.error('WebSocket ready states: CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3');
                this.showError('Terminal not connected. Cannot send command.');
            }
        } else {
            this.showError('Command too short. Please speak a longer instruction.');
        }
        
        console.log('=== END VOICE COMMAND EXECUTION ===');
    }

    // Add a test function to verify PTY connection
    testPtyConnection() {
        if (this.ptyWebSocket && this.ptyWebSocket.readyState === WebSocket.OPEN) {
            console.log('Testing PTY connection with newline...');
            this.ptyWebSocket.send('\n');
            
            // Also run manual test
            console.log('Running manual PTY test...');
            this.testPtyManually();
        }
    }

    testPtyManually() {
        console.log('=== MANUAL PTY TEST ===');
        console.log('PTY WebSocket exists:', !!this.ptyWebSocket);
        console.log('PTY WebSocket readyState:', this.ptyWebSocket?.readyState);
        console.log('WebSocket states: CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3');
        
        if (this.ptyWebSocket && this.ptyWebSocket.readyState === WebSocket.OPEN) {
            console.log('=== SENDING MANUAL TEST COMMAND ===');
            const testCommand = 'chat\nHello manual test\n';
            console.log('Sending manual test:', JSON.stringify(testCommand));
            
            try {
                this.ptyWebSocket.send(testCommand);
                console.log('✅ Manual test command sent successfully');
                this.showSuccess('Manual test sent');
            } catch (error) {
                console.error('❌ Manual test failed:', error);
                this.showError('Manual test failed: ' + error.message);
            }
        } else {
            console.error('❌ PTY WebSocket not connected for manual test!');
            console.error('Current state:', this.ptyWebSocket?.readyState);
            this.showError('PTY WebSocket not connected - state: ' + (this.ptyWebSocket?.readyState || 'null'));
        }
    }

    speakText(text, filter = false) {
        // DISABLED: Voice output removed - this is now voice input only
        // Text-to-speech functionality disabled to prevent audio feedback
        return;
        
        // if (!this.settings.ttsEnabled || !window.speechSynthesis) return;

        // // Filter out ANSI escape sequences and control characters
        // if (filter) {
        //     text = text.replace(/\x1b\[[0-9;]*m/g, ''); // Remove ANSI colors
        //     text = text.replace(/[\x00-\x1F\x7F]/g, ''); // Remove control chars
        //     text = text.trim();
            
        //     // Skip very short or repetitive text
        //     if (text.length < 5 || /^[^\w\s]*$/.test(text)) return;
        // }

        // // Cancel previous speech
        // speechSynthesis.cancel();

        // const utterance = new SpeechSynthesisUtterance(text);
        // utterance.rate = this.settings.ttsRate;
        // utterance.volume = 0.8;
        // utterance.pitch = 1.0;

        // speechSynthesis.speak(utterance);
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

    // Add method to filter out terminal capability queries
    shouldFilterTerminalData(data) {
        // TEMPORARILY DISABLED - Allow all data through to debug
        return false;
        
        // // Filter out common terminal capability queries and responses
        // const patterns = [
        //     /^\x1b\]11;.*\x1b\\$/,           // Background color query response
        //     /^\x1b\[8;\d+R$/,                // Cursor position report
        //     /^\x1b\].*\x1b\\$/,              // Other OSC sequences
        //     /^\x1b\[6n$/,                    // Device status report query
        //     /^\x1b\[\?.*[hl]$/,              // DEC private mode set/reset
        //     /^\x1b\[.*[ABCDEFGJKST]$/,       // Some cursor movement/control sequences
        //     /\?\]11;rgb:\d+\/\d+\/\d+\?\\/, // Background color queries (escaped)
        //     /\?\[8;\d+R/,                    // Cursor position reports (escaped)
        //     /\x1b\[3D/,                      // Cursor movement sequences
        //     /\x1b\[J/,                       // Clear sequences
        // ];
        
        // // Also filter if the data contains multiple escape sequences mixed together
        // const escapeCount = (data.match(/\x1b/g) || []).length;
        // if (escapeCount > 3) {
        //     console.log('Filtering data with too many escape sequences:', escapeCount);
        //     return true;
        // }
        
        // return patterns.some(pattern => pattern.test(data));
    }

    // Method to completely disable TTS
    disableTTS() {
        if (typeof speechSynthesis !== 'undefined') {
            speechSynthesis.cancel();
            
            // Override speechSynthesis.speak to prevent any TTS
            const originalSpeak = speechSynthesis.speak.bind(speechSynthesis);
            speechSynthesis.speak = function(utterance) {
                console.log('TTS blocked - Voice Plandex is voice input only');
                return;
            };
            
            // Set up interval to continuously cancel any TTS attempts
            setInterval(() => {
                if (speechSynthesis.speaking) {
                    speechSynthesis.cancel();
                }
            }, 100);
        }
    }
}

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.voicePlandex = new VoicePlandex();
});

// Note: Service worker registration removed since we don't have sw.js file
