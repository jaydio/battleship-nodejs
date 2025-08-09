const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// In-memory storage for game sessions
const gameSessions = new Map();
const MOVE_TIME_LIMIT = 30000; // 30 seconds in milliseconds
const ARCHIVE_FILE = 'game_archive.json';
const PORT = process.env.PORT || 3000;

class GameSession {
    constructor(id, creatorId, password = null, sessionName = null) {
        this.id = id;
        this.sessionName = sessionName || `Game ${id.substring(0, 8)}`;
        this.password = password;
        this.players = new Map();
        this.gameState = 'waiting'; // waiting, placing, playing, paused, finished
        this.currentTurn = null;
        this.winner = null;
        this.createdAt = new Date();
        this.finishedAt = null;
        this.moveTimer = null;
        this.moveStartTime = null;
        this.playerNames = new Map(); // Store player names
        this.hostId = creatorId; // Track who created the game
        this.isPaused = false;
        this.pausedTimeRemaining = null;
        this.gameStats = {
            totalMoves: 0,
            player1Hits: 0,
            player1Misses: 0,
            player2Hits: 0,
            player2Misses: 0
        };
    }

    addPlayer(playerId, socketId, playerName = null) {
        if (this.players.size >= 2) return false;
        
        const playerNumber = this.players.size + 1;
        this.players.set(playerId, {
            id: playerId,
            socketId: socketId,
            playerNumber: playerNumber,
            ships: [],
            grid: Array(10).fill().map(() => Array(10).fill(0)), // 0: empty, 1: ship, 2: hit, 3: miss
            ready: false
        });
        
        // Store player name
        this.playerNames.set(playerId, playerName || `Player ${playerNumber}`);
        
        if (this.players.size === 2) {
            this.gameState = 'placing';
        }
        
        return true;
    }

    removePlayer(playerId) {
        this.players.delete(playerId);
        this.playerNames.delete(playerId);
        if (this.players.size === 0) {
            this.clearMoveTimer();
            return true; // Session should be deleted
        }
        return false;
    }

    getPlayerBySocketId(socketId) {
        for (let player of this.players.values()) {
            if (player.socketId === socketId) {
                return player;
            }
        }
        return null;
    }

    getOpponent(playerId) {
        for (let player of this.players.values()) {
            if (player.id !== playerId) {
                return player;
            }
        }
        return null;
    }

    placeShips(playerId, ships) {
        const player = this.players.get(playerId);
        if (!player) return false;

        // Validate ship placement
        if (!this.validateShipPlacement(ships)) return false;

        player.ships = ships;
        player.ready = true;

        // Update grid with ships
        ships.forEach(ship => {
            ship.positions.forEach(pos => {
                player.grid[pos.row][pos.col] = 1;
            });
        });

        // Check if both players are ready
        const allReady = Array.from(this.players.values()).every(p => p.ready);
        if (allReady && this.players.size === 2) {
            this.gameState = 'playing';
            this.currentTurn = Array.from(this.players.keys())[0]; // First player starts
            this.startMoveTimer();
        }

        return true;
    }

    validateShipPlacement(ships) {
        // Basic validation - should have 5 ships of correct sizes
        const expectedSizes = [5, 4, 3, 3, 2];
        if (ships.length !== expectedSizes.length) return false;

        const actualSizes = ships.map(ship => ship.positions.length).sort((a, b) => b - a);
        return JSON.stringify(actualSizes) === JSON.stringify(expectedSizes);
    }

    startMoveTimer() {
        this.clearMoveTimer();
        this.moveStartTime = Date.now();
        
        this.moveTimer = setTimeout(() => {
            this.handleMoveTimeout();
        }, MOVE_TIME_LIMIT);
    }

    clearMoveTimer() {
        if (this.moveTimer) {
            clearTimeout(this.moveTimer);
            this.moveTimer = null;
        }
    }

    handleMoveTimeout() {
        if (this.gameState !== 'playing') return;
        
        // Switch to opponent's turn
        const opponent = this.getOpponent(this.currentTurn);
        if (opponent) {
            this.currentTurn = opponent.id;
            this.startMoveTimer();
            
            // Notify all players about the timeout
            io.to(this.id).emit('moveTimeout', {
                currentTurn: this.currentTurn,
                timeRemaining: MOVE_TIME_LIMIT
            });
        }
    }

