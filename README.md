# Voice Plandex

A voice-controlled web interface for Plandex CLI that enables hands-free coding through speech-to-text and real-time terminal interaction. Turn your voice into code with an intuitive, modern interface.

## ✨ Features

### 🎤 **Voice Control**
- **OpenAI Whisper Integration**: High-accuracy speech-to-text using OpenAI's Whisper API
- **Hold-to-Record**: Simple microphone button or `Ctrl+Space` shortcut
- **Quick Commands**: Voice shortcuts for common actions ("stop", "apply changes", "help")
- **Auto-timeout**: Automatically stops recording after 10 seconds

### 🖥️ **Modern Terminal Interface** 
- **Real-time Terminal**: Live terminal interface with xterm.js showing Plandex TUI
- **Fullscreen Mode**: Distraction-free coding with `F11` or terminal controls
- **Terminal Controls**: Clear terminal, copy output, and fullscreen toggle
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile

### 🔊 **Text-to-Speech**
- **Hear Responses**: Plandex responses read aloud with adjustable speed
- **Smart Filtering**: Filters out ANSI codes and repetitive terminal output
- **Customizable**: Adjust speech rate and enable/disable TTS

### 🎨 **Beautiful UI**
- **Dark Theme**: Eye-friendly design for long coding sessions
- **Gradient Accents**: Modern purple/pink gradient design
- **Glassmorphism**: Backdrop blur effects and transparency
- **Animations**: Smooth transitions and visual feedback
- **PWA Support**: Install as a native app on mobile devices

### 🔐 **Security & Privacy**
- **JWT Authentication**: Secure WebSocket connections with token-based auth
- **TLS/HTTPS Support**: Encrypted connections by default
- **Local Processing**: Terminal runs locally, only audio sent to OpenAI
- **Optional Insecure Mode**: For development and testing

### 🛠️ **Developer Experience**
- **Quick Start Guide**: Interactive onboarding for new users
- **Keyboard Shortcuts**: Power-user shortcuts for common actions
- **Settings Panel**: Customize behavior, speech settings, and preferences
- **Help Documentation**: Built-in help with usage examples
- **Error Handling**: Clear error messages and recovery suggestions

## 🚀 Quick Start

### Prerequisites

1. **Plandex CLI**: Install Plandex and ensure it's in your PATH
   ```bash
   # Install Plandex (visit https://plandex.ai for latest instructions)
   curl -sL https://plandex.ai/install.sh | bash
   ```

2. **OpenAI API Key**: Get an API key from OpenAI for Whisper speech recognition
   ```bash
   export OPENAI_API_KEY="sk-your-api-key-here"
   ```

3. **TLS Certificates** (optional for production):
   ```bash
   # Generate self-signed certificates for testing
   openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem \
     -subj "/CN=localhost" -days 365
   ```

### Installation & Running

1. **Build the application**:
   ```bash
   go mod tidy
   CGO_ENABLED=0 go build -ldflags="-s -w" -o voiceagent
   # OR use the management script
   ./manage.sh build
   ```

2. **Run the server**:
   ```bash
   # Using the management script (recommended)
   ./manage.sh start

   # Manual start (alternative)
   INSECURE=true ADDR=:8000 ./voiceagent
   ```

3. **Access the interface**:
   - Development: `http://localhost:8000`

### 🔧 **Management Commands**

Use the `manage.sh` script for easy process management:

```bash
./manage.sh start     # Start the server
./manage.sh stop      # Stop the server gracefully
./manage.sh restart   # Restart the server
./manage.sh status    # Check if running
./manage.sh logs      # View logs in real-time
./manage.sh build     # Build the binary
./manage.sh help      # Show all commands
```

**Benefits of using `manage.sh`:**
- ✅ **Graceful shutdown** - Properly terminates Plandex processes
- ✅ **Process management** - Prevents duplicate instances
- ✅ **Background execution** - Runs as daemon with logging
- ✅ **Status monitoring** - Easy status checks and process info

### 🩺 **Troubleshooting**

Use the `troubleshoot.sh` script to diagnose and fix common issues:

```bash
./troubleshoot.sh         # Run all diagnostic checks
./troubleshoot.sh fix     # Attempt to fix common issues
./troubleshoot.sh logs    # Show recent logs
./troubleshoot.sh server  # Check Plandex server status
./troubleshoot.sh openai  # Check OpenAI API configuration
```

**Common Issues & Solutions:**
- ❌ **"Plandex server not running"** → Run `plandex server start`
- ❌ **"Terminal connection lost"** → Run `./troubleshoot.sh fix`
- ❌ **"OpenAI API overloaded"** → Wait and try again, or check API limits
- ❌ **"PTY read errors"** → Restart with `./manage.sh restart`

## ⚙️ Configuration

