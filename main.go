package main

import (
	"bytes"
	"crypto/rand"
	"embed"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
)

//go:embed web/*
var webFS embed.FS

// Configuration
type Config struct {
	Addr         string
	TLSCert      string
	TLSKey       string
	JWTSecret    string
	Insecure     bool
	OpenAIAPIKey string
}

// Global state
var (
	config         Config
	upgrader       = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	ptyMutex       sync.Mutex
	ptyConn        *os.File
	ptyCmd         *exec.Cmd
	ptyWriter      io.WriteCloser
	audioConnMutex sync.Mutex // Mutex to protect WebSocket writes
)

// OpenAI Whisper API structures
type OpenAIRequest struct {
	Model      string `json:"model"`
	Language   string `json:"language,omitempty"`
	Prompt     string `json:"prompt,omitempty"`
	Format     string `json:"response_format"`
	SampleRate int    `json:"sample_rate,omitempty"`
}

type OpenAIResponse struct {
	Text    string `json:"text,omitempty"`
	Type    string `json:"type,omitempty"`
	IsFinal bool   `json:"is_final,omitempty"`
}

// Voice command mappings
var voiceCommands = map[string]string{
	"stop":          "\x03",     // Ctrl-C
	"background":    "b",        // b key
	"apply changes": ":apply\n", // :apply command
	"apply":         ":apply\n", // short version
	"quit":          ":quit\n",  // quit command
	"help":          ":help\n",  // help command
}

func init() {
	config = Config{
		Addr:         getEnv("ADDR", ":8000"),
		TLSCert:      getEnv("TLS_CERT", "cert.pem"),
		TLSKey:       getEnv("TLS_KEY", "key.pem"),
		JWTSecret:    getEnv("JWT_SECRET", generateSecret()),
		Insecure:     getEnv("INSECURE", "false") == "true",
		OpenAIAPIKey: getEnv("OPENAI_API_KEY", ""),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func generateSecret() string {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		log.Fatal("Failed to generate JWT secret:", err)
	}
	return hex.EncodeToString(bytes)
}

// JWT Authentication middleware
func authenticateWS(r *http.Request) error {
	if config.Insecure {
		return nil
	}

	// Check for JWT in query parameter or Sec-WebSocket-Protocol header
	tokenString := r.URL.Query().Get("token")
	if tokenString == "" {
		protocols := r.Header.Get("Sec-WebSocket-Protocol")
		if strings.HasPrefix(protocols, "jwt-") {
			tokenString = strings.TrimPrefix(protocols, "jwt-")
		}
	}

	if tokenString == "" {
		return fmt.Errorf("missing JWT token")
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(config.JWTSecret), nil
	})

	if err != nil || !token.Valid {
		return fmt.Errorf("invalid JWT token")
	}

	return nil
}

// Generate JWT token endpoint
func tokenHandler(w http.ResponseWriter, r *http.Request) {
	if config.Insecure {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"token": "insecure-mode"})
		return
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"exp": time.Now().Add(24 * time.Hour).Unix(),
		"iat": time.Now().Unix(),
	})

	tokenString, err := token.SignedString([]byte(config.JWTSecret))
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": tokenString})
}