    pauseGame(playerId) {
        if (playerId !== this.hostId || this.gameState !== 'playing') {
            return { success: false, reason: 'Only host can pause during gameplay' };
        }
        
        this.isPaused = true;
        this.gameState = 'paused';
        
        // Store remaining time and clear timer
        if (this.moveTimer) {
            const elapsed = Date.now() - this.moveStartTime;
            this.pausedTimeRemaining = Math.max(0, MOVE_TIME_LIMIT - elapsed);
            this.clearMoveTimer();
        }
        
        return { success: true };
    }

    resumeGame(playerId) {
        if (playerId !== this.hostId || this.gameState !== 'paused') {
            return { success: false, reason: 'Only host can resume paused games' };
        }
        
        this.isPaused = false;
        this.gameState = 'playing';
        
        // Restart timer with remaining time
        if (this.pausedTimeRemaining !== null) {
            this.moveStartTime = Date.now();
            this.moveTimer = setTimeout(() => {
                this.handleMoveTimeout();
            }, this.pausedTimeRemaining);
        } else {
            this.startMoveTimer();
        }
        
        return { success: true, timeRemaining: this.pausedTimeRemaining || MOVE_TIME_LIMIT };
    }

    makeMove(playerId, row, col) {
        if (this.gameState !== 'playing' || this.currentTurn !== playerId) {
            return { valid: false, reason: 'Not your turn' };
        }

        const opponent = this.getOpponent(playerId);
        if (!opponent) return { valid: false, reason: 'No opponent' };

        // Check if already fired at this position
        if (opponent.grid[row][col] === 2 || opponent.grid[row][col] === 3) {
            return { valid: false, reason: 'Already fired at this position' };
        }

        const hit = opponent.grid[row][col] === 1;
        opponent.grid[row][col] = hit ? 2 : 3; // 2: hit, 3: miss

        // Update game stats
        this.gameStats.totalMoves++;
        const playerNumber = this.players.get(playerId).playerNumber;
        if (hit) {
            if (playerNumber === 1) this.gameStats.player1Hits++;
            else this.gameStats.player2Hits++;
        } else {
            if (playerNumber === 1) this.gameStats.player1Misses++;
            else this.gameStats.player2Misses++;
        }

        // Check for sunk ship
        let sunkShip = null;
        if (hit) {
            sunkShip = this.checkSunkShip(opponent, row, col);
        }

        // Check for win condition
        const allShipsSunk = opponent.ships.every(ship => 
            ship.positions.every(pos => opponent.grid[pos.row][pos.col] === 2)
        );

        if (allShipsSunk) {
            this.gameState = 'finished';
            this.winner = playerId;
            this.finishedAt = new Date();
            this.clearMoveTimer();
            this.archiveGame();
        } else {
            // Switch turns only if it was a miss
            if (!hit) {
                this.currentTurn = opponent.id;
            }
            this.startMoveTimer();
        }

        return {
            valid: true,
            hit: hit,
            sunkShip: sunkShip,
            gameOver: allShipsSunk,
            winner: this.winner,
            timeRemaining: MOVE_TIME_LIMIT
        };
    }

    checkSunkShip(player, hitRow, hitCol) {
        // Find which ship was hit and check if it's completely sunk
        for (let ship of player.ships) {
            const hitPosition = ship.positions.find(pos => pos.row === hitRow && pos.col === hitCol);
            if (hitPosition) {
                const allHit = ship.positions.every(pos => player.grid[pos.row][pos.col] === 2);
                if (allHit) {
                    return ship;
                }
                break;
            }
        }
        return null;
    }

