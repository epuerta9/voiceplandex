package main

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
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
	config    Config
	upgrader  = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	ptyMutex  sync.Mutex
	ptyConn   *pty.Pty
	ptyCmd    *exec.Cmd
	ptyWriter io.WriteCloser
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
	"stop":          "\x03",        // Ctrl-C
	"background":    "b",           // b key
	"apply changes": ":apply\n",    // :apply command
	"apply":         ":apply\n",    // short version
	"quit":          ":quit\n",     // quit command
	"help":          ":help\n",     // help command
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
	if ptyConn == nil || ptyCmd == nil || ptyCmd.ProcessState != nil {
		if err := initPlandexPTY(); err != nil {
			ptyMutex.Unlock()
			log.Printf("Failed to initialize Plandex PTY: %v", err)
			return
		}
	}
	currentPty := ptyConn
	ptyMutex.Unlock()

	// Handle WebSocket messages (browser -> PTY)
	go func() {
		defer conn.Close()
		for {
			messageType, data, err := conn.ReadMessage()
			if err != nil {
				log.Printf("PTY WebSocket read error: %v", err)
				return
			}
			if messageType == websocket.TextMessage || messageType == websocket.BinaryMessage {
				if _, err := currentPty.Write(data); err != nil {
					log.Printf("PTY write error: %v", err)
					return
				}
			}
		}
	}()

	// Handle PTY output (PTY -> browser)
	buf := make([]byte, 4096)
	for {
		n, err := currentPty.Read(buf)
		if err != nil {
			if err != io.EOF {
				log.Printf("PTY read error: %v", err)
			}
			return
		}
		if err := conn.WriteMessage(websocket.TextMessage, buf[:n]); err != nil {
			log.Printf("PTY WebSocket write error: %v", err)
			return
		}
	}
}

// Initialize Plandex PTY
func initPlandexPTY() error {
	// Check if plandex is available
	if _, err := exec.LookPath("plandex"); err != nil {
		return fmt.Errorf("plandex not found in PATH: %v", err)
	}

	cmd := exec.Command("plandex", "repl")
	cmd.Env = os.Environ()
	
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return fmt.Errorf("failed to start plandex: %v", err)
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
	// For now, we'll use a simplified approach
	// In a real implementation, you would buffer audio and send to OpenAI Whisper
	// This is a placeholder that simulates the transcription process
	
	// Send partial transcript back to client
	response := OpenAIResponse{
		Text:    "",
		Type:    "partial",
		IsFinal: false,
	}
	
	if err := conn.WriteJSON(response); err != nil {
		log.Printf("Failed to send partial transcript: %v", err)
		return
	}

	// Simulate processing delay
	time.Sleep(100 * time.Millisecond)

	// For demo purposes, we'll simulate a final transcript after receiving audio
	// In real implementation, this would come from OpenAI Whisper API
	finalResponse := OpenAIResponse{
		Text:    "add unit test for login function",
		Type:    "final", 
		IsFinal: true,
	}

	if err := conn.WriteJSON(finalResponse); err != nil {
		log.Printf("Failed to send final transcript: %v", err)
		return
	}

	// Execute the voice command
	if finalResponse.IsFinal && finalResponse.Text != "" {
		executeVoiceCommand(finalResponse.Text)
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

// Utility function to convert float32 to PCM16
func float32ToPCM16LE(input []float32) []byte {
	output := make([]byte, len(input)*2)
	for i, sample := range input {
		// Clamp sample to [-1, 1] range
		if sample > 1.0 {
			sample = 1.0
		} else if sample < -1.0 {
			sample = -1.0
		}
		
		// Convert to 16-bit signed integer
		sample16 := int16(sample * 32767)
		binary.LittleEndian.PutUint16(output[i*2:], uint16(sample16))
	}
	return output
}

// Health check endpoint
func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	status := map[string]interface{}{
		"status":           "ok",
		"plandex_available": false,
		"openai_configured": config.OpenAIAPIKey != "",
	}

	// Check if plandex is available
	if _, err := exec.LookPath("plandex"); err == nil {
		status["plandex_available"] = true
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
			ptyConn.Close()
		}
		if ptyCmd != nil && ptyCmd.Process != nil {
			ptyCmd.Process.Kill()
		}
		ptyMutex.Unlock()
		
		os.Exit(0)
	}()

	// Setup HTTP routes
	http.Handle("/", http.FileServer(http.FS(webFS)))
	http.HandleFunc("/api/token", tokenHandler)
	http.HandleFunc("/api/health", healthHandler)
	http.HandleFunc("/ws/pty", ptyHandler)
	http.HandleFunc("/ws/audio", audioHandler)

	log.Printf("Voice Plandex server starting on %s", config.Addr)
	log.Printf("Insecure mode: %v", config.Insecure)
	log.Printf("OpenAI configured: %v", config.OpenAIAPIKey != "")

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
