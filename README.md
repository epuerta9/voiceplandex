# Voice Plandex

A voice-controlled web interface for Plandex CLI that enables hands-free coding through speech-to-text and real-time terminal interaction.

## Features

- **Voice Control**: Speak commands to Plandex using your microphone
- **Real-time Terminal**: Live terminal interface with xterm.js showing Plandex TUI
- **Speech Recognition**: OpenAI Whisper integration for accurate speech-to-text
- **Text-to-Speech**: Hear Plandex responses read aloud
- **Voice Commands**: Special keywords like "stop", "apply changes", "background"
- **Secure**: JWT authentication with TLS/HTTPS support
- **Responsive**: Works on desktop and mobile browsers

## Quick Start

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
   ```

2. **Run the server**:
   ```bash
   # Production mode (requires TLS certificates)
   ./voiceagent

   # Development mode (insecure, no TLS)
   INSECURE=true ADDR=:8000 ./voiceagent
   ```

3. **Access the interface**:
   - Production: `https://localhost` (or your server's address)
   - Development: `http://localhost:8000`

## Configuration

Configure via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ADDR` | `:8000` | Server bind address |
| `TLS_CERT` | `cert.pem` | TLS certificate file path |
| `TLS_KEY` | `key.pem` | TLS private key file path |
| `JWT_SECRET` | (generated) | JWT signing secret |
| `INSECURE` | `false` | Disable TLS for development |
| `OPENAI_API_KEY` | (required) | OpenAI API key for Whisper |

## Usage

### Voice Commands

1. **Hold the microphone button** or press `Ctrl+Space` to start recording
2. **Speak your command** clearly (e.g., "add unit test for login function")
3. **Release the button** to send the audio for processing
4. **Watch the terminal** for Plandex's response and hear it read aloud

### Special Voice Keywords

- **"stop"** - Sends Ctrl-C to interrupt current operation
- **"apply changes"** or **"apply"** - Executes `:apply` command
- **"background"** - Sends 'b' key to background current task
- **"help"** - Shows Plandex help
- **"quit"** - Exits Plandex

### Manual Terminal Access

You can always type directly in the terminal interface as a fallback or for complex commands.

## Architecture