// PTY WebSocket handler
func ptyHandler(w http.ResponseWriter, r *http.Request) {
	if err := authenticateWS(r); err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("PTY WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	// Initialize or reuse PTY
	ptyMutex.Lock()
	needsInit := ptyConn == nil || ptyCmd == nil || ptyCmd.ProcessState != nil
	ptyMutex.Unlock()

	if needsInit {
		ptyMutex.Lock()
		// Double-check after acquiring lock
		if ptyConn == nil || ptyCmd == nil || ptyCmd.ProcessState != nil {
			if err := initPlandexPTY(); err != nil {
				ptyMutex.Unlock()
				log.Printf("Failed to initialize Plandex PTY: %v", err)

				// Send helpful error message to client
				var errorMsg string
				if strings.Contains(err.Error(), "server not running") {
					errorMsg = "🚨 Plandex server is not running!\r\n\r\nPlease start the Plandex server first:\r\n" +
						"  plandex server start\r\n\r\n" +
						"Then refresh this page to reconnect.\r\n"
				} else if strings.Contains(err.Error(), "not found in PATH") {
					errorMsg = "🚨 Plandex CLI not found!\r\n\r\nPlease install Plandex CLI:\r\n" +
						"  curl -sL https://plandex.ai/install.sh | bash\r\n\r\n" +
						"Then refresh this page to reconnect.\r\n"
				} else {
					errorMsg = fmt.Sprintf("🚨 Failed to start Plandex: %v\r\n\r\n"+
						"Please check your Plandex installation and try again.\r\n", err)
				}

				conn.WriteMessage(websocket.TextMessage, []byte(errorMsg))
				return
			}
		}
		ptyMutex.Unlock()
	}

	// Get current PTY connection
	ptyMutex.Lock()
	currentPty := ptyConn
	ptyMutex.Unlock()

	if currentPty == nil {
		log.Printf("PTY connection is nil after initialization")
		conn.WriteMessage(websocket.TextMessage, []byte("🚨 Failed to establish terminal connection\r\n"))
		return
	}

	// Create a done channel to coordinate cleanup
	done := make(chan bool, 2)

	// Handle WebSocket messages (browser -> PTY)
	go func() {
		defer func() {
			select {
			case done <- true:
			default:
			}
		}()
		for {
			messageType, data, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					log.Printf("PTY WebSocket read error: %v", err)
				}
				return
			}
			if messageType == websocket.TextMessage || messageType == websocket.BinaryMessage {
				ptyMutex.Lock()
				if currentPty != nil {
					if _, err := currentPty.Write(data); err != nil {
						log.Printf("PTY write error: %v", err)
						ptyMutex.Unlock()
						return
					}
				}
				ptyMutex.Unlock()
			}
		}
	}()

	// Handle PTY output (PTY -> browser)
	go func() {
		defer func() {
			select {
			case done <- true:
			default:
			}
		}()
		buf := make([]byte, 4096)
		for {
			ptyMutex.Lock()
			if currentPty == nil {
				ptyMutex.Unlock()
				return
			}

			// Set read deadline to avoid blocking forever
			currentPty.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
			n, err := currentPty.Read(buf)
			currentPty.SetReadDeadline(time.Time{}) // Clear deadline
			ptyMutex.Unlock()

			if err != nil {
				if err == io.EOF {
					log.Printf("PTY reached EOF, process may have exited")
					return
				}
				if netErr, ok := err.(interface{ Timeout() bool }); ok && netErr.Timeout() {
					// Timeout is expected, continue reading
					continue
				}
				log.Printf("PTY read error: %v", err)
				return
			}

			if n > 0 {
				if err := conn.WriteMessage(websocket.TextMessage, buf[:n]); err != nil {
					if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
						log.Printf("PTY WebSocket write error: %v", err)
					}
					return
				}
			}
		}
	}()

	// Wait for either goroutine to finish
	<-done
}

// Initialize Plandex PTY
func initPlandexPTY() error {
	// Check if plandex is available
	if _, err := exec.LookPath("plandex"); err != nil {
		return fmt.Errorf("plandex not found in PATH: %v", err)
	}

	// Test if Plandex server is running by trying a simple command
	testCmd := exec.Command("plandex", "version")
	if err := testCmd.Run(); err != nil {
		return fmt.Errorf("plandex server not running (run 'plandex server start'): %v", err)
	}

	// Start Plandex REPL
	cmd := exec.Command("plandex", "repl")
	cmd.Env = os.Environ()

	ptmx, err := pty.Start(cmd)
	if err != nil {
		return fmt.Errorf("failed to start plandex: %v", err)
	}

	// Set PTY size to reasonable defaults
	if err := pty.Setsize(ptmx, &pty.Winsize{Rows: 24, Cols: 80}); err != nil {
		log.Printf("Warning: failed to set PTY size: %v", err)
	}

	ptyConn = ptmx
	ptyCmd = cmd
	ptyWriter = ptmx

	log.Println("Plandex PTY initialized successfully")
	return nil
}

