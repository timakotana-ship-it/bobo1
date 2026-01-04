const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const crypto = require('crypto');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;
const CRYPTO_PAY_TOKEN = '507893:AA0aFxEJlwTQrHRv6S3Tg9cJAn7LH6xmgLC';
const XROCKET_API_KEY = '9b2386ba504894c629f69c120';

// Хранилища данных
let x50Rounds = new Map();
let x50Bets = new Map();
let crashGames = new Map();
let crashBets = new Map();
let users = new Map();
let pendingInvoices = new Map();

// Статические файлы
app.use(express.static(__dirname));
app.use(express.json());

// Crypto Pay API запросы
async function cryptoPayRequest(method, data = {}) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(data);
        
        const options = {
            hostname: 'pay.crypt.bot',
            port: 443,
            path: `/api/${method}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Crypto-Pay-API-Token': CRYPTO_PAY_TOKEN,
                'Content-Length': postData.length
            }
        };
        
        const req = https.request(options, (res) => {
            let body = '';
            
            res.on('data', (chunk) => {
                body += chunk;
            });
            
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    resolve({ ok: false, error: 'Parse error' });
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.write(postData);
        req.end();
    });
}

// xRocket API запросы
async function xrocketRequest(endpoint, data = {}) {
    try {
        const response = await fetch(`https://pay.xrocket.tg/api/${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${XROCKET_API_KEY}`
            },
            body: JSON.stringify(data)
        });
        
        return await response.json();
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Создание инвойса через Crypto Bot
async function createCryptoBotInvoice(userId, amount, asset = 'USDT') {
    try {
        const result = await cryptoPayRequest('createInvoice', {
            asset: asset,
            amount: amount.toString(),
            description: `Deposit for user ${userId} in Stash Casino`,
            hidden_message: 'Thank you for your deposit! Balance will be credited automatically.',
            expires_in: 3600,
            paid_btn_name: 'view_item',
            paid_btn_url: 'https://t.me/StashCasinoBot'
        });
        
        if (result.ok && result.result) {
            pendingInvoices.set(result.result.invoice_id, {
                userId: userId,
                amount: amount,
                asset: asset,
                method: 'cryptobot',
                status: 'pending',
                created_at: Date.now()
            });
            
            return result.result;
        }
        
        return null;
    } catch (error) {
        console.error('CryptoBot invoice error:', error);
        return null;
    }
}

// Создание инвойса через xRocket
async function createXRocketInvoice(userId, amount, currency = 'USDT') {
    try {
        const result = await xrocketRequest('createInvoice', {
            userId: userId,
            amount: amount,
            currency: currency,
            description: `Deposit for user ${userId} in Stash Casino`
        });
        
        if (result.success && result.data) {
            pendingInvoices.set(result.data.invoice_id, {
                userId: userId,
                amount: amount,
                currency: currency,
                method: 'xrocket',
                status: 'pending',
                created_at: Date.now()
            });
            
            return result.data;
        }
        
        return null;
    } catch (error) {
        console.error('xRocket invoice error:', error);
        return null;
    }
}