    async archiveGame(isFinished = true) {
        const gameResult = {
            sessionId: this.id,
            players: Array.from(this.playerNames.entries()).map(([id, name]) => ({ id, name })),
            winner: this.winner,
            winnerName: this.playerNames.get(this.winner),
            duration: this.finishedAt ? Math.round((this.finishedAt - this.createdAt) / 1000) : Math.round((new Date() - this.createdAt) / 1000),
            createdAt: this.createdAt.toISOString(),
            finishedAt: this.finishedAt ? this.finishedAt.toISOString() : new Date().toISOString(),
            gameState: this.gameState,
            isFinished: isFinished,
            stats: {
                totalMoves: this.gameStats.totalMoves,
                player1: {
                    name: this.playerNames.get(Array.from(this.players.keys())[0]),
                    hits: this.gameStats.player1Hits,
                    misses: this.gameStats.player1Misses,
                    accuracy: this.gameStats.player1Hits + this.gameStats.player1Misses > 0 ? 
                        Math.round((this.gameStats.player1Hits / (this.gameStats.player1Hits + this.gameStats.player1Misses)) * 100) : 0
                },
                player2: {
                    name: this.playerNames.get(Array.from(this.players.keys())[1]),
                    hits: this.gameStats.player2Hits,
                    misses: this.gameStats.player2Misses,
                    accuracy: this.gameStats.player2Hits + this.gameStats.player2Misses > 0 ? 
                        Math.round((this.gameStats.player2Hits / (this.gameStats.player2Hits + this.gameStats.player2Misses)) * 100) : 0
                }
            }
        };

        try {
            let archive = [];
            try {
                const data = await fs.readFile(ARCHIVE_FILE, 'utf8');
                archive = JSON.parse(data);
            } catch (err) {
                // File doesn't exist or is empty, start with empty array
            }

            archive.push(gameResult);
            await fs.writeFile(ARCHIVE_FILE, JSON.stringify(archive, null, 2));
            console.log(`Game ${this.id} archived successfully`);
        } catch (error) {
            console.error('Error archiving game:', error);
        }
    }
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Send list of active sessions (exclude finished sessions)
    const activeSessions = Array.from(gameSessions.values())
        .filter(session => session.gameState !== 'finished')
        .map(session => ({
            id: session.id,
            playerCount: session.players.size,
            hasPassword: !!session.password,
            gameState: session.gameState,
            createdAt: session.createdAt
        }));
    
    socket.emit('sessionList', activeSessions);

    // Create new game session
    socket.on('createSession', (data) => {
        const sessionId = crypto.randomUUID();
        const playerId = socket.id;
        const session = new GameSession(sessionId, playerId, data.password, data.sessionName);
        
        // Add player name if provided
        if (data.playerName) {
            session.playerNames.set(playerId, data.playerName);
        }
        
        session.addPlayer(playerId, socket.id);
        gameSessions.set(sessionId, session);
        socket.join(sessionId);
        
        // Generate invite link
        const inviteLink = data.password ? 
            `http://localhost:3000?session=${sessionId}&password=${encodeURIComponent(data.password)}` :
            `http://localhost:3000?session=${sessionId}`;
        
        socket.emit('sessionCreated', {
            sessionId: sessionId,
            playerId: playerId,
            isHost: true,
            inviteLink: inviteLink
        });
        
        // Broadcast updated session list
        const activeSessions = Array.from(gameSessions.values())
            .filter(session => session.gameState !== 'finished')
            .map(session => ({
                id: session.id,
                name: session.sessionName,
                playerCount: session.players.size,
                hasPassword: !!session.password,
                gameState: session.gameState,
                createdAt: session.createdAt
            }));
        
        io.emit('sessionList', activeSessions);
    });

    // Join existing session
    socket.on('joinSession', (data) => {
        const session = gameSessions.get(data.sessionId);
        if (!session) {
            socket.emit('error', 'Session not found');
            return;
        }

        if (session.gameState === 'finished') {
            socket.emit('error', 'This session has already finished');
            return;
        }

        if (session.password && session.password !== data.password) {
            socket.emit('error', 'Incorrect password');
            return;
        }

        const playerId = crypto.randomUUID();
        const success = session.addPlayer(playerId, socket.id, data.playerName);

        if (!success) {
            socket.emit('error', 'Session is full');
            return;
        }

        socket.join(data.sessionId);
        socket.emit('sessionJoined', {
            sessionId: data.sessionId,
            playerId: playerId,
            playerNumber: session.players.get(playerId).playerNumber,
            isHost: playerId === session.hostId
        });

        // Notify all players in the session
        io.to(data.sessionId).emit('playerJoined', {
            playerCount: session.players.size,
            gameState: session.gameState
        });

        // Broadcast updated session list (exclude finished sessions)
        const activeSessions = Array.from(gameSessions.values())
            .filter(session => session.gameState !== 'finished')
            .map(session => ({
                id: session.id,
                playerCount: session.players.size,
                hasPassword: !!session.password,
                gameState: session.gameState,
                createdAt: session.createdAt
            }));
        
        io.emit('sessionList', activeSessions);
    });