// Audio WebSocket handler
func audioHandler(w http.ResponseWriter, r *http.Request) {
	if err := authenticateWS(r); err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if config.OpenAIAPIKey == "" {
		http.Error(w, "OpenAI API key not configured", http.StatusServiceUnavailable)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Audio WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	log.Println("Audio WebSocket connection established")

	// Handle audio streaming and transcription
	for {
		messageType, data, err := conn.ReadMessage()
		if err != nil {
			log.Printf("Audio WebSocket read error: %v", err)
			return
		}

		if messageType == websocket.BinaryMessage {
			// Process audio data with OpenAI Whisper
			go processAudioChunk(conn, data)
		}
	}
}

// Process audio chunk with OpenAI Whisper
func processAudioChunk(conn *websocket.Conn, audioData []byte) {
	if config.OpenAIAPIKey == "" {
		log.Printf("OpenAI API key not configured")
		return
	}

	// Validate audio data
	if len(audioData) < 1024 { // Skip very small chunks
		return
	}

	// Convert audio data to WAV format for OpenAI Whisper
	wavData := createWAVFromPCM(audioData, 16000, 16, 1)

	// Create multipart form data for OpenAI Whisper API
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	// Add file field
	fileWriter, err := writer.CreateFormFile("file", "audio.wav")
	if err != nil {
		log.Printf("Failed to create form file: %v", err)
		sendAudioError(conn, "Failed to prepare audio data")
		return
	}
	fileWriter.Write(wavData)

	// Add model field
	writer.WriteField("model", "whisper-1")
	writer.WriteField("language", "en")
	writer.WriteField("response_format", "json")

	writer.Close()

	// Send request to OpenAI
	req, err := http.NewRequest("POST", "https://api.openai.com/v1/audio/transcriptions", &buf)
	if err != nil {
		log.Printf("Failed to create OpenAI request: %v", err)
		sendAudioError(conn, "Failed to create request")
		return
	}

	req.Header.Set("Authorization", "Bearer "+config.OpenAIAPIKey)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Failed to send request to OpenAI: %v", err)
		sendAudioError(conn, "Failed to connect to AI service")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("OpenAI API error (%d): %s", resp.StatusCode, string(body))
		sendAudioError(conn, "AI service error")
		return
	}

	// Parse OpenAI response
	var openaiResp struct {
		Text string `json:"text"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&openaiResp); err != nil {
		log.Printf("Failed to decode OpenAI response: %v", err)
		sendAudioError(conn, "Failed to process AI response")
		return
	}

	// Send transcription result to client
	finalResponse := OpenAIResponse{
		Text:    openaiResp.Text,
		Type:    "final",
		IsFinal: true,
	}

	sendAudioResponse(conn, finalResponse)

	// Execute the voice command
	if finalResponse.IsFinal && finalResponse.Text != "" {
		executeVoiceCommand(finalResponse.Text)
	}
}

// Thread-safe audio response sender
func sendAudioResponse(conn *websocket.Conn, response OpenAIResponse) {
	audioConnMutex.Lock()
	defer audioConnMutex.Unlock()

	if err := conn.WriteJSON(response); err != nil {
		log.Printf("Failed to send audio response: %v", err)
	}
}

// Thread-safe audio error sender
func sendAudioError(conn *websocket.Conn, message string) {
	audioConnMutex.Lock()
	defer audioConnMutex.Unlock()

	errorResponse := OpenAIResponse{
		Text:    "",
		Type:    "error",
		IsFinal: false,
	}

	if err := conn.WriteJSON(errorResponse); err != nil {
		log.Printf("Failed to send audio error: %v", err)
	}
}

// Execute voice command
func executeVoiceCommand(text string) {
	log.Printf("Executing voice command: %s", text)

	// Check for special voice keywords first
	lowerText := strings.ToLower(strings.TrimSpace(text))
	if keystrokes, exists := voiceCommands[lowerText]; exists {
		sendToPlandex(keystrokes)
		return
	}

	// Otherwise, send as "plandex tell" command
	command := fmt.Sprintf("tell \"%s\"\n", text)
	sendToPlandex(command)
}

// Send command to Plandex
func sendToPlandex(command string) {
	ptyMutex.Lock()
	defer ptyMutex.Unlock()

	if ptyWriter != nil {
		if _, err := ptyWriter.Write([]byte(command)); err != nil {
			log.Printf("Failed to send command to Plandex: %v", err)
		}
	}
}

// Create WAV file from PCM data
func createWAVFromPCM(pcmData []byte, sampleRate, bitsPerSample, channels int) []byte {
	var buf bytes.Buffer

	// Ensure we have valid PCM data
	if len(pcmData) == 0 {
		return nil
	}

	// Calculate sizes
	dataSize := uint32(len(pcmData))
	fileSize := uint32(36 + dataSize)

	// WAV header
	buf.WriteString("RIFF")
	binary.Write(&buf, binary.LittleEndian, fileSize) // File size - 8 bytes
	buf.WriteString("WAVE")

	// Format chunk
	buf.WriteString("fmt ")
	fmtChunkSize := uint32(16)
	binary.Write(&buf, binary.LittleEndian, fmtChunkSize)
	audioFormat := uint16(1) // PCM
	binary.Write(&buf, binary.LittleEndian, audioFormat)
	binary.Write(&buf, binary.LittleEndian, uint16(channels))
	binary.Write(&buf, binary.LittleEndian, uint32(sampleRate))
	byteRate := uint32(sampleRate * channels * bitsPerSample / 8)
	binary.Write(&buf, binary.LittleEndian, byteRate)
	blockAlign := uint16(channels * bitsPerSample / 8)
	binary.Write(&buf, binary.LittleEndian, blockAlign)
	binary.Write(&buf, binary.LittleEndian, uint16(bitsPerSample))

	// Data chunk
	buf.WriteString("data")
	binary.Write(&buf, binary.LittleEndian, dataSize)
	buf.Write(pcmData)

	return buf.Bytes()
}

// Health check endpoint
func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	status := map[string]interface{}{
		"status":                 "ok",
		"plandex_available":      false,
		"plandex_server_running": false,
		"openai_configured":      config.OpenAIAPIKey != "",
	}

	// Check if plandex is available
	if _, err := exec.LookPath("plandex"); err == nil {
		status["plandex_available"] = true

		// Check if plandex server is running
		testCmd := exec.Command("plandex", "version")
		if err := testCmd.Run(); err == nil {
			status["plandex_server_running"] = true
		}
	}

	json.NewEncoder(w).Encode(status)
}

func main() {
	// Setup graceful shutdown
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-c
		log.Println("Shutting down voice agent...")

		// Cleanup PTY
		ptyMutex.Lock()
		if ptyConn != nil {
			log.Println("Closing PTY connection...")
			ptyConn.Close()
		}
		if ptyCmd != nil && ptyCmd.Process != nil {
			log.Println("Terminating Plandex process...")
			ptyCmd.Process.Signal(syscall.SIGTERM)

			// Wait a moment for graceful shutdown, then force kill if needed
			go func() {
				time.Sleep(3 * time.Second)
				if ptyCmd.Process != nil {
					ptyCmd.Process.Kill()
				}
			}()
		}
		ptyMutex.Unlock()

		log.Println("Voice agent shutdown complete")
		os.Exit(0)
	}()

	// Setup HTTP routes
	// Custom static file handler with proper MIME types
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/" {
			path = "web/index.html"
		} else {
			path = "web" + path
		}

		// Set proper MIME types
		switch {
		case strings.HasSuffix(path, ".css"):
			w.Header().Set("Content-Type", "text/css")
		case strings.HasSuffix(path, ".js"):
			w.Header().Set("Content-Type", "application/javascript")
		case strings.HasSuffix(path, ".html"):
			w.Header().Set("Content-Type", "text/html")
		}

		// Serve the file from embedded FS
		data, err := webFS.ReadFile(path)
		if err != nil {
			log.Printf("Failed to read embedded file %s: %v", path, err)
			http.NotFound(w, r)
			return
		}
		w.Write(data)
	})
	http.HandleFunc("/api/token", tokenHandler)
	http.HandleFunc("/api/health", healthHandler)
	http.HandleFunc("/ws/pty", ptyHandler)
	http.HandleFunc("/ws/audio", audioHandler)

	log.Printf("Voice Plandex server starting on %s", config.Addr)
	log.Printf("Insecure mode: %v", config.Insecure)
	log.Printf("OpenAI configured: %v", config.OpenAIAPIKey != "")
	log.Printf("Press Ctrl+C to shutdown gracefully")

	var err error
	if config.Insecure {
		log.Println("WARNING: Running in insecure mode without TLS")
		err = http.ListenAndServe(config.Addr, nil)
	} else {
		err = http.ListenAndServeTLS(config.Addr, config.TLSCert, config.TLSKey, nil)
	}

	if err != nil {
		log.Fatal("Server failed to start:", err)
	}
}