// API для создания инвойса
app.post('/api/create-invoice', express.json(), async (req, res) => {
    try {
        const { userId, amount, method = 'cryptobot', currency = 'USDT' } = req.body;
        
        if (!userId || !amount) {
            return res.status(400).json({ success: false, error: 'Missing parameters' });
        }
        
        let invoice;
        
        if (method === 'cryptobot') {
            invoice = await createCryptoBotInvoice(userId, amount, currency);
        } else if (method === 'xrocket') {
            invoice = await createXRocketInvoice(userId, amount, currency);
        } else {
            return res.status(400).json({ success: false, error: 'Invalid payment method' });
        }
        
        if (invoice) {
            res.json({ success: true, data: invoice });
        } else {
            res.status(500).json({ success: false, error: 'Failed to create invoice' });
        }
        
    } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Webhook для платежей
app.post('/webhook/payment', express.json(), (req, res) => {
    try {
        const { invoice_id, status, method } = req.body;
        
        const pending = pendingInvoices.get(invoice_id);
        if (pending && pending.status === 'pending' && status === 'paid') {
            pending.status = 'paid';
            pending.paid_at = Date.now();
            
            // Начисляем средства пользователю
            const userKey = `user_${pending.userId}`;
            const userData = localStorage.getItem(userKey);
            if (userData) {
                const user = JSON.parse(userData);
                user.balance += pending.amount;
                localStorage.setItem(userKey, JSON.stringify(user));
                
                // Уведомляем через WebSocket
                io.to(`user_${pending.userId}`).emit('deposit_completed', {
                    invoice_id: invoice_id,
                    amount: pending.amount,
                    method: pending.method,
                    timestamp: Date.now()
                });
            }
        }
        
        res.status(200).send('OK');
    } catch (error) {
        res.status(500).send('Error');
    }
});

// Socket.io логика
io.on('connection', (socket) => {
    
    socket.on('authenticate', (data) => {
        const { userId } = data;
        if (userId) {
            socket.join(`user_${userId}`);
            users.set(socket.id, userId);
        }
    });
    
    // X50 логика
    socket.on('x50_get_current_round', () => {
        const currentRound = Array.from(x50Rounds.values())
            .find(round => round.status === 'betting' && round.timeLeft > 0);
        
        if (currentRound) {
            socket.emit('x50_new_round', currentRound);
            
            const roundBets = x50Bets.get(currentRound.id) || [];
            roundBets.forEach(bet => {
                socket.emit('x50_bet_placed', bet);
            });
        }
    });
    
    socket.on('x50_bet', (data) => {
        const { roundId, userId, username, amount, multiplier } = data;
        
        if (!x50Rounds.has(roundId)) {
            socket.emit('error', { message: 'Round not found' });
            return;
        }
        
        const bet = {
            id: Date.now() + Math.random(),
            userId,
            username,
            roundId,
            multiplier,
            amount,
            timestamp: Date.now()
        };
        
        const roundBets = x50Bets.get(roundId) || [];
        roundBets.push(bet);
        x50Bets.set(roundId, roundBets);
        
        io.emit('x50_bet_placed', bet);
    });
    
    // Crash логика
    socket.on('crash_get_current', () => {
        const currentGame = Array.from(crashGames.values())
            .find(game => game.status === 'waiting' || game.status === 'flying');
        
        if (currentGame) {
            socket.emit('crash_new_round', currentGame);
            
            const gameBets = crashBets.get(currentGame.id) || [];
            gameBets.forEach(bet => {
                socket.emit('crash_bet_placed', bet);
            });
        }
    });
    
    socket.on('crash_bet', (data) => {
        const { gameId, userId, username, amount, autoCashout } = data;
        
        if (!crashGames.has(gameId)) {
            socket.emit('error', { message: 'Game not found' });
            return;
        }
        
        const bet = {
            id: Date.now() + Math.random(),
            userId,
            username,
            gameId,
            amount,
            autoCashout,
            status: 'active',
            timestamp: Date.now()
        };
        
        const gameBets = crashBets.get(gameId) || [];
        gameBets.push(bet);
        crashBets.set(gameId, gameBets);
        
        io.emit('crash_bet_placed', bet);
    });
    
    socket.on('crash_cashout', (data) => {
        const { gameId, userId, multiplier } = data;
        
        const gameBets = crashBets.get(gameId) || [];
        const betIndex = gameBets.findIndex(bet => bet.userId === userId && bet.status === 'active');
        
        if (betIndex !== -1) {
            const bet = gameBets[betIndex];
            const winAmount = bet.amount * multiplier;
            
            gameBets[betIndex].status = 'cashed_out';
            gameBets[betIndex].cashoutAt = multiplier;
            gameBets[betIndex].winAmount = winAmount;
            
            io.to(`user_${userId}`).emit('crash_cashout', {
                betId: bet.id,
                multiplier: multiplier,
                winAmount: winAmount,
                profit: winAmount - bet.amount
            });
            
            io.emit('crash_player_cashed_out', {
                username: bet.username,
                multiplier: multiplier.toFixed(2)
            });
        }
    });
    
    socket.on('disconnect', () => {
        users.delete(socket.id);
    });
});

// Создание нового раунда X50
function createNewX50Round() {
    const roundId = Date.now();
    const round = {
        id: roundId,
        startTime: Date.now(),
        status: 'betting',
        timeLeft: 15,
        multiplier: null,
        winner: null
    };
    
    x50Rounds.set(roundId, round);
    x50Bets.set(roundId, []);
    
    startRoundTimer(roundId);
    
    io.emit('x50_new_round', round);
}

// Таймер раунда X50
function startRoundTimer(roundId) {
    const round = x50Rounds.get(roundId);
    if (!round) return;
    
    const timer = setInterval(() => {
        round.timeLeft--;
        
        io.emit('x50_time_update', {
            roundId,
            timeLeft: round.timeLeft
        });
        
        if (round.timeLeft <= 0) {
            clearInterval(timer);
            round.status = 'calculating';
            
            setTimeout(() => {
                determineX50Winner(roundId);
            }, 1000);
        }
    }, 1000);
}

// Определение победителя X50
function determineX50Winner(roundId) {
    const round = x50Rounds.get(roundId);
    if (!round) return;
    
    const roundBets = x50Bets.get(roundId) || [];
    const random = Math.random() * 1000;
    
    let selectedMultiplier = 2;
    if (random <= 480) selectedMultiplier = 2;
    else if (random <= 800) selectedMultiplier = 3;
    else if (random <= 990) selectedMultiplier = 5;
    else selectedMultiplier = 50;
    
    round.multiplier = selectedMultiplier;
    round.status = 'completed';
    
    io.emit('x50_round_result', {
        roundId,
        multiplier: selectedMultiplier,
        winningBets: roundBets.filter(bet => bet.multiplier === selectedMultiplier)
    });
    
    // Новый раунд через 15 секунд
    setTimeout(() => {
        createNewX50Round();
    }, 15000);
}

// Создание новой игры Crash
function createNewCrashGame() {
    const gameId = Date.now();
    const game = {
        id: gameId,
        startTime: Date.now() + 5000,
        status: 'waiting',
        crashPoint: null,
        currentMultiplier: 1.00,
        timer: 5
    };
    
    crashGames.set(gameId, game);
    crashBets.set(gameId, []);
    
    startCrashCountdown(gameId);
    
    io.emit('crash_new_round', game);
}

// Отсчет до старта Crash
function startCrashCountdown(gameId) {
    const game = crashGames.get(gameId);
    if (!game) return;
    
    const timer = setInterval(() => {
        game.timer--;
        
        io.emit('crash_timer_update', {
            gameId,
            timer: game.timer
        });
        
        if (game.timer <= 0) {
            clearInterval(timer);
            startCrashFlight(gameId);
        }
    }, 1000);
}

// Полет графика Crash
function startCrashFlight(gameId) {
    const game = crashGames.get(gameId);
    if (!game) return;
    
    game.status = 'flying';
    game.crashPoint = generateCrashPoint();
    
    let currentMultiplier = 1.00;
    const startTime = Date.now();
    
    const flightInterval = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        currentMultiplier = Math.min(Math.exp(elapsed / 10), game.crashPoint);
        game.currentMultiplier = currentMultiplier;
        
        io.emit('crash_update', {
            gameId,
            multiplier: currentMultiplier,
            elapsed: elapsed
        });
        
        // Проверяем автокэшауты
        const gameBets = crashBets.get(gameId) || [];
        gameBets.forEach(bet => {
            if (bet.status === 'active' && bet.autoCashout && currentMultiplier >= bet.autoCashout) {
                processCrashCashout(gameId, bet.userId, currentMultiplier);
            }
        });
        
        if (currentMultiplier >= game.crashPoint) {
            clearInterval(flightInterval);
            finishCrashGame(gameId, game.crashPoint);
        }
    }, 50);
}