Configure via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ADDR` | `:8000` | Server bind address |
| `TLS_CERT` | `cert.pem` | TLS certificate file path |
| `TLS_KEY` | `key.pem` | TLS private key file path |
| `JWT_SECRET` | (generated) | JWT signing secret |
| `INSECURE` | `false` | Disable TLS for development |
| `OPENAI_API_KEY` | (required) | OpenAI API key for Whisper |

## 📱 Usage

### Getting Started
1. **Open the web interface** in your browser
2. **Allow microphone access** when prompted
3. **Follow the quick start guide** or dismiss it to begin
4. **Click the microphone button** or press `Ctrl+Space` to start recording
5. **Speak your coding request** clearly (e.g., "add unit test for login function")
6. **Watch the terminal** for Plandex's response and hear it read aloud

### Voice Commands

#### Development Commands
- **"add unit test for [function]"** - Generate comprehensive tests
- **"fix the bug in [component]"** - Debug and fix issues
- **"refactor the [module] to use [pattern]"** - Improve code structure
- **"create a new [component] that [description]"** - Generate new code
- **"optimize the performance of [function]"** - Performance improvements
- **"add error handling to [function]"** - Robust error management

#### Control Commands
- **"stop"** - Interrupt current Plandex operation (Ctrl-C)
- **"apply changes"** or **"apply"** - Execute `:apply` to accept changes
- **"background"** - Background current task with 'b' key
- **"help"** - Show Plandex help documentation
- **"quit"** - Exit Plandex

### Keyboard Shortcuts
- **`Ctrl+Space`** - Start/stop voice recording
- **`F11`** - Toggle terminal fullscreen mode
- **`?`** - Show help panel (when not in input field)
- **`Ctrl+C`** - Interrupt terminal task (when terminal focused)

### Settings & Customization
Access the settings panel (⚙️ button) to customize:
- **Text-to-Speech**: Enable/disable and adjust speech rate
- **Auto-apply**: Automatically execute recognized voice commands
- **Microphone Sensitivity**: Adjust voice detection threshold
- **Reset to Defaults**: Restore original settings

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Web Browser   │    │   Go Server      │    │   Plandex CLI   │
│                 │    │                  │    │                 │
│  ┌───────────┐  │    │  ┌────────────┐  │    │  ┌───────────┐  │
│  │ xterm.js  │◄─┼────┼─►│ PTY Bridge │◄─┼────┼─►│ Terminal  │  │
│  └───────────┘  │    │  └────────────┘  │    │  └───────────┘  │
│                 │    │                  │    │                 │
│  ┌───────────┐  │    │  ┌────────────┐  │    │                 │
│  │ Web Audio │◄─┼────┼─►│ Audio Proxy│  │    │                 │
│  └───────────┘  │    │  └────────────┘  │    │                 │
│                 │    │         │        │    │                 │
└─────────────────┘    └─────────┼────────┘    └─────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │    OpenAI Whisper API   │
                    │   (Speech Recognition)  │
                    └─────────────────────────┘
```

### Data Flow
1. **Voice Input** → Web Audio API captures microphone
2. **Audio Streaming** → WebSocket sends PCM audio to Go server
3. **Speech Recognition** → Server forwards audio to OpenAI Whisper
4. **Command Processing** → Transcribed text converted to Plandex commands
5. **Terminal Execution** → Commands sent to Plandex via PTY
6. **Real-time Output** → Terminal output streamed back to browser
7. **Text-to-Speech** → Browser speaks responses using Web Speech API

## 🛡️ Security

- **Default TLS**: HTTPS/WSS connections by default
- **JWT Authentication**: Token-based WebSocket authentication
- **Local Terminal**: Plandex runs locally, maintaining full control
- **Minimal Attack Surface**: Only audio data sent to external services
- **Environment Variables**: Secure configuration without hardcoded secrets

## 🔧 Development

### Project Structure
```
voiceagent/
├── main.go           # Go server with WebSocket handlers
├── web/              # Frontend assets
│   ├── index.html    # Main UI
│   ├── style.css     # Modern styling
│   └── app.js        # JavaScript application
├── go.mod            # Go dependencies
└── README.md         # This file
```

### Building from Source
```bash
git clone https://github.com/your-username/voiceagent
cd voiceagent
go mod tidy
CGO_ENABLED=0 go build -ldflags="-s -w" -o voiceagent
```

### Development Mode
```bash
INSECURE=true ADDR=:8000 OPENAI_API_KEY=your-key ./voiceagent
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Plandex](https://plandex.ai) - The amazing AI coding assistant
- [OpenAI Whisper](https://openai.com/research/whisper) - Speech recognition API
- [xterm.js](https://xtermjs.org/) - Terminal emulator for the web
- [Go](https://golang.org/) - Backend server language

---

**Made with ❤️ for developers who want to code hands-free**

