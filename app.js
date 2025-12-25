// ========================================
// Anima - AI Avatar Chat
// Frontend JavaScript
// ========================================

// Configuration
const API_URL = 'https://madras1-anima.hf.space'; // HuggingFace Space

// State
let chatHistory = [];
let avatarImage = null;
let faceDetection = null;
let isModelLoaded = false;

// Audio state (global to avoid recreating)
let audioContext = null;
let analyser = null;
let audioSource = null;

// DOM Elements
const avatarContainer = document.getElementById('avatarContainer');
const avatarPlaceholder = document.getElementById('avatarPlaceholder');
const avatarCanvas = document.getElementById('avatarCanvas');
const avatarInput = document.getElementById('avatarInput');
const avatarStatus = document.getElementById('avatarStatus');
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const audioPlayer = document.getElementById('audioPlayer');

// ========================================
// Face Detection Setup
// ========================================

async function loadFaceApiModels() {
    try {
        setAvatarStatus('Carregando modelos...', 'loading');

        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model';

        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL)
        ]);

        isModelLoaded = true;
        setAvatarStatus('Pronto! Adicione uma foto.', 'success');
        console.log('Face-api models loaded');
    } catch (error) {
        console.error('Error loading face-api models:', error);
        setAvatarStatus('Erro ao carregar modelos', 'error');
    }
}

// ========================================
// Avatar Handling
// ========================================

avatarContainer.addEventListener('click', () => {
    avatarInput.click();
});

avatarInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!isModelLoaded) {
        setAvatarStatus('Aguarde os modelos carregarem...', 'error');
        return;
    }

    try {
        setAvatarStatus('Processando imagem...', 'loading');

        // Load image
        const img = new Image();
        img.src = URL.createObjectURL(file);

        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
        });

        // Detect face
        const detection = await faceapi
            .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
            .withFaceLandmarks();

        if (!detection) {
            setAvatarStatus('Nenhum rosto detectado. Tente outra foto.', 'error');
            return;
        }

        faceDetection = detection;
        avatarImage = img;

        // Draw to canvas
        drawAvatar();

        // Show canvas, hide placeholder
        avatarPlaceholder.classList.add('hidden');
        avatarCanvas.classList.remove('hidden');

        setAvatarStatus('Avatar configurado! ✓', 'success');

    } catch (error) {
        console.error('Error processing image:', error);
        setAvatarStatus('Erro ao processar imagem', 'error');
    }
});

function drawAvatar(speakingIntensity = 0) {
    if (!avatarImage || !faceDetection) return;

    const ctx = avatarCanvas.getContext('2d');
    const size = 200;

    avatarCanvas.width = size;
    avatarCanvas.height = size;

    // Calculate crop to center on face
    const box = faceDetection.detection.box;
    const padding = box.width * 0.5;

    const sx = Math.max(0, box.x - padding);
    const sy = Math.max(0, box.y - padding);
    const sw = box.width + padding * 2;
    const sh = box.height + padding * 2;

    // Apply subtle scale effect when speaking
    const scale = 1 + (speakingIntensity * 0.02);
    const offset = (size * (scale - 1)) / 2;

    ctx.save();

    // Draw with subtle scale animation
    ctx.drawImage(
        avatarImage,
        sx, sy, sw, sh,
        -offset, -offset,
        size * scale, size * scale
    );

    ctx.restore();
}

function setAvatarStatus(text, type = '') {
    avatarStatus.textContent = text;
    avatarStatus.className = 'avatar-status ' + type;
}

// ========================================
// Chat Functionality
// ========================================

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const message = messageInput.value.trim();
    if (!message) return;

    // Add user message to UI
    addMessage(message, 'user');
    messageInput.value = '';

    // Disable input while processing
    setInputEnabled(false);

    // Show typing indicator
    const typingIndicator = showTypingIndicator();

    try {
        // Send to API
        const response = await fetch(`${API_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                history: chatHistory
            })
        });

        if (!response.ok) {
            throw new Error('API error: ' + response.status);
        }

        const data = await response.json();

        // Remove typing indicator
        typingIndicator.remove();

        // Add assistant message
        addMessage(data.text, 'assistant');

        // Update history
        chatHistory.push({ role: 'user', content: message });
        chatHistory.push({ role: 'assistant', content: data.text });

        // Keep history manageable (last 10 exchanges)
        if (chatHistory.length > 20) {
            chatHistory = chatHistory.slice(-20);
        }

        // Play audio with lip sync
        if (data.audio_base64) {
            await playAudioWithLipSync(data.audio_base64);
        }

    } catch (error) {
        console.error('Chat error:', error);
        typingIndicator.remove();
        addMessage('Desculpe, ocorreu um erro. Verifique se o backend está rodando.', 'assistant');
    } finally {
        setInputEnabled(true);
        messageInput.focus();
    }
});

function addMessage(text, role) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    messageDiv.innerHTML = `<div class="message-content">${escapeHtml(text)}</div>`;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'message assistant';
    indicator.innerHTML = `
        <div class="message-content typing-indicator">
            <span></span><span></span><span></span>
        </div>
    `;
    chatMessages.appendChild(indicator);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return indicator;
}

function setInputEnabled(enabled) {
    messageInput.disabled = !enabled;
    sendButton.disabled = !enabled;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========================================
// Audio & Lip Sync
// ========================================

async function playAudioWithLipSync(base64Audio) {
    return new Promise(async (resolve) => {
        // Convert base64 to blob
        const byteCharacters = atob(base64Audio);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'audio/mp3' });

        // Set audio source
        const audioUrl = URL.createObjectURL(blob);

        // Initialize audio context only once
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            audioSource = audioContext.createMediaElementSource(audioPlayer);
            audioSource.connect(analyser);
            analyser.connect(audioContext.destination);
        }

        // Resume context if suspended (browser autoplay policy)
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        audioPlayer.src = audioUrl;

        // Start speaking animation
        avatarContainer.classList.add('speaking');

        // Animate lip sync
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let animationId;

        function animateLipSync() {
            analyser.getByteFrequencyData(dataArray);

            // Calculate average volume (focus on speech frequencies)
            let sum = 0;
            for (let i = 0; i < 20; i++) {
                sum += dataArray[i];
            }
            const average = sum / 20;
            const speakingIntensity = Math.min(average / 50, 2);

            drawAvatar(speakingIntensity);

            animationId = requestAnimationFrame(animateLipSync);
        }

        audioPlayer.onplay = () => {
            animateLipSync();
        };

        audioPlayer.onended = () => {
            cancelAnimationFrame(animationId);
            avatarContainer.classList.remove('speaking');
            drawAvatar(0);
            URL.revokeObjectURL(audioUrl);
            resolve();
        };

        audioPlayer.onerror = () => {
            cancelAnimationFrame(animationId);
            avatarContainer.classList.remove('speaking');
            URL.revokeObjectURL(audioUrl);
            resolve();
        };

        audioPlayer.play().catch(error => {
            console.error('Audio play error:', error);
            avatarContainer.classList.remove('speaking');
            resolve();
        });
    });
}

// ========================================
// Initialize
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    loadFaceApiModels();
});
