# Voice Plandex Development Guide

This guide helps you develop, modify, and extend Voice Plandex.

## 🚀 Quick Development Setup

1. **Clone and Setup**:
   ```bash
   git clone <your-repo>
   cd voiceplandex
   go mod tidy
   ```

2. **Set Environment Variables**:
   ```bash
   export OPENAI_API_KEY="sk-your-api-key-here"
   ```

3. **Run in Development Mode**:
   ```bash
   ./run.sh --dev
   # Or manually:
   INSECURE=true ADDR=:8000 ./voiceagent
   ```

4. **Access the Interface**:
   Open `http://localhost:8000` in your browser

## 📁 Project Structure

```
voiceplandex/
├── main.go              # Go server with WebSocket handlers
├── web/                 # Frontend assets (embedded in binary)
│   ├── index.html       # Main UI structure
│   ├── style.css        # CSS styling and responsive design
│   └── app.js           # JavaScript application logic
├── go.mod & go.sum      # Go dependencies
├── run.sh               # Startup script
├── README.md            # User documentation
├── DEVELOPMENT.md       # This file
└── .gitignore           # Git ignore rules
```

## 🔧 Development Workflow

### Frontend Development
The frontend files are embedded in the Go binary using `go:embed`. To see changes:

1. **Modify files** in the `web/` directory
2. **Rebuild** the application:
   ```bash
   go build -o voiceagent
   ```
3. **Restart** the server to see changes

### Backend Development
The Go server handles WebSocket connections and audio processing:

1. **Make changes** to `main.go`
2. **Rebuild and restart**:
   ```bash
   go build -o voiceagent && ./voiceagent
   ```

### Hot Reloading (Optional)
For faster development, you can use tools like `air` for auto-reloading:

```bash
# Install air
go install github.com/cosmtrek/air@latest

# Run with auto-reload
air
```

## 🧱 Architecture Deep Dive

### WebSocket Handlers

#### `/ws/pty` - Terminal Connection
- Bridges browser terminal (xterm.js) with Plandex PTY
- Handles bidirectional communication
- Manages PTY lifecycle and cleanup

#### `/ws/audio` - Voice Input
- Receives PCM audio data from browser
- Forwards to OpenAI Whisper API
- Returns transcription results

### Audio Processing Flow

1. **Browser** → Web Audio API captures microphone
2. **JavaScript** → Converts to PCM16 format
3. **WebSocket** → Streams audio chunks to server
4. **Go Server** → Creates WAV from PCM data
5. **OpenAI API** → Transcribes audio to text
6. **Command Processing** → Maps text to Plandex commands
7. **PTY Execution** → Sends commands to Plandex

### Security Model

- **JWT Authentication**: All WebSocket connections require valid tokens
- **TLS by Default**: HTTPS/WSS in production mode
- **Local Processing**: Only audio sent to external services
- **Environment Configuration**: Secrets via environment variables

## 🎨 UI Development

### CSS Architecture
- **CSS Custom Properties**: Consistent theming with CSS variables
- **Modern Layouts**: Flexbox and Grid for responsive design
- **Glassmorphism**: Backdrop blur effects for modern aesthetics
- **Animations**: Smooth transitions with `cubic-bezier` easing

### JavaScript Architecture
- **Class-based**: `VoicePlandex` class manages application state
- **Event-driven**: Modular event handling for user interactions
- **Async/Await**: Modern JavaScript patterns
- **Error Handling**: Graceful degradation and user feedback

### Key UI Components

#### Terminal Interface
- **xterm.js Integration**: Full terminal emulation
- **Responsive Sizing**: Auto-fit on window resize
- **Theme Customization**: Dark theme with syntax highlighting

#### Voice Controls
- **Microphone Button**: Visual feedback for recording state
- **Voice Commands**: Quick-access command buttons
- **Caption Display**: Real-time transcription feedback

#### Settings Panel
- **Modal Design**: Backdrop blur and overlay
- **Form Controls**: Custom toggles and sliders
- **Persistence**: Local storage for user preferences

## 🧪 Testing

### Manual Testing Checklist

#### Voice Functionality
- [ ] Microphone access permission
- [ ] Audio recording and visualization
- [ ] OpenAI Whisper transcription
- [ ] Voice command execution
- [ ] Text-to-speech playback

#### Terminal Functionality  
- [ ] Plandex PTY connection
- [ ] Keyboard input handling
- [ ] Real-time output streaming
- [ ] ANSI color support

#### UI/UX Testing
- [ ] Responsive design on mobile
- [ ] Dark theme consistency
- [ ] Animation smoothness
- [ ] Error message clarity
- [ ] Settings persistence

### Automated Testing
```bash
# Run Go tests
go test ./...

# Frontend testing (if you add tests)
# npm test
```

## 🔌 Extension Points

### Adding New Voice Commands

1. **Update Command Map** in `main.go`:
   ```go
   var voiceCommands = map[string]string{
       "your command": "plandex_action",
   }
   ```

2. **Add UI Button** in `index.html`:
   ```html
   <button class="command-chip" data-command="your command">
       "your command" - Description
   </button>
   ```

### Adding New Settings

1. **Update Settings Object** in `app.js`:
   ```javascript
   this.settings = {
       yourSetting: defaultValue
   };
   ```

2. **Add UI Control** in settings panel
3. **Handle Setting Change** in event listeners

### Integrating Other AI Services

1. **Replace OpenAI Handler** in `processAudioChunk()`
2. **Update Audio Format** if needed
3. **Modify Response Parsing** for new API format

## 🚀 Building for Production

### Single Binary Build
```bash
CGO_ENABLED=0 go build -ldflags="-s -w" -o voiceagent
```

### Docker Build (example)
```dockerfile
FROM golang:alpine AS builder
WORKDIR /app
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o voiceagent

FROM alpine:latest
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/voiceagent /voiceagent
EXPOSE 443
CMD ["/voiceagent"]
```

### Environment Configuration

Production environment variables:
```bash
OPENAI_API_KEY=sk-prod-key
ADDR=:443
TLS_CERT=/path/to/cert.pem
TLS_KEY=/path/to/key.pem
```

## 🐛 Debugging

### Common Issues

#### "Microphone not working"
- Check browser permissions
- Verify HTTPS/secure context
- Test with `navigator.mediaDevices.getUserMedia()`

#### "OpenAI API errors"
- Verify API key validity
- Check rate limits and quotas
- Monitor network requests in dev tools

#### "Terminal not connecting"
- Ensure Plandex is installed and in PATH
- Check WebSocket connection in network tab
- Verify JWT authentication

### Debug Logging

Enable verbose logging:
```bash
INSECURE=true DEBUG=true ./voiceagent
```

## 📚 Resources

- [Plandex Documentation](https://plandex.ai/docs)
- [OpenAI Whisper API](https://platform.openai.com/docs/guides/speech-to-text)
- [xterm.js Documentation](https://xtermjs.org/docs/)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)

## 🤝 Contributing

1. **Fork** the repository
2. **Create feature branch**: `git checkout -b feature/amazing-feature`
3. **Follow coding standards**: Go fmt, ES6+ JavaScript
4. **Test thoroughly**: Manual testing checklist
5. **Document changes**: Update README and comments
6. **Submit PR**: Clear description of changes

---

Happy coding! 🚀 