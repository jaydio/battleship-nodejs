class BattleshipGame {
    constructor() {
        this.socket = io();
        this.sessionId = null;
        this.playerId = null;
        this.playerNumber = null;
        this.currentScreen = 'mainMenu';
        this.selectedShip = null;
        this.shipOrientation = 'horizontal'; // horizontal or vertical
        this.placedShips = [];
        this.playerGrid = Array(10).fill().map(() => Array(10).fill(0));
        this.enemyGrid = Array(10).fill().map(() => Array(10).fill(0));
        this.gameState = 'menu';
        this.currentTurn = null;
        this.hitCount = 0;
        this.missCount = 0;
        this.moveTimer = null;
        this.timeRemaining = 30;
        this.audioContext = null;
        this.isHost = false;
        this.hostId = null;
        this.isPaused = false;
        this.playerNames = new Map(); // Store player names
        this.myPlayerName = '';
        
        this.initializeAudio();
        this.initializeEventListeners();
        this.initializeSocketListeners();
    }

    initializeAudio() {
        // Initialize Web Audio API for sound effects
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.log('Web Audio API not supported');
        }
    }

    playTurnSound() {
        if (!this.audioContext) return;
        
        // Create a simple beep sound for turn notification
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        oscillator.frequency.setValueAtTime(800, this.audioContext.currentTime);
        oscillator.frequency.setValueAtTime(600, this.audioContext.currentTime + 0.1);
        
        gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);
        
        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + 0.3);
    }

    playTimeoutWarning() {
        if (!this.audioContext) return;
        
        // Create urgent beeping sound for timeout warning
        for (let i = 0; i < 3; i++) {
            setTimeout(() => {
                const oscillator = this.audioContext.createOscillator();
                const gainNode = this.audioContext.createGain();
                
                oscillator.connect(gainNode);
                gainNode.connect(this.audioContext.destination);
                
                oscillator.frequency.setValueAtTime(1000, this.audioContext.currentTime);
                gainNode.gain.setValueAtTime(0.2, this.audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);
                
                oscillator.start(this.audioContext.currentTime);
                oscillator.stop(this.audioContext.currentTime + 0.1);
            }, i * 200);
        }
    }

    startMoveTimer(timeLimit = 30000) {
        this.clearMoveTimer();
        this.timeRemaining = Math.floor(timeLimit / 1000);
        
        // Update timer display
        this.updateTimerDisplay();
        
        this.moveTimer = setInterval(() => {
            this.timeRemaining--;
            this.updateTimerDisplay();
            
            // Play warning sound when 10 seconds left
            if (this.timeRemaining === 10 && this.currentTurn === this.playerId) {
                this.playTimeoutWarning();
            }
            
            if (this.timeRemaining <= 0) {
                this.clearMoveTimer();
            }
        }, 1000);
    }

    clearMoveTimer() {
        if (this.moveTimer) {
            clearInterval(this.moveTimer);
            this.moveTimer = null;
        }
        this.timeRemaining = 30;
        this.updateTimerDisplay();
    }

    updateTimerDisplay() {
        const timerElement = document.getElementById('moveTimer');
        if (timerElement) {
            timerElement.textContent = `${this.timeRemaining}s`;
            
            // Change color based on time remaining
            if (this.timeRemaining <= 10) {
                timerElement.style.color = '#ff4444';
                timerElement.style.fontWeight = 'bold';
            } else if (this.timeRemaining <= 20) {
                timerElement.style.color = '#ffaa00';
                timerElement.style.fontWeight = 'normal';
            } else {
                timerElement.style.color = '#ffffff';
                timerElement.style.fontWeight = 'normal';
            }
        }
    }

    showTemporaryMessage(message, duration = 3000) {
        const messageDiv = document.createElement('div');
        messageDiv.textContent = message;
        messageDiv.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(255, 107, 53, 0.9);
            color: white;
            padding: 1rem 2rem;
            border-radius: 8px;
            font-size: 1.2rem;
            font-weight: bold;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        
        document.body.appendChild(messageDiv);
        
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
        }, duration);
    }

    initializeEventListeners() {
        // Main menu buttons
        document.getElementById('createGameBtn').addEventListener('click', () => {
            this.showModal('createGameModal');
        });

        // joinGameBtn doesn't exist in HTML - games are joined by clicking on session items

        document.getElementById('archiveBtn').addEventListener('click', () => {
            this.showArchive();
        });

        // Close modal buttons
        document.getElementById('closeCreateModal').addEventListener('click', () => {
            this.hideModal('createGameModal');
        });

        document.getElementById('closeArchiveModal').addEventListener('click', () => {
            this.hideModal('archiveModal');
        });

        document.getElementById('refreshSessionsBtn').addEventListener('click', () => {
            this.socket.emit('requestSessionList');
        });

        // Create game modal
        // Remove this as usePassword doesn't exist in current HTML

        // Create game form
        document.getElementById('createGameForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.createGame();
        });

        // Form submission already handles create game

        document.getElementById('cancelCreateBtn').addEventListener('click', () => {
            this.hideModal('createGameModal');
        });

        // Join game modal
        document.getElementById('confirmJoinBtn').addEventListener('click', () => {
            this.joinGame();
        });

        document.getElementById('cancelJoinBtn').addEventListener('click', () => {
            this.hideModal('joinGameModal');
        });

        // Waiting room
        document.getElementById('copyLinkBtn').addEventListener('click', async () => {
            const linkText = document.getElementById('inviteLinkText').textContent;
            const fullLink = window.location.origin + '/?session=' + linkText;
            
            try {
                await navigator.clipboard.writeText(fullLink);
                // Show success feedback
                const btn = document.getElementById('copyLinkBtn');
                const originalText = btn.textContent;
                btn.textContent = 'Copied!';
                btn.style.background = '#4CAF50';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.background = '';
                }, 2000);
            } catch (err) {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = fullLink;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                alert('Invite link copied to clipboard!');
            }
        });

        document.getElementById('leaveGameBtn').addEventListener('click', () => {
            this.leaveGame();
        });

        document.getElementById('leaveGameBtn2').addEventListener('click', () => {
            this.leaveGame();
        });

        // Host controls
        document.getElementById('pauseBtn').addEventListener('click', () => {
            this.pauseGame();
        });

        document.getElementById('resumeBtn').addEventListener('click', () => {
            this.resumeGame();
        });

        // Ship placement
        document.getElementById('rotateBtn').addEventListener('click', () => {
            this.shipOrientation = this.shipOrientation === 'horizontal' ? 'vertical' : 'horizontal';
        });

        document.getElementById('randomPlacementBtn').addEventListener('click', () => {
            this.randomShipPlacement();
        });

        document.getElementById('confirmPlacementBtn').addEventListener('click', () => {
            this.confirmShipPlacement();
        });

        // Game over
        document.getElementById('newGameBtn').addEventListener('click', () => {
            this.showScreen('mainMenu');
            this.resetGame();
        });

        // Check for invite link in URL
        const urlParams = new URLSearchParams(window.location.search);
        const sessionParam = urlParams.get('session');
        if (sessionParam) {
            const [sessionId, password] = sessionParam.includes('?password=') 
                ? sessionParam.split('?password=') 
                : [sessionParam, null];
            
            if (password) {
                document.getElementById('joinPassword').value = password;
            }
            this.joinSessionById(sessionId, password);
        }
    }

    initializeSocketListeners() {
        this.socket.on('sessionList', (sessions) => {
            this.updateSessionsList(sessions);
        });

        this.socket.on('sessionCreated', (data) => {
            this.sessionId = data.sessionId;
            this.playerId = data.playerId;
            this.isHost = data.isHost || false;
            document.getElementById('sessionId').textContent = data.sessionId;
            
            if (data.inviteLink !== data.sessionId) {
                document.getElementById('inviteLink').style.display = 'block';
                document.getElementById('inviteLinkText').textContent = data.inviteLink;
            }
            
            this.hideModal('createGameModal');
            this.showScreen('waitingRoom');
        });

        this.socket.on('sessionJoined', (data) => {
            this.sessionId = data.sessionId;
            this.playerId = data.playerId;
            this.playerNumber = data.playerNumber;
            this.isHost = data.isHost || false;
            this.hideModal('joinGameModal');
            this.showScreen('waitingRoom');
        });

        this.socket.on('playerJoined', (data) => {
            document.getElementById('playerCount').textContent = data.playerCount;
            if (data.playerCount === 2 && data.gameState === 'placing') {
                this.showScreen('shipPlacement');
                this.initializeShipPlacement();
            }
        });

        this.socket.on('playerLeft', (data) => {
            document.getElementById('playerCount').textContent = data.playerCount;
            this.clearMoveTimer();
        });

        this.socket.on('shipsPlaced', () => {
            // Show confirmation message
            this.showTemporaryMessage('Ships placed! Waiting for opponent...', 3000);
            
            // Disable placement controls
            document.getElementById('confirmPlacementBtn').disabled = true;
            document.getElementById('confirmPlacementBtn').textContent = 'Waiting for opponent...';
            document.getElementById('randomPlacementBtn').disabled = true;
            document.getElementById('rotateBtn').disabled = true;
        });

        this.socket.on('gameStarted', (data) => {
            this.currentTurn = data.currentTurn;
            this.hostId = data.hostId;
            this.playerNames = new Map(data.playerNames || []);
            this.showScreen('gameBoard');
            this.initializeGameBoard();
            this.updateTurnIndicator();
            this.updatePlayerNames();
            this.startMoveTimer(data.timeRemaining);
            
            // Show host controls if player is host
            if (this.isHost) {
                document.getElementById('hostControls').style.display = 'block';
            }
            
            // Play sound if it's player's turn
            if (this.currentTurn === this.playerId) {
                this.playTurnSound();
            }
        });

        this.socket.on('moveResult', (data) => {
            this.handleMoveResult(data);
        });

        this.socket.on('moveTimeout', (data) => {
            this.currentTurn = data.currentTurn;
            this.updateTurnIndicator();
            this.startMoveTimer(data.timeRemaining);
            
            // Play sound if it's now player's turn
            if (this.currentTurn === this.playerId) {
                this.playTurnSound();
            }
            
            // Show timeout message
            this.showTemporaryMessage('Previous player timed out!', 3000);
        });

        this.socket.on('gamePaused', (data) => {
            this.isPaused = true;
            this.clearMoveTimer();
            document.getElementById('pauseBtn').style.display = 'none';
            document.getElementById('resumeBtn').style.display = 'inline-block';
            document.getElementById('moveTimer').textContent = 'PAUSED';
            document.getElementById('moveTimer').style.color = '#ffaa00';
            this.showTemporaryMessage(`Game paused by ${data.pausedBy}`, 3000);
        });

        this.socket.on('gameResumed', (data) => {
            this.isPaused = false;
            this.currentTurn = data.currentTurn;
            this.updateTurnIndicator();
            this.startMoveTimer(data.timeRemaining);
            document.getElementById('pauseBtn').style.display = 'inline-block';
            document.getElementById('resumeBtn').style.display = 'none';
            this.showTemporaryMessage('Game resumed!', 2000);
            
            // Play sound if it's player's turn
            if (this.currentTurn === this.playerId) {
                this.playTurnSound();
            }
        });

        this.socket.on('error', (message) => {
            alert('Error: ' + message);
        });
    }

    showModal(modalId) {
        document.getElementById(modalId).classList.add('active');
        
        // Auto-generate session name when opening create game modal
        if (modalId === 'createGameModal') {
            const sessionNameInput = document.getElementById('sessionName');
            if (sessionNameInput && !sessionNameInput.value.trim()) {
                sessionNameInput.value = this.generateSessionName();
            }
        }
    }

    hideModal(modalId) {
        document.getElementById(modalId).classList.remove('active');
    }
    
    generateSessionName() {
        const adjectives = [
            'Epic', 'Mighty', 'Swift', 'Bold', 'Brave', 'Steel', 'Iron', 'Golden',
            'Silver', 'Thunder', 'Lightning', 'Storm', 'Fire', 'Ice', 'Shadow',
            'Crimson', 'Azure', 'Emerald', 'Royal', 'Noble', 'Ancient', 'Mystic',
            'Fierce', 'Wild', 'Silent', 'Rapid', 'Strong', 'Dark', 'Bright', 'Deep'
        ];
        
        const nouns = [
            'Fleet', 'Armada', 'Squadron', 'Battle', 'Victory', 'Conquest', 'Strike',
            'Assault', 'Defense', 'Fortress', 'Bastion', 'Citadel', 'Harbor', 'Bay',
            'Ocean', 'Seas', 'Waters', 'Tide', 'Wave', 'Storm', 'Tempest', 'Voyage',
            'Quest', 'Mission', 'Campaign', 'Operation', 'Maneuver', 'Tactics', 'Strategy', 'War'
        ];
        
        const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
        const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
        
        return `${randomAdjective}-${randomNoun}`;
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(screenId).classList.add('active');
        this.currentScreen = screenId;
    }

    updateSessionsList(sessions) {
        const sessionsList = document.getElementById('sessionsList');
        sessionsList.innerHTML = '';

        if (sessions.length === 0) {
            sessionsList.innerHTML = '<p>No active sessions</p>';
            return;
        }

        sessions.forEach(session => {
            const sessionItem = document.createElement('div');
            sessionItem.className = 'session-item';
            sessionItem.innerHTML = `
                <div class="session-info">
                    <h3>${session.name || `Game ${session.id.substring(0, 8)}`}</h3>
                    <p>Players: ${session.playerCount}/2</p>
                    <p>Status: ${session.gameState}</p>
                    ${session.hasPassword ? '<p>🔒 Password Protected</p>' : ''}
                </div>
            `;
            
            sessionItem.addEventListener('click', () => {
                this.pendingSessionId = session.id;
                this.showModal('joinGameModal');
                // Pre-fill password if not required
                if (!session.hasPassword) {
                    document.getElementById('joinPassword').style.display = 'none';
                    const joinPasswordLabel = document.querySelector('label[for="joinPassword"]');
                    if (joinPasswordLabel) joinPasswordLabel.style.display = 'none';
                } else {
                    document.getElementById('joinPassword').style.display = 'block';
                    const joinPasswordLabel = document.querySelector('label[for="joinPassword"]');
                    if (joinPasswordLabel) joinPasswordLabel.style.display = 'block';
                }
            });

            sessionsList.appendChild(sessionItem);
        });
    }

    createGame() {
        const sessionName = document.getElementById('sessionName').value.trim();
        const playerName = document.getElementById('creatorName').value.trim();
        const password = document.getElementById('gamePassword').value;
        
        if (!sessionName) {
            alert('Please enter a game name');
            return;
        }
        
        if (!playerName) {
            alert('Please enter your name');
            return;
        }
        
        this.socket.emit('createSession', {
            sessionName: sessionName,
            playerName: playerName,
            password: password || null
        });
    }

    joinGame() {
        const password = document.getElementById('joinPassword').value || null;
        const joinPlayerNameEl = document.getElementById('joinPlayerName');
        const playerName = joinPlayerNameEl ? joinPlayerNameEl.value : null;
        this.joinSessionById(this.pendingSessionId, password, playerName);
    }

    joinSessionById(sessionId, password = null, playerName = null) {
        this.socket.emit('joinSession', { sessionId, password, playerName });
    }

    leaveGame() {
        this.clearMoveTimer();
        this.socket.disconnect();
        this.socket.connect();
        this.showScreen('mainMenu');
        this.resetGame();
    }

    resetGame() {
        this.sessionId = null;
        this.playerId = null;
        this.playerNumber = null;
        this.selectedShip = null;
        this.placedShips = [];
        this.playerGrid = Array(10).fill().map(() => Array(10).fill(0));
        this.enemyGrid = Array(10).fill().map(() => Array(10).fill(0));
        this.currentTurn = null;
        this.hitCount = 0;
        this.missCount = 0;
        this.clearMoveTimer();
    }

    initializeShipPlacement() {
        const grid = document.getElementById('placementGrid');
        grid.innerHTML = '';

        // Create grid cells
        for (let row = 0; row < 10; row++) {
            for (let col = 0; col < 10; col++) {
                const cell = document.createElement('div');
                cell.className = 'grid-cell';
                cell.dataset.row = row;
                cell.dataset.col = col;
                
                cell.addEventListener('click', () => this.placeShip(row, col));
                cell.addEventListener('mouseenter', () => this.previewShipPlacement(row, col));
                cell.addEventListener('mouseleave', () => this.clearPreview());
                
                grid.appendChild(cell);
            }
        }

        // Initialize ship selection
        document.querySelectorAll('.ship-item').forEach(item => {
            item.addEventListener('click', () => {
                if (!item.classList.contains('placed')) {
                    document.querySelectorAll('.ship-item').forEach(i => i.classList.remove('selected'));
                    item.classList.add('selected');
                    this.selectedShip = {
                        size: parseInt(item.dataset.size),
                        name: item.dataset.name,
                        element: item
                    };
                }
            });
        });

        // Select first ship by default
        document.querySelector('.ship-item').click();
    }

    previewShipPlacement(row, col) {
        this.clearPreview();
        
        if (!this.selectedShip) return;

        const positions = this.getShipPositions(row, col, this.selectedShip.size, this.shipOrientation);
        const valid = this.isValidPlacement(positions);

        positions.forEach(pos => {
            const cell = document.querySelector(`[data-row="${pos.row}"][data-col="${pos.col}"]`);
            if (cell) {
                cell.classList.add(valid ? 'preview' : 'invalid');
            }
        });
    }

    clearPreview() {
        document.querySelectorAll('.grid-cell').forEach(cell => {
            cell.classList.remove('preview', 'invalid');
        });
    }

    getShipPositions(startRow, startCol, size, orientation) {
        const positions = [];
        for (let i = 0; i < size; i++) {
            const row = orientation === 'horizontal' ? startRow : startRow + i;
            const col = orientation === 'horizontal' ? startCol + i : startCol;
            positions.push({ row, col });
        }
        return positions;
    }

    isValidPlacement(positions) {
        return positions.every(pos => {
            // Check bounds
            if (pos.row < 0 || pos.row >= 10 || pos.col < 0 || pos.col >= 10) {
                return false;
            }
            // Check if cell is already occupied
            return this.playerGrid[pos.row][pos.col] === 0;
        });
    }

    placeShip(row, col) {
        if (!this.selectedShip) return;

        const positions = this.getShipPositions(row, col, this.selectedShip.size, this.shipOrientation);
        
        if (!this.isValidPlacement(positions)) return;

        // Place ship on grid
        positions.forEach(pos => {
            this.playerGrid[pos.row][pos.col] = 1;
            const cell = document.querySelector(`[data-row="${pos.row}"][data-col="${pos.col}"]`);
            cell.classList.add('ship');
        });

        // Add to placed ships
        this.placedShips.push({
            name: this.selectedShip.name,
            size: this.selectedShip.size,
            positions: positions
        });

        // Mark ship as placed
        this.selectedShip.element.classList.add('placed');
        this.selectedShip.element.classList.remove('selected');

        // Select next available ship
        const nextShip = document.querySelector('.ship-item:not(.placed)');
        if (nextShip) {
            nextShip.click();
        } else {
            this.selectedShip = null;
            document.getElementById('confirmPlacementBtn').disabled = false;
        }

        this.clearPreview();
    }

    randomShipPlacement() {
        // Clear current placement
        this.clearShipPlacement();

        const ships = [5, 4, 3, 3, 2];
        const shipNames = ['Carrier', 'Battleship', 'Cruiser', 'Submarine', 'Destroyer'];

        ships.forEach((size, index) => {
            let placed = false;
            let attempts = 0;
            
            while (!placed && attempts < 100) {
                const row = Math.floor(Math.random() * 10);
                const col = Math.floor(Math.random() * 10);
                const orientation = Math.random() < 0.5 ? 'horizontal' : 'vertical';
                
                const positions = this.getShipPositions(row, col, size, orientation);
                
                if (this.isValidPlacement(positions)) {
                    positions.forEach(pos => {
                        this.playerGrid[pos.row][pos.col] = 1;
                        const cell = document.querySelector(`[data-row="${pos.row}"][data-col="${pos.col}"]`);
                        cell.classList.add('ship');
                    });

                    this.placedShips.push({
                        name: shipNames[index],
                        size: size,
                        positions: positions
                    });

                    placed = true;
                }
                attempts++;
            }
        });

        // Mark all ships as placed
        document.querySelectorAll('.ship-item').forEach(item => {
            item.classList.add('placed');
            item.classList.remove('selected');
        });

        this.selectedShip = null;
        document.getElementById('confirmPlacementBtn').disabled = false;
    }

    clearShipPlacement() {
        this.playerGrid = Array(10).fill().map(() => Array(10).fill(0));
        this.placedShips = [];
        
        document.querySelectorAll('.grid-cell').forEach(cell => {
            cell.classList.remove('ship', 'placed', 'preview', 'invalid');
        });

        document.querySelectorAll('.ship-item').forEach(item => {
            item.classList.remove('placed', 'selected');
        });

        document.getElementById('confirmPlacementBtn').disabled = true;
    }

    confirmShipPlacement() {
        if (this.placedShips.length !== 5) return;

        this.socket.emit('placeShips', {
            sessionId: this.sessionId,
            playerId: this.playerId,
            ships: this.placedShips
        });
    }

    initializeGameBoard() {
        // Initialize player grid
        const playerGrid = document.getElementById('playerGrid');
        playerGrid.innerHTML = '';
        
        for (let row = 0; row < 10; row++) {
            for (let col = 0; col < 10; col++) {
                const cell = document.createElement('div');
                cell.className = 'grid-cell';
                if (this.playerGrid[row][col] === 1) {
                    cell.classList.add('ship');
                }
                playerGrid.appendChild(cell);
            }
        }

        // Initialize enemy grid
        const enemyGrid = document.getElementById('enemyGrid');
        enemyGrid.innerHTML = '';
        
        for (let row = 0; row < 10; row++) {
            for (let col = 0; col < 10; col++) {
                const cell = document.createElement('div');
                cell.className = 'grid-cell';
                cell.dataset.row = row;
                cell.dataset.col = col;
                
                cell.addEventListener('click', () => this.makeMove(row, col));
                
                enemyGrid.appendChild(cell);
            }
        }
    }

    updateTurnIndicator() {
        const turnIndicator = document.getElementById('turnIndicator');
        if (this.currentTurn === this.playerId) {
            turnIndicator.textContent = 'Your Turn - Fire!';
            turnIndicator.style.color = '#4CAF50';
        } else {
            turnIndicator.textContent = "Opponent's Turn";
            turnIndicator.style.color = '#ff6b6b';
        }
    }

    updatePlayerNames() {
        const playerNameEl = document.getElementById('playerName');
        const opponentNameEl = document.getElementById('opponentName');
        
        // Find my name and opponent's name
        const myName = this.playerNames.get(this.playerId) || 'You';
        let opponentName = 'Opponent';
        
        for (const [id, name] of this.playerNames) {
            if (id !== this.playerId) {
                opponentName = name;
                break;
            }
        }
        
        playerNameEl.textContent = myName;
        opponentNameEl.textContent = opponentName;
    }

    async showArchive() {
        try {
            const response = await fetch('/api/archive');
            const archive = await response.json();
            
            const archiveList = document.getElementById('archiveList');
            
            if (archive.length === 0) {
                archiveList.innerHTML = '<p>No archived games found.</p>';
            } else {
                archiveList.innerHTML = archive.map(game => {
                    const status = game.isFinished ? '✅ Completed' : '❌ Unfinished';
                    const winner = game.isFinished ? `Winner: ${game.winnerName || 'Unknown'}` : 'Game abandoned';
                    const duration = Math.floor(game.duration / 60);
                    
                    return `
                        <div class="archive-item">
                            <div class="archive-header">
                                <strong>Game ${game.sessionId.substring(0, 8)}</strong>
                                <span class="archive-status">${status}</span>
                            </div>
                            <div class="archive-details">
                                <p><strong>Players:</strong> ${game.players.map(p => p.name).join(' vs ')}</p>
                                <p><strong>Duration:</strong> ${duration}m ${game.duration % 60}s</p>
                                <p><strong>Result:</strong> ${winner}</p>
                                <p><strong>Date:</strong> ${new Date(game.createdAt).toLocaleDateString()}</p>
                                ${game.isFinished ? `
                                    <p><strong>Stats:</strong> 
                                        ${game.stats.player1.name}: ${game.stats.player1.hits}H/${game.stats.player1.misses}M (${game.stats.player1.accuracy}%) | 
                                        ${game.stats.player2.name}: ${game.stats.player2.hits}H/${game.stats.player2.misses}M (${game.stats.player2.accuracy}%)
                                    </p>
                                ` : ''}
                            </div>
                        </div>
                    `;
                }).join('');
            }
            
            this.showModal('archiveModal');
        } catch (error) {
            console.error('Error loading archive:', error);
            document.getElementById('archiveList').innerHTML = '<p>Error loading archive.</p>';
            this.showModal('archiveModal');
        }
    }

    pauseGame() {
        if (!this.isHost) return;
        
        this.socket.emit('pauseGame', {
            sessionId: this.sessionId,
            playerId: this.playerId
        });
    }

    resumeGame() {
        if (!this.isHost) return;
        
        this.socket.emit('resumeGame', {
            sessionId: this.sessionId,
            playerId: this.playerId
        });
    }

    makeMove(row, col) {
        if (this.currentTurn !== this.playerId || this.isPaused) return;
        
        // Check if already fired at this position
        const enemyGridCells = document.getElementById('enemyGrid').children;
        const cellIndex = row * 10 + col;
        const cell = enemyGridCells[cellIndex];
        
        if (cell.classList.contains('hit') || cell.classList.contains('miss')) {
            return;
        }

        this.socket.emit('makeMove', {
            sessionId: this.sessionId,
            playerId: this.playerId,
            row: row,
            col: col
        });
    }

    handleMoveResult(data) {
        const { playerId, row, col, hit, sunkShip, currentTurn, gameOver, winner, timeRemaining } = data;
        
        if (playerId === this.playerId) {
            // Our move
            const enemyGridCells = document.getElementById('enemyGrid').children;
            const cellIndex = row * 10 + col;
            const cell = enemyGridCells[cellIndex];
            
            if (hit) {
                cell.classList.add('hit');
                cell.textContent = '💥';
                this.hitCount++;
            } else {
                cell.classList.add('miss');
                cell.textContent = '💦';
                this.missCount++;
            }
            
            if (sunkShip) {
                // Mark all positions of sunk ship
                sunkShip.positions.forEach(pos => {
                    const sunkCellIndex = pos.row * 10 + pos.col;
                    const sunkCell = enemyGridCells[sunkCellIndex];
                    sunkCell.classList.add('sunk');
                    sunkCell.textContent = '💀';
                });
            }
        } else {
            // Enemy move on our grid
            const playerGridCells = document.getElementById('playerGrid').children;
            const cellIndex = row * 10 + col;
            const cell = playerGridCells[cellIndex];
            
            if (hit) {
                cell.classList.add('hit');
                cell.textContent = '💥';
            } else {
                cell.classList.add('miss');
                cell.textContent = '💦';
            }
        }

        // Update stats
        document.getElementById('hitCount').textContent = this.hitCount;
        document.getElementById('missCount').textContent = this.missCount;

        // Update turn
        this.currentTurn = currentTurn;
        this.updateTurnIndicator();
        
        // Start timer for new turn
        if (!gameOver) {
            this.startMoveTimer(timeRemaining);
            
            // Play sound if it's now player's turn
            if (this.currentTurn === this.playerId) {
                this.playTurnSound();
            }
        }

        // Check game over
        if (gameOver) {
            this.clearMoveTimer();
            const resultText = winner === this.playerId ? 'You Win! 🎉' : 'You Lose! 😞';
            document.getElementById('gameResult').textContent = resultText;
            this.showScreen('gameOver');
        }
    }
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
    new BattleshipGame();
});