    // Place ships
    socket.on('placeShips', (data) => {
        const session = gameSessions.get(data.sessionId);
        if (!session) return;

        const success = session.placeShips(data.playerId, data.ships);
        if (success) {
            socket.emit('shipsPlaced');
            
            if (session.gameState === 'playing') {
                io.to(data.sessionId).emit('gameStarted', {
                    currentTurn: session.currentTurn,
                    hostId: session.hostId,
                    playerNames: Array.from(session.playerNames.entries()),
                    timeRemaining: MOVE_TIME_LIMIT
                });
            }
        } else {
            socket.emit('error', 'Invalid ship placement');
        }
    });

    // Make move
    socket.on('makeMove', (data) => {
        const session = gameSessions.get(data.sessionId);
        if (!session) return;

        const result = session.makeMove(data.playerId, data.row, data.col);
        
        if (result.valid) {
            // Send result to all players
            io.to(data.sessionId).emit('moveResult', {
                playerId: data.playerId,
                row: data.row,
                col: data.col,
                hit: result.hit,
                sunkShip: result.sunkShip,
                currentTurn: session.currentTurn,
                gameOver: result.gameOver,
                winner: result.winner,
                timeRemaining: result.timeRemaining
            });

            // Remove finished sessions from active list after a delay
            if (result.gameOver) {
                setTimeout(() => {
                    const activeSessions = Array.from(gameSessions.values())
                        .filter(session => session.gameState !== 'finished')
                        .map(session => ({
                            id: session.id,
                            playerCount: session.players.size,
                            hasPassword: !!session.password,
                            gameState: session.gameState,
                            createdAt: session.createdAt
                        }));
                    
                    io.emit('sessionList', activeSessions);
                }, 5000); // Wait 5 seconds before updating session list
            }
        } else {
            socket.emit('error', result.reason);
        }
    });

    // Pause game (host only)
    socket.on('pauseGame', (data) => {
        const session = gameSessions.get(data.sessionId);
        if (!session) return;

        const result = session.pauseGame(data.playerId);
        if (result.success) {
            io.to(data.sessionId).emit('gamePaused', {
                pausedBy: session.playerNames.get(data.playerId)
            });
        } else {
            socket.emit('error', result.reason);
        }
    });

    // Resume game (host only)
    socket.on('resumeGame', (data) => {
        const session = gameSessions.get(data.sessionId);
        if (!session) return;

        const result = session.resumeGame(data.playerId);
        if (result.success) {
            io.to(data.sessionId).emit('gameResumed', {
                currentTurn: session.currentTurn,
                timeRemaining: result.timeRemaining
            });
        } else {
            socket.emit('error', result.reason);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Find and remove player from any session
        for (const [sessionId, session] of gameSessions) {
            if (session.players.has(socket.id)) {
                session.players.delete(socket.id);
                
                if (session.players.size === 0) {
                    // No players left, archive unfinished game if it was in progress
                    if (session.gameState === 'playing' || session.gameState === 'placing') {
                        session.archiveGame(false); // Archive as unfinished
                    }
                    gameSessions.delete(sessionId);
                } else {
                    // Notify remaining players
                    socket.to(sessionId).emit('playerLeft', {
                        playerId: socket.id,
                        remainingPlayers: session.players.size
                    });
                }
                break;
            }
        }
    });
});

// Add archive endpoint
app.get('/api/archive', async (req, res) => {
    try {
        const data = await fs.readFile(ARCHIVE_FILE, 'utf8');
        const archive = JSON.parse(data);
        res.json(archive);
    } catch (err) {
        res.json([]);
    }
});

// Start server
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Clean up old finished sessions periodically (every 30 minutes)
setInterval(() => {
    const now = Date.now();
    const CLEANUP_THRESHOLD = 30 * 60 * 1000; // 30 minutes

    for (let [sessionId, session] of gameSessions.entries()) {
        if (session.gameState === 'finished' && 
            session.finishedAt && 
            (now - session.finishedAt.getTime()) > CLEANUP_THRESHOLD) {
            gameSessions.delete(sessionId);
            console.log(`Cleaned up finished session: ${sessionId}`);
        }
    }
}, 30 * 60 * 1000); // Run every 30 minutes