// Генерация точки краша с подкруткой
function generateCrashPoint() {
    const r = Math.random();
    let crashPoint = 1 + (1 / (1 - Math.max(0.01, r))) * 0.01;
    
    // Простая подкрутка - крашим чаще на низких множителях
    if (Math.random() < 0.6) {
        crashPoint = Math.min(crashPoint, 2 + Math.random() * 3);
    }
    
    crashPoint = Math.max(1.01, crashPoint);
    crashPoint = Math.min(crashPoint, 1000);
    
    return crashPoint;
}

// Обработка кэшаута в Crash
function processCrashCashout(gameId, userId, multiplier) {
    const gameBets = crashBets.get(gameId) || [];
    const betIndex = gameBets.findIndex(bet => bet.userId === userId && bet.status === 'active');
    
    if (betIndex !== -1) {
        const bet = gameBets[betIndex];
        const winAmount = bet.amount * multiplier;
        
        gameBets[betIndex].status = 'cashed_out';
        gameBets[betIndex].cashoutAt = multiplier;
        gameBets[betIndex].winAmount = winAmount;
        
        io.to(`user_${userId}`).emit('crash_cashout', {
            betId: bet.id,
            multiplier: multiplier,
            winAmount: winAmount,
            profit: winAmount - bet.amount
        });
    }
}

// Завершение игры Crash
function finishCrashGame(gameId, crashPoint) {
    const game = crashGames.get(gameId);
    if (!game) return;
    
    game.status = 'crashed';
    
    const gameBets = crashBets.get(gameId) || [];
    gameBets.forEach(bet => {
        if (bet.status === 'active') {
            bet.status = 'crashed';
        }
    });
    
    io.emit('crash_crashed', {
        gameId,
        crashPoint: crashPoint
    });
    
    // Новая игра через 5 секунд
    setTimeout(() => {
        createNewCrashGame();
    }, 5000);
}

// Запуск сервера
server.listen(PORT, () => {
    console.log(`✅ Stash Casino server running on port ${PORT}`);
    
    // Первый раунд X50
    setTimeout(() => {
        createNewX50Round();
    }, 2000);
    
    // Первая игра Crash
    setTimeout(() => {
        createNewCrashGame();
    }, 3000);
    
    // Очистка старых инвойсов каждые 10 минут
    setInterval(() => {
        const now = Date.now();
        for (const [invoiceId, invoice] of pendingInvoices) {
            if (invoice.status === 'pending' && now - invoice.created_at > 24 * 60 * 60 * 1000) {
                pendingInvoices.delete(invoiceId);
            }
        }
    }, 10 * 60 * 1000);
});

module.exports = { app, server, io };