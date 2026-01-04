// === КОНСТАНТЫ И НАСТРОЙКИ ===
const CRYPTO_BOT_TOKEN = '507893:AA0aFxEJlwTQrHRv6S3Tg9cJAn7LH6xmgLC';
const XROCKET_API_KEY = '9b2386ba504894c629f69c120';
const CRYPTO_BOT_API = 'https://pay.crypt.bot/api';
const XROCKET_API_URL = 'https://pay.xrocket.tg/api';

const CUBE_ODDS = {
    'even': 2,
    'odd': 2,
    'greater': 2,
    'less': 2,
    '1': 6, '2': 6, '3': 6, '4': 6, '5': 6, '6': 6
};

const MINES_BANK = { bank: 10000, minBank: -10000, maxBank: 10000 };
const MINES_GRID_SIZE = 25;
const MINES_COMMISSION = 0.96;

const X50_MULTIPLIERS = [
    { multiplier: 2, color: '#6c757d', chance: 48, min: 0, max: 480 },
    { multiplier: 3, color: '#ffc107', chance: 32, min: 481, max: 800 },
    { multiplier: 5, color: '#dc3545', chance: 19, min: 801, max: 990 },
    { multiplier: 50, color: '#28a745', chance: 0.2, min: 991, max: 1000 }
];

// Флаг для маскировки логов
const MASK_LOGS = true;

// Состояние игры в мины
let minesState = {
    isPlaying: false,
    betAmount: 0.05,
    minesCount: 2,
    currentMultiplier: 1.00,
    nextMultiplier: 1.00,
    potentialWin: 0,
    openedCells: [],
    minesPositions: [],
    steps: 0
};

// Состояние игры X50
let x50State = {
    isPlaying: false,
    betAmount: 0.05,
    selectedMultiplier: 2,
    bets: {},
    currentRound: null,
    timeLeft: 15,
    timer: null,
    isSpinning: false,
    roundStartTime: null
};

// Состояние игры Crash
let crashState = {
    isPlaying: false,
    betAmount: 0.05,
    autoCashout: null,
    currentMultiplier: 1.00,
    gameId: null,
    bets: [],
    history: [],
    gameStartTime: null,
    crashPoint: null,
    status: 'waiting', // waiting, flying, crashed
    graphPoints: [],
    socket: null
};

// Socket.io соединение
let socket = null;

// Банки для игр
const gameBanks = {
    cube: { bank: 10000, minBank: -10000, maxBank: 10000 },
    mines: { bank: 10000, minBank: -10000, maxBank: 10000 },
    x50: { bank: 10000, minBank: -10000, maxBank: 10000 },
    crash: { bank: 10000, minBank: -10000, maxBank: 10000 }
};

// Глобальные переменные
let currentUser = null;
let diceState = {
    betAmount: 0.05,
    selectedOutcome: 'even',
    diceAnimation: null,
    isRolling: false
};
let sounds = {};
let lastToastTime = 0;
let isToastShowing = false;
let searchTimeout = null;

function maskLog(text) {
  // Кодируем в UTF-8 перед base64
  return btoa(encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, 
    function(match, p1) {
      return String.fromCharCode('0x' + p1);
    }
  ));
}
function rand(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFrom(array) {
    return array[Math.floor(Math.random() * array.length)];
}

function getRandomString(length) {
    const randomChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += randomChars.charAt(Math.floor(Math.random() * randomChars.length));
    }
    return result;
}

function md5(input) {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash) + input.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

// === УВЕДОМЛЕНИЯ (улучшенные) ===
function showToast(message, type = 'info', duration = 2000) {
    const now = Date.now();
    
    if (isToastShowing && now - lastToastTime < 1000) {
        return;
    }
    
    lastToastTime = now;
    isToastShowing = true;
    
    const container = document.getElementById('toastContainer');
    
    // Удаляем старые тосты
    container.innerHTML = '';
    
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    
    let icon = '';
    let bgColor = '';
    if (type === 'win') {
        icon = '<i class="fas fa-check-circle"></i>';
        bgColor = '#28a745';
    } else if (type === 'lose') {
        icon = '<i class="fas fa-times-circle"></i>';
        bgColor = '#dc3545';
    } else {
        icon = '<i class="fas fa-info-circle"></i>';
        bgColor = '#ffc107';
    }
    
    toast.innerHTML = `
        <div class="toast-icon" style="color: ${bgColor}">${icon}</div>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    // Показываем с анимацией
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    // Скрываем через duration
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
            isToastShowing = false;
        }, 300);
    }, duration);
}

function formatBalance(amount) {
    return parseFloat(amount).toFixed(2);
}

function playSound(type) {
    if (sounds[type]) {
        try {
            sounds[type].currentTime = 0;
            sounds[type].play().catch(() => {});
        } catch (e) {}
    }
}

// === ПРОВЕРКА TELEGRAM WEB APP ===
function isTelegramWebApp() {
    return window.Telegram && window.Telegram.WebApp;
}

function requireTelegramWebApp() {
    if (!isTelegramWebApp()) {
        showToast('Эта функция доступна только в Telegram Web App', 'info');
        return false;
    }
    return true;
}

// === ИНИЦИАЛИЗАЦИЯ ПОЛЬЗОВАТЕЛЯ ===
async function initUser() {
    try {
        // Инициализация звуков (с заглушками)
        sounds.win = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-winning-chimes-2015.mp3');
        sounds.lose = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-retro-game-emergency-alarm-1000.mp3');
        sounds.click = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-select-click-1109.mp3');
        
        // Проверка Telegram Web App
        let tgUser = null;
        let tgNickname = '';
        if (isTelegramWebApp()) {
            const tg = window.Telegram.WebApp;
            tgUser = tg.initDataUnsafe?.user;
            
            if (tgUser) {
                tgNickname = (tgUser.first_name || '') + (tgUser.last_name ? ' ' + tgUser.last_name : '');
                tgNickname = tgNickname.trim();
                
                tg.ready();
                tg.expand();
                
                // Устанавливаем цвета интерфейса Telegram
                tg.setHeaderColor('#141516');
                tg.setBackgroundColor('#0b0c0d');
            }
        }
        
        // Создаем или загружаем пользователя
        const userId = tgUser?.id || Date.now();
        const userKey = `user_${userId}`;
        
        const savedData = localStorage.getItem(userKey);
        if (savedData) {
            currentUser = JSON.parse(savedData);
            if (tgNickname) {
                currentUser.nickname = tgNickname;
            }
        } else {
            currentUser = {
                id: userId,
                firstName: tgUser?.first_name || 'Игрок',
                username: tgUser?.username || `user${userId}`,
                nickname: tgNickname,
                photoUrl: tgUser?.photo_url,
                balance: 0.00,
                stats: {
                    totalBets: 0,
                    wonBets: 0,
                    totalWin: 0
                }
            };
            saveUserData();
        }
        
        updateAvatar();
        updateUserDisplay();
        
        // Инициализация игр
        initDiceGame();
        initMinesGame();
        initX50Game();
        initCrashGame();
        
        // Подключаемся к WebSocket
        initWebSocket();
        
        // Инициализация поиска
        initSearch();
        
        // Инициализация крипто кошелька
        initCryptoWallet();
        
        // Анимация загрузки
        setTimeout(() => {
            const preloader = document.getElementById('preloader');
            if (preloader) {
                preloader.style.opacity = '0';
                setTimeout(() => {
                    preloader.style.display = 'none';
                }, 500);
            }
        }, 1000);
        
    } catch (error) {
        const preloader = document.getElementById('preloader');
        if (preloader) {
            preloader.style.display = 'none';
        }
    }
}

// === SOCKET.IO ДЛЯ ИГР ===
function initWebSocket() {
    try {
        const socketUrl = window.location.hostname === 'localhost' 
            ? 'http://localhost:3000' 
            : window.location.origin;
        
        socket = io(socketUrl, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });
        
        socket.on('connect', () => {
            maskLog('WebSocket подключен');
        });
        
        // X50 события
        socket.on('x50_new_round', (data) => {
            maskLog('Новый раунд X50');
            startNewX50Round(data);
        });
        
        socket.on('x50_bet_placed', (data) => {
            if (data.roundId === x50State.currentRound?.id) {
                addX50Bet(data);
            }
        });
        
        socket.on('x50_round_result', (data) => {
            if (data.roundId === x50State.currentRound?.id) {
                maskLog(`Результат раунда: множитель ${data.multiplier}`);
                determineX50Winner(data.multiplier);
            }
        });
        
        socket.on('x50_time_update', (data) => {
            if (data.roundId === x50State.currentRound?.id) {
                x50State.timeLeft = data.timeLeft;
                updateX50Timer();
            }
        });
        
        // Crash события
        socket.on('crash_new_round', (data) => {
            maskLog('Новый раунд Crash');
            startNewCrashRound(data);
        });
        
        socket.on('crash_bet_placed', (data) => {
            if (data.gameId === crashState.gameId) {
                addCrashBet(data);
            }
        });
        
        socket.on('crash_update', (data) => {
            if (data.gameId === crashState.gameId) {
                updateCrashGame(data);
            }
        });
        
        socket.on('crash_crashed', (data) => {
            if (data.gameId === crashState.gameId) {
                finishCrashGame(data.crashPoint);
            }
        });
        
        socket.on('crash_cashout', (data) => {
            if (data.userId === currentUser.id) {
                processCrashCashout(data);
            }
        });
        
        socket.on('connect_error', (error) => {
            maskLog('Ошибка подключения WebSocket, переход на локальную эмуляцию');
            initLocalX50Emulation();
            initLocalCrashEmulation();
        });
        
    } catch (error) {
        maskLog('Ошибка инициализации WebSocket');
        initLocalX50Emulation();
        initLocalCrashEmulation();
    }
}

function initLocalX50Emulation() {
    maskLog('Запуск локальной эмуляции X50');
    
    socket = {
        emit: (event, data) => {
            if (event === 'x50_bet') {
                setTimeout(() => {
                    if (typeof addX50Bet === 'function') {
                        addX50Bet({
                            ...data,
                            id: Date.now(),
                            timestamp: Date.now()
                        });
                    }
                }, 100);
            }
        },
        on: (event, callback) => {
            if (event === 'connect') {
                setTimeout(() => callback(), 100);
            }
            if (event === 'x50_new_round') {
                setInterval(() => {
                    if (!x50State.currentRound) {
                        startNewX50Round({
                            id: Date.now(),
                            startTime: Date.now()
                        });
                    }
                }, 30000);
            }
        },
        connected: true
    };
    
    // Локальный таймер для эмуляции
    setInterval(() => {
        if (x50State.currentRound && x50State.timeLeft > 0) {
            x50State.timeLeft--;
            updateX50Timer();
            
            if (x50State.timeLeft === 0 && !x50State.isSpinning) {
                const random = rand(0, 1000);
                let selectedMultiplier = 2;
                for (const m of X50_MULTIPLIERS) {
                    if (random >= m.min && random <= m.max) {
                        selectedMultiplier = m.multiplier;
                        break;
                    }
                }
                
                setTimeout(() => {
                    determineX50Winner(selectedMultiplier);
                }, 1000);
            }
        }
    }, 1000);
}

function initLocalCrashEmulation() {
    maskLog('Запуск локальной эмуляции Crash');
    
    // Эмуляция раундов Crash каждые 30 секунд
    setInterval(() => {
        if (!crashState.isPlaying) {
            startNewCrashRound({
                id: Date.now(),
                startTime: Date.now()
            });
        }
    }, 30000);
}

function updateAvatar() {
    const avatarContainer = document.getElementById('userAvatar');
    const profileAvatar = document.getElementById('profileAvatarLarge');
    if (!avatarContainer || !currentUser) return;
    
    if (currentUser.photoUrl) {
        avatarContainer.innerHTML = `<img src="${currentUser.photoUrl}" alt="Аватар">`;
        if (profileAvatar) {
            profileAvatar.innerHTML = `<img src="${currentUser.photoUrl}" alt="Аватар">`;
        }
    } else {
        avatarContainer.innerHTML = '<i class="fas fa-user"></i>';
        if (profileAvatar) {
            profileAvatar.innerHTML = '<i class="fas fa-user"></i>';
        }
    }
}

function saveUserData() {
    if (!currentUser) return;
    localStorage.setItem(`user_${currentUser.id}`, JSON.stringify(currentUser));
}

function updateUserDisplay() {
    if (!currentUser) return;
    
    document.getElementById('userBalance').textContent = `${formatBalance(currentUser.balance)}$`;
    
    // Обновление профиля
    document.getElementById('profileName').textContent = currentUser.firstName;
    document.getElementById('profileUsername').textContent = `@${currentUser.username}`;
    
    const winRate = currentUser.stats.totalBets > 0 
        ? Math.round((currentUser.stats.wonBets / currentUser.stats.totalBets) * 100)
        : 0;
    
    document.getElementById('totalBets').textContent = currentUser.stats.totalBets;
    document.getElementById('wonBets').textContent = currentUser.stats.wonBets;
    document.getElementById('totalWin').textContent = `${formatBalance(currentUser.stats.totalWin)}$`;
    document.getElementById('winRate').textContent = `${winRate}%`;
}

// === ПОИСК И ФИЛЬТРАЦИЯ ===
function initSearch() {
    const searchInput = document.getElementById('searchModalInput');
    if (!searchInput) return;
    
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            performModalSearch(e.target.value.trim());
        }, 300);
    });
}

function performModalSearch(query) {
    const searchGamesGrid = document.getElementById('searchGamesGrid');
    if (!searchGamesGrid) return;
    
    const games = [
        { name: 'Кости', id: 'dice', icon: '🎲' },
        { name: 'Мины', id: 'mines', icon: '💣' },
        { name: 'X50', id: 'x50', icon: '🎯' },
        { name: 'Crash', id: 'crash', icon: '🚀' },
        { name: 'Башня', id: 'tower', icon: '🗼' },
        { name: 'Плинко', id: 'plinko', icon: '🔴' }
    ];
    
    searchGamesGrid.innerHTML = '';
    
    const filteredGames = query ? 
        games.filter(game => 
            game.name.toLowerCase().includes(query.toLowerCase()) ||
            game.id.toLowerCase().includes(query.toLowerCase())
        ) : games;
    
    filteredGames.forEach(game => {
        const gameElement = document.createElement('div');
        gameElement.className = 'game-banner';
        gameElement.innerHTML = `
            <div class="game-banner-content">
                <h3>${game.icon} ${game.name}</h3>
                <p>Нажмите чтобы играть</p>
            </div>
        `;
        gameElement.onclick = () => {
            closeSearchModal();
            openGame(game.id);
        };
        searchGamesGrid.appendChild(gameElement);
    });
    
    if (filteredGames.length === 0) {
        searchGamesGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-tertiary)">Игра не найдена</div>';
    }
}

function openSearchModal() {
    const modal = document.getElementById('searchModal');
    const overlay = document.getElementById('searchOverlay');
    
    if (modal && overlay) {
        modal.style.display = 'block';
        overlay.style.display = 'block';
        
        setTimeout(() => {
            modal.style.opacity = '1';
            modal.style.transform = 'translateY(0)';
            overlay.style.opacity = '1';
        }, 10);
        
        // Загружаем все игры
        performModalSearch('');
        document.getElementById('searchModalInput').focus();
    }
}

function closeSearchModal() {
    const modal = document.getElementById('searchModal');
    const overlay = document.getElementById('searchOverlay');
    
    if (modal && overlay) {
        modal.style.opacity = '0';
        modal.style.transform = 'translateY(20px)';
        overlay.style.opacity = '0';
        
        setTimeout(() => {
            modal.style.display = 'none';
            overlay.style.display = 'none';
        }, 300);
    }
}

function showAllGames() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('.filter-btn').forEach((btn, index) => {
        if (index === 0) btn.classList.add('active');
    });
    
    document.querySelectorAll('.game-banner').forEach(banner => {
        banner.style.display = 'block';
    });
}

function filterGames(type) {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const activeBtn = Array.from(document.querySelectorAll('.filter-btn')).find(btn => 
        btn.getAttribute('onclick')?.includes(type)
    );
    
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
    
    const games = document.querySelectorAll('.game-banner');
    
    if (type === 'slots') {
        showToast('Слоты скоро появятся!', 'info');
        games.forEach(game => {
            game.style.display = 'none';
        });
    } else if (type === 'live') {
        games.forEach(game => {
            const altText = game.querySelector('img')?.alt || '';
            if (altText.includes('X50') || altText.includes('Crash')) {
                game.style.display = 'block';
            } else {
                game.style.display = 'none';
            }
        });
    }
}

// === ИГРА В КОСТИ ===
function initDiceGame() {
    diceState.betAmount = 0.05;
    diceState.selectedOutcome = 'even';
    diceState.isRolling = false;
    
    const betInput = document.getElementById('betAmount');
    if (betInput) {
        betInput.value = '0.05';
    }
    
    selectOutcome('even');
}

function selectOutcome(outcome) {
    playSound('click');
    diceState.selectedOutcome = outcome;
    
    document.querySelectorAll('.outcome-btn, .number-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const activeBtn = document.querySelector(`[onclick*="${outcome}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }
}

function updateDiceBet() {
    const input = document.getElementById('betAmount');
    if (!input) return;
    
    diceState.betAmount = parseFloat(input.value) || 0.05;
    
    if (diceState.betAmount < 0.05) {
        diceState.betAmount = 0.05;
        input.value = '0.05';
    }
    
    if (diceState.betAmount > currentUser.balance) {
        diceState.betAmount = currentUser.balance;
        input.value = formatBalance(currentUser.balance);
    }
}

function setMinBet() {
    playSound('click');
    diceState.betAmount = 0.05;
    const input = document.getElementById('betAmount');
    if (input) input.value = '0.05';
    updateDiceBet();
}

function setMaxBet() {
    playSound('click');
    diceState.betAmount = currentUser.balance;
    const input = document.getElementById('betAmount');
    if (input) input.value = formatBalance(currentUser.balance);
    updateDiceBet();
}

async function placeDiceBet() {
    if (diceState.isRolling) return;
    
    playSound('click');
    
    if (!diceState.selectedOutcome) {
        showToast('Выберите исход броска', 'info');
        return;
    }
    
    if (diceState.betAmount < 0.05) {
        showToast('Минимальная ставка: 0.05$', 'info');
        return;
    }
    
    if (currentUser.balance < diceState.betAmount) {
        showToast('Недостаточно средств', 'info');
        return;
    }
    
    diceState.isRolling = true;
    const betBtn = document.getElementById('placeBetBtn');
    if (betBtn) {
        betBtn.disabled = true;
        betBtn.textContent = 'Бросок...';
    }
    
    try {
        currentUser.balance -= diceState.betAmount;
        updateUserDisplay();
        saveUserData();
        
        let cube = rand(1, 6);
        
        // Проверка условий банка
        const pWin = diceState.betAmount * (CUBE_ODDS[diceState.selectedOutcome] - 1);
        const randplus = rand(0, 100);
        const randminus = rand(0, 100);
        const plus = 8;
        const minus = 12;
        
        if (pWin * (-1) < gameBanks.cube.minBank - gameBanks.cube.bank || 
            (gameBanks.cube.bank < 0 && randminus < minus) || 
            (gameBanks.cube.bank > 0 && randplus < plus)) {
            
            switch(diceState.selectedOutcome) {
                case 'even': cube = randFrom([1, 3, 5]); break;
                case 'odd': cube = randFrom([2, 4, 6]); break;
                case 'greater': cube = randFrom([1, 2, 3]); break;
                case 'less': cube = randFrom([4, 5, 6]); break;
                default:
                    const possibleNumbers = [1, 2, 3, 4, 5, 6].filter(n => n !== parseInt(diceState.selectedOutcome));
                    cube = randFrom(possibleNumbers);
            }
        }
        
        let win = false;
        switch (diceState.selectedOutcome) {
            case 'even': win = cube % 2 === 0; break;
            case 'odd': win = cube % 2 !== 0; break;
            case 'greater': win = cube > 3; break;
            case 'less': win = cube < 4; break;
            default: win = cube === parseInt(diceState.selectedOutcome);
        }
        
        let winAmount = 0;
        if (win) {
            winAmount = diceState.betAmount * (CUBE_ODDS[diceState.selectedOutcome] - 1);
            gameBanks.cube.bank -= winAmount;
        } else {
            gameBanks.cube.bank += diceState.betAmount;
        }
        
        currentUser.stats.totalBets++;
        
        const salt = getRandomString(12);
        const hashCube = md5(cube + "|" + salt);
        
        saveGameToHistory(cube, win, winAmount, hashCube, salt);
        
        await playDiceAnimation(cube);
        
        if (win) {
            currentUser.balance += winAmount + diceState.betAmount;
            currentUser.stats.wonBets++;
            currentUser.stats.totalWin += winAmount;
            
            setTimeout(() => {
                showToast(`Вы выиграли ${formatBalance(winAmount)}$!`, 'win');
            }, 500);
            
            playSound('win');
            
        } else {
            setTimeout(() => {
                showToast(`Вы проиграли ${formatBalance(diceState.betAmount)}$`, 'lose');
            }, 500);
            
            playSound('lose');
        }
        
        updateUserDisplay();
        saveUserData();
        
    } catch (error) {
        showToast('Ошибка при обработке ставки', 'info');
    } finally {
        setTimeout(() => {
            diceState.isRolling = false;
            const betBtn = document.getElementById('placeBetBtn');
            if (betBtn) {
                betBtn.disabled = false;
                betBtn.textContent = 'Сделать ставку';
            }
        }, 3000);
    }
}

function saveGameToHistory(result, win, winAmount, hash, salt) {
    const game = {
        id: Date.now(),
        type: 'dice',
        result: result,
        win: win,
        amount: diceState.betAmount,
        winAmount: winAmount,
        outcome: diceState.selectedOutcome,
        hash: hash,
        salt: salt,
        timestamp: new Date().toISOString()
    };
    
    const games = JSON.parse(localStorage.getItem(`games_${currentUser.id}`) || '[]');
    games.push(game);
    localStorage.setItem(`games_${currentUser.id}`, JSON.stringify(games));
}

async function playDiceAnimation(result) {
    const diceAnimation = document.getElementById('diceAnimation');
    const diceImage = document.getElementById('diceImage');
    
    if (!diceAnimation || !diceImage) return;
    
    // Скрываем статичное изображение
    diceImage.style.display = 'none';
    diceAnimation.style.display = 'block';
    diceAnimation.innerHTML = '';
    
    // Загружаем Lottie анимацию
    try {
        const animation = lottie.loadAnimation({
            container: diceAnimation,
            renderer: 'svg',
            loop: false,
            autoplay: true,
            path: `animations/dice${result}.json`
        });
        
        return new Promise(resolve => {
            animation.addEventListener('complete', () => {
                setTimeout(() => {
                    diceAnimation.style.display = 'none';
                    diceImage.style.display = 'block';
                    resolve();
                }, 1000);
            });
            
            animation.addEventListener('data_failed', () => {
                fallbackAnimation(resolve);
            });
        });
    } catch (error) {
        fallbackAnimation(() => {});
    }
    
    function fallbackAnimation(resolve) {
        // Fallback на вращение чисел
        const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
        let spins = 0;
        const maxSpins = 10;
        
        const spinInterval = setInterval(() => {
            diceAnimation.innerHTML = `<div style="font-size: 80px; text-align: center;">${faces[rand(0, 5)]}</div>`;
            spins++;
            
            if (spins >= maxSpins) {
                clearInterval(spinInterval);
                diceAnimation.innerHTML = `<div style="font-size: 80px; text-align: center;">${faces[result - 1]}</div>`;
                setTimeout(() => {
                    diceAnimation.style.display = 'none';
                    diceImage.style.display = 'block';
                    resolve();
                }, 1000);
            }
        }, 100);
    }
}

// === ИГРА В МИНЫ ===
function initMinesGame() {
    minesState = {
        isPlaying: false,
        betAmount: 0.05,
        minesCount: 2,
        currentMultiplier: 1.00,
        nextMultiplier: 1.00,
        potentialWin: 0,
        openedCells: [],
        minesPositions: [],
        steps: 0
    };
    
    const betInput = document.getElementById('minesBetAmount');
    const slider = document.getElementById('minesSlider');
    const valueDisplay = document.getElementById('minesValue');
    
    if (betInput) betInput.value = '0.05';
    if (slider) slider.value = '2';
    if (valueDisplay) valueDisplay.textContent = '2 мины';
    
    renderMinesField();
    
    const cashoutBtn = document.getElementById('cashoutMinesBtn');
    const startBtn = document.getElementById('startMinesBtn');
    
    if (cashoutBtn) cashoutBtn.style.display = 'none';
    if (startBtn) startBtn.style.display = 'block';
    
    updateCoefficients();
    updateMultiplierDisplay();
}

function renderMinesField() {
    const field = document.getElementById('minesField');
    if (!field) return;
    
    field.innerHTML = '';
    
    for (let i = 1; i <= MINES_GRID_SIZE; i++) {
        const tile = document.createElement('div');
        tile.className = 'mines-tile';
        tile.dataset.tile = i;
        
        if (minesState.isPlaying && minesState.openedCells.includes(i)) {
            if (minesState.minesPositions.includes(i)) {
                tile.innerHTML = '<img src="images/bomb-mine.png" alt="💣">';
                tile.classList.add('mine');
            } else {
                tile.innerHTML = '<img src="images/gem-mine.png" alt="💎">';
                tile.classList.add('gem');
            }
        } else {
            tile.innerHTML = '<img src="images/tile-mine.png" alt="⬜">';
        }
        
        if (minesState.isPlaying && !minesState.openedCells.includes(i)) {
            tile.style.cursor = 'pointer';
            tile.onclick = () => openMinesTile(i);
        } else {
            tile.style.cursor = 'default';
        }
        
        field.appendChild(tile);
    }
}

function updateMinesBet() {
    const input = document.getElementById('minesBetAmount');
    if (!input) return;
    
    minesState.betAmount = parseFloat(input.value) || 0.05;
    
    if (minesState.betAmount < 0.05) {
        minesState.betAmount = 0.05;
        input.value = '0.05';
    }
    
    if (minesState.betAmount > currentUser.balance) {
        minesState.betAmount = currentUser.balance;
        input.value = formatBalance(currentUser.balance);
    }
}

function setMinesMinBet() {
    playSound('click');
    minesState.betAmount = 0.05;
    const input = document.getElementById('minesBetAmount');
    if (input) input.value = '0.05';
    updateMinesBet();
}

function setMinesMaxBet() {
    playSound('click');
    minesState.betAmount = currentUser.balance;
    const input = document.getElementById('minesBetAmount');
    if (input) input.value = formatBalance(currentUser.balance);
    updateMinesBet();
}

function updateMinesSlider(value) {
    minesState.minesCount = parseInt(value);
    const display = document.getElementById('minesValue');
    if (display) display.textContent = `${value} ${getMinesWord(value)}`;
}

function getMinesWord(count) {
    if (count === 1) return 'мина';
    if (count >= 2 && count <= 4) return 'мины';
    return 'мин';
}

function updateCoefficients() {
    const safeCells = MINES_GRID_SIZE - minesState.minesCount;
    
    if (minesState.steps === 0) {
        minesState.currentMultiplier = 1.00;
        minesState.nextMultiplier = (MINES_GRID_SIZE / safeCells) * MINES_COMMISSION;
    } else {
        const remainingSafeCells = MINES_GRID_SIZE - minesState.minesCount - minesState.steps;
        if (remainingSafeCells > 0) {
            minesState.currentMultiplier = minesState.nextMultiplier;
            minesState.nextMultiplier = ((MINES_GRID_SIZE - minesState.steps) / remainingSafeCells) * minesState.currentMultiplier;
        }
    }
    
    const cashoutBtn = document.getElementById('cashoutMinesBtn');
    if (cashoutBtn) {
        cashoutBtn.innerHTML = `Забрать <span id="cashoutAmount">${formatBalance(minesState.betAmount * minesState.currentMultiplier)}$</span>`;
    }
}

function updateMultiplierDisplay() {
    const currentMultiplierEl = document.getElementById('currentMultiplier');
    const nextMultiplierEl = document.getElementById('nextMultiplier');
    
    if (currentMultiplierEl) {
        currentMultiplierEl.textContent = `${formatBalance(minesState.currentMultiplier)}x`;
    }
    
    if (nextMultiplierEl) {
        nextMultiplierEl.textContent = `${formatBalance(minesState.nextMultiplier)}x`;
    }
}

async function startMinesGame() {
    playSound('click');
    
    if (minesState.isPlaying) {
        showToast('Игра уже начата!', 'info');
        return;
    }
    
    if (minesState.betAmount < 0.05) {
        showToast('Минимальная ставка: 0.05$', 'info');
        return;
    }
    
    if (currentUser.balance < minesState.betAmount) {
        showToast('Недостаточно средств', 'info');
        return;
    }
    
    currentUser.balance -= minesState.betAmount;
    updateUserDisplay();
    saveUserData();
    
    minesState.minesPositions = generateMinesPositions();
    
    minesState.isPlaying = true;
    minesState.openedCells = [];
    minesState.steps = 0;
    minesState.currentMultiplier = 1.00;
    
    updateCoefficients();
    
    const startBtn = document.getElementById('startMinesBtn');
    const cashoutBtn = document.getElementById('cashoutMinesBtn');
    
    if (startBtn) startBtn.style.display = 'none';
    if (cashoutBtn) cashoutBtn.style.display = 'block';
    
    renderMinesField();
}

function generateMinesPositions() {
    const positions = [];
    const allPositions = Array.from({ length: MINES_GRID_SIZE }, (_, i) => i + 1);
    
    // Перемешиваем массив
    for (let i = allPositions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allPositions[i], allPositions[j]] = [allPositions[j], allPositions[i]];
    }
    
    // Берем нужное количество мин
    return allPositions.slice(0, minesState.minesCount);
}

async function openMinesTile(tileNumber) {
    if (!minesState.isPlaying || minesState.openedCells.includes(tileNumber)) {
        return;
    }
    
    playSound('click');
    
    const potentialWin = minesState.betAmount * minesState.nextMultiplier - minesState.betAmount;
    const randplus = rand(0, 100);
    const randminus = rand(0, 100);
    
    let forcedLoss = false;
    
    if (potentialWin * (-1) < MINES_BANK.minBank - MINES_BANK.bank) {
        forcedLoss = true;
    }
    if (MINES_BANK.bank < 0 && randminus < 12) forcedLoss = true;
    if (MINES_BANK.bank > 0 && randplus < 8) forcedLoss = true;
    
    if (forcedLoss) {
        // ПРИНУДИТЕЛЬНЫЙ ПРОИГРЫШ С ПЕРЕМЕЩЕНИЕМ МИНЫ
        if (!minesState.minesPositions.includes(tileNumber)) {
            // Находим мину, которая НЕ на этой клетке
            const mineToMove = minesState.minesPositions.find(mine => mine !== tileNumber);
            if (mineToMove) {
                // Перемещаем мину на нажатую клетку
                const mineIndex = minesState.minesPositions.indexOf(mineToMove);
                minesState.minesPositions[mineIndex] = tileNumber;
            }
        }
        
        minesState.openedCells.push(tileNumber);
        minesState.isPlaying = false;
        
        MINES_BANK.bank += minesState.betAmount;
        
        revealAllMines();
        
        setTimeout(() => {
            showToast(`Вы проиграли ${formatBalance(minesState.betAmount)}$`, 'lose');
        }, 500);
        
        playSound('lose');
        
        setTimeout(() => {
            resetMinesGame();
        }, 3000);
        
        return;
    }
    
    const chance2Win = 100 - (minesState.minesCount / (MINES_GRID_SIZE - minesState.steps)) * 100;
    const random = rand(1, 100);
    const isWin = random <= chance2Win && !minesState.minesPositions.includes(tileNumber);
    
    if (!isWin) {
        minesState.openedCells.push(tileNumber);
        minesState.isPlaying = false;
        
        MINES_BANK.bank += minesState.betAmount;
        
        revealAllMines();
        
        setTimeout(() => {
            showToast(`Вы проиграли ${formatBalance(minesState.betAmount)}$`, 'lose');
        }, 500);
        
        playSound('lose');
        
        setTimeout(() => {
            resetMinesGame();
        }, 3000);
        
    } else {
        minesState.openedCells.push(tileNumber);
        minesState.steps++;
        
        updateCoefficients();
        
        renderMinesField();
        updateMultiplierDisplay();
        
        showToast(`Безопасно! Множитель: ${formatBalance(minesState.currentMultiplier)}x`, 'info');
    }
}

function revealAllMines() {
    for (let i = 1; i <= MINES_GRID_SIZE; i++) {
        const tile = document.querySelector(`.mines-tile[data-tile="${i}"]`);
        if (tile) {
            if (minesState.minesPositions.includes(i)) {
                tile.innerHTML = '<img src="images/bomb-mine.png" alt="💣">';
                tile.classList.add('mine');
            } else if (!minesState.openedCells.includes(i)) {
                tile.innerHTML = '<img src="images/gem-mine.png" alt="💎">';
                tile.classList.add('gem');
            }
        }
    }
}

function resetMinesGame() {
    minesState.isPlaying = false;
    renderMinesField();
    
    const cashoutBtn = document.getElementById('cashoutMinesBtn');
    const startBtn = document.getElementById('startMinesBtn');
    
    if (cashoutBtn) cashoutBtn.style.display = 'none';
    if (startBtn) startBtn.style.display = 'block';
    
    minesState.currentMultiplier = 1.00;
    minesState.nextMultiplier = 1.00;
    updateMultiplierDisplay();
}

async function cashoutMines() {
    if (!minesState.isPlaying || minesState.steps === 0) {
        showToast('Сделайте хотя бы 1 ход!', 'info');
        return;
    }
    
    playSound('click');
    
    const winAmount = minesState.betAmount * minesState.currentMultiplier;
    const profit = winAmount - minesState.betAmount;
    
    currentUser.balance += winAmount;
    currentUser.stats.totalBets++;
    currentUser.stats.wonBets++;
    currentUser.stats.totalWin += profit;
    
    MINES_BANK.bank -= profit;
    
    updateUserDisplay();
    saveUserData();
    
    minesState.isPlaying = false;
    revealAllMines();
    
    setTimeout(() => {
        showToast(`Вы выиграли ${formatBalance(profit)}$!`, 'win');
    }, 500);
    
    playSound('win');
    
    setTimeout(() => {
        resetMinesGame();
    }, 3000);
}

// === ИГРА X50 ===
function initX50Game() {
    x50State = {
        isPlaying: false,
        betAmount: 0.05,
        selectedMultiplier: 2,
        bets: {},
        currentRound: null,
        timeLeft: 15,
        timer: null,
        isSpinning: false,
        roundStartTime: null
    };
    
    const betInput = document.getElementById('x50BetAmount');
    if (betInput) betInput.value = '0.05';
    
    updateX50BetsDisplay();
}

function startNewX50Round(data) {
    if (x50State.currentRound) return;
    
    x50State.currentRound = {
        id: data.id,
        startTime: data.startTime || Date.now(),
        bets: {},
        multiplier: null,
        winner: null,
        status: 'betting'
    };
    
    x50State.timeLeft = 15;
    x50State.bets = {};
    x50State.isSpinning = false;
    x50State.roundStartTime = Date.now();
    
    updateX50Timer();
    updateX50BetsDisplay();
    resetWheel();
    
    const wheelContainer = document.querySelector('.x50-wheel-container');
    if (wheelContainer) {
        wheelContainer.classList.remove('disabled');
        wheelContainer.classList.add('active');
    }
}

function updateX50Timer() {
    const timerEl = document.getElementById('x50Timer');
    if (timerEl) {
        timerEl.textContent = `${x50State.timeLeft} сек`;
        timerEl.className = `x50-timer ${x50State.timeLeft <= 5 ? 'danger' : ''}`;
    }
}

function updateX50Bet() {
    const input = document.getElementById('x50BetAmount');
    if (!input) return;
    
    x50State.betAmount = parseFloat(input.value) || 0.05;
    
    if (x50State.betAmount < 0.05) {
        x50State.betAmount = 0.05;
        input.value = '0.05';
    }
    
    if (x50State.betAmount > currentUser.balance) {
        x50State.betAmount = currentUser.balance;
        input.value = formatBalance(currentUser.balance);
    }
}

function setX50MinBet() {
    playSound('click');
    x50State.betAmount = 0.05;
    const input = document.getElementById('x50BetAmount');
    if (input) input.value = '0.05';
    updateX50Bet();
}

function setX50MaxBet() {
    playSound('click');
    x50State.betAmount = currentUser.balance;
    const input = document.getElementById('x50BetAmount');
    if (input) input.value = formatBalance(currentUser.balance);
    updateX50Bet();
}

function placeX50Bet(multiplier) {
    if (!x50State.currentRound || x50State.timeLeft <= 0 || x50State.isSpinning) {
        showToast('Прием ставок завершен', 'info');
        return;
    }
    
    playSound('click');
    
    if (x50State.betAmount < 0.05) {
        showToast('Минимальная ставка: 0.05$', 'info');
        return;
    }
    
    if (currentUser.balance < x50State.betAmount) {
        showToast('Недостаточно средств', 'info');
        return;
    }
    
    const betId = Date.now() + Math.random();
    x50State.bets[betId] = {
        id: betId,
        userId: currentUser.id,
        username: currentUser.firstName,
        roundId: x50State.currentRound.id,
        multiplier: multiplier,
        amount: x50State.betAmount,
        timestamp: Date.now()
    };
    
    currentUser.balance -= x50State.betAmount;
    updateUserDisplay();
    saveUserData();
    
    updateX50BetsDisplay();
    
    if (socket && socket.connected) {
        socket.emit('x50_bet', {
            userId: currentUser.id,
            username: currentUser.firstName,
            amount: x50State.betAmount,
            multiplier: multiplier,
            roundId: x50State.currentRound.id,
            betId: betId
        });
    }
    
    showToast(`Ставка ${x50State.betAmount}$ на x${multiplier} принята!`, 'info');
    
    saveTransaction(-x50State.betAmount, 'bet', `Ставка X50 (x${multiplier})`);
}

function addX50Bet(data) {
    if (data.roundId === x50State.currentRound?.id) {
        const betId = data.betId || Date.now();
        x50State.bets[betId] = {
            id: betId,
            userId: data.userId,
            username: data.username,
            roundId: data.roundId,
            multiplier: data.multiplier,
            amount: data.amount,
            timestamp: data.timestamp || Date.now()
        };
        updateX50BetsDisplay();
    }
}

function updateX50BetsDisplay() {
    const betsByMultiplier = {
        2: [],
        3: [],
        5: [],
        50: []
    };
    
    Object.values(x50State.bets).forEach(bet => {
        if (betsByMultiplier[bet.multiplier]) {
            betsByMultiplier[bet.multiplier].push(bet);
        }
    });
    
    for (const multiplier of [2, 3, 5, 50]) {
        const betsList = document.getElementById(`x${multiplier}Bets`);
        const totalElement = document.getElementById(`x${multiplier}Total`);
        
        if (betsList && totalElement) {
            const bets = betsByMultiplier[multiplier];
            
            if (bets.length === 0) {
                betsList.innerHTML = '<div class="empty-bets">Нет ставок</div>';
                totalElement.textContent = '0$';
            } else {
                let total = 0;
                let html = '';
                
                bets.slice(0, 5).forEach(bet => {
                    total += bet.amount;
                    html += `
                        <div class="x50-bet-item">
                            <span class="x50-bet-user">${bet.username}</span>
                            <span class="x50-bet-amount">${formatBalance(bet.amount)}$</span>
                        </div>
                    `;
                });
                
                if (bets.length > 5) {
                    html += `<div class="x50-bet-more">+${bets.length - 5} ставок</div>`;
                }
                
                betsList.innerHTML = html;
                totalElement.textContent = `${formatBalance(total)}$`;
            }
        }
    }
}

function determineX50Winner(selectedMultiplier) {
    if (!x50State.currentRound || x50State.isSpinning) return;
    
    x50State.isSpinning = true;
    x50State.currentRound.status = 'calculating';
    
    const wheelContainer = document.querySelector('.x50-wheel-container');
    if (wheelContainer) {
        wheelContainer.classList.add('disabled');
    }
    
    spinWheel(selectedMultiplier, () => {
        const winningBets = Object.values(x50State.bets)
            .filter(bet => bet.roundId === x50State.currentRound.id && bet.multiplier === selectedMultiplier);
        
        winningBets.forEach(bet => {
            const winAmount = bet.amount * selectedMultiplier;
            const profit = winAmount - bet.amount;
            
            gameBanks.x50.bank -= profit;
            
            const userKey = `user_${bet.userId}`;
            const userData = localStorage.getItem(userKey);
            if (userData) {
                const user = JSON.parse(userData);
                user.balance += winAmount;
                user.stats.totalBets = (user.stats.totalBets || 0) + 1;
                user.stats.wonBets = (user.stats.wonBets || 0) + 1;
                user.stats.totalWin = (user.stats.totalWin || 0) + profit;
                localStorage.setItem(userKey, JSON.stringify(user));
                
                if (bet.userId === currentUser.id) {
                    currentUser.balance += winAmount;
                    currentUser.stats.totalBets++;
                    currentUser.stats.wonBets++;
                    currentUser.stats.totalWin += profit;
                    updateUserDisplay();
                    saveUserData();
                    
                    showToast(`Вы выиграли ${formatBalance(profit)}$! (x${selectedMultiplier})`, 'win');
                    playSound('win');
                }
            }
        });
        
        x50State.currentRound.multiplier = selectedMultiplier;
        x50State.currentRound.winner = winningBets.length > 0 ? winningBets[0].userId : null;
        x50State.currentRound.status = 'completed';
        
        setTimeout(() => {
            const wheelContainer = document.querySelector('.x50-wheel-container');
            if (wheelContainer) {
                wheelContainer.classList.remove('active');
                wheelContainer.classList.add('waiting');
            }
            
            setTimeout(() => {
                x50State.currentRound = null;
                x50State.bets = {};
                x50State.isSpinning = false;
                
                if (wheelContainer) {
                    wheelContainer.classList.remove('waiting', 'disabled');
                }
            }, 15000);
        }, 5000);
    });
}

function spinWheel(selectedMultiplier, callback) {
    const wheel = document.getElementById('x50Wheel');
    const arrow = document.getElementById('x50Arrow');
    const resultEl = document.getElementById('x50Result');
    
    if (!wheel || !arrow) return;
    
    // Корректируем позицию стрелки
    arrow.style.position = 'absolute';
    arrow.style.top = '50%';
    arrow.style.left = '50%';
    arrow.style.transform = 'translate(-50%, -50%) rotate(90deg)';
    arrow.style.zIndex = '10';
    arrow.style.fontSize = '40px';
    arrow.style.color = '#bbeb00';
    
    const multiplierAngles = {
        2: 0,
        3: 90,
        5: 180,
        50: 270
    };
    
    const stopAngle = multiplierAngles[selectedMultiplier] || 0;
    const totalRotation = 1440 + stopAngle; // 4 полных оборота + угол сектора
    
    wheel.style.transition = 'none';
    wheel.style.transform = 'rotate(0deg)';
    
    setTimeout(() => {
        wheel.style.transition = 'transform 4s cubic-bezier(0.17, 0.67, 0.1, 1)';
        wheel.style.transform = `rotate(${totalRotation}deg)`;
        
        setTimeout(() => {
            if (resultEl) {
                resultEl.textContent = `x${selectedMultiplier}`;
                resultEl.style.display = 'block';
                resultEl.style.animation = 'popIn 0.5s ease-out';
                resultEl.style.color = X50_MULTIPLIERS.find(m => m.multiplier === selectedMultiplier)?.color || '#6c757d';
                resultEl.style.borderColor = X50_MULTIPLIERS.find(m => m.multiplier === selectedMultiplier)?.color || '#6c757d';
            }
            
            if (callback) setTimeout(callback, 1000);
        }, 3800);
    }, 10);
}

function resetWheel() {
    const wheel = document.getElementById('x50Wheel');
    const arrow = document.getElementById('x50Arrow');
    const resultEl = document.getElementById('x50Result');
    
    if (wheel) {
        wheel.style.transition = 'none';
        wheel.style.transform = 'rotate(0deg)';
    }
    
    if (resultEl) {
        resultEl.style.display = 'none';
        resultEl.style.animation = '';
    }
}

// === ИГРА CRASH ===
function initCrashGame() {
    crashState = {
        isPlaying: false,
        betAmount: 0.05,
        autoCashout: null,
        currentMultiplier: 1.00,
        gameId: null,
        bets: [],
        history: [],
        gameStartTime: null,
        crashPoint: null,
        status: 'waiting',
        graphPoints: [],
        socket: null
    };
    
    const betInput = document.getElementById('crashBetAmount');
    if (betInput) betInput.value = '0.05';
    
    updateCrashHistory();
}

function startNewCrashRound(data) {
    if (crashState.isPlaying) return;
    
    crashState.gameId = data.id;
    crashState.status = 'waiting';
    crashState.currentMultiplier = 1.00;
    crashState.bets = [];
    crashState.crashPoint = null;
    crashState.graphPoints = [];
    crashState.gameStartTime = Date.now() + 5000; // Через 5 секунд
    
    // Обновляем UI
    document.getElementById('crashMultiplier').textContent = '1.00x';
    document.getElementById('crashTimer').textContent = '5';
    document.getElementById('crashBetBtn').disabled = false;
    document.getElementById('crashCashoutBtn').style.display = 'none';
    
    // Очищаем график
    const canvas = document.getElementById('crashCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    
    // Запускаем отсчет
    let countdown = 5;
    const countdownInterval = setInterval(() => {
        document.getElementById('crashTimer').textContent = countdown;
        countdown--;
        
        if (countdown < 0) {
            clearInterval(countdownInterval);
            startCrashFlight();
        }
    }, 1000);
}

function startCrashFlight() {
    crashState.status = 'flying';
    crashState.gameStartTime = Date.now();
    
    // Генерируем точку краша с подкруткой
    crashState.crashPoint = generateCrashPointWithCheat();
    maskLog(`[CRASH] Точка краша: ${crashState.crashPoint.toFixed(2)}x`);
    
    // Запускаем анимацию графика
    animateCrashGraph();
    
    // Включаем кнопку кэшаута
    document.getElementById('crashCashoutBtn').style.display = 'block';
}

function generateCrashPointWithCheat() {
    const r = Math.random();
    let honestCrashPoint = 1 + (1 / (1 - Math.max(0.01, r))) * 0.01;
    
    // Анализ ставок
    const betsAnalysis = {
        totalAmount: crashState.bets.reduce((sum, bet) => sum + bet.amount, 0),
        bigBets: crashState.bets.filter(bet => bet.amount > 1),
        autoCashouts: crashState.bets.filter(bet => bet.autoCashout).map(bet => bet.autoCashout)
    };
    
    let finalCrashPoint = honestCrashPoint;
    
    // 1. Если много крупных ставок - крашим раньше
    if (betsAnalysis.bigBets.length > 0) {
        const bigBetsTotal = betsAnalysis.bigBets.reduce((sum, b) => sum + b.amount, 0);
        if (bigBetsTotal > betsAnalysis.totalAmount * 0.5) {
            finalCrashPoint = Math.min(finalCrashPoint, 2 + Math.random() * 3);
        }
    }
    
    // 2. Если банк в минусе - даем выиграть
    if (gameBanks.crash.bank < 0) {
        const lossPercentage = Math.abs(gameBanks.crash.bank) / Math.abs(gameBanks.crash.minBank);
        if (lossPercentage > 0.3) {
            finalCrashPoint = Math.max(finalCrashPoint, 10 + Math.random() * 20);
        }
    }
    
    // 3. Анализ автокэшаутов
    if (betsAnalysis.autoCashouts.length > 0) {
        const avgAutoCashout = betsAnalysis.autoCashouts.reduce((a, b) => a + b, 0) / betsAnalysis.autoCashouts.length;
        if (avgAutoCashout > 0) {
            finalCrashPoint = Math.min(finalCrashPoint, avgAutoCashout * 0.97);
        }
    }
    
    // Ограничения
    finalCrashPoint = Math.max(1.01, finalCrashPoint);
    finalCrashPoint = Math.min(finalCrashPoint, 1000);
    
    return finalCrashPoint;
}

function animateCrashGraph() {
    const canvas = document.getElementById('crashCanvas');
    const ctx = canvas.getContext('2d');
    const startTime = Date.now();
    const crashPoint = crashState.crashPoint;
    
    function drawFrame() {
        if (crashState.status !== 'flying') return;
        
        const elapsed = (Date.now() - startTime) / 1000;
        const currentMultiplier = Math.min(Math.exp(elapsed / 10), crashPoint);
        
        crashState.currentMultiplier = currentMultiplier;
        document.getElementById('crashMultiplier').textContent = `${currentMultiplier.toFixed(2)}x`;
        
        // Добавляем точку в график
        crashState.graphPoints.push({
            time: elapsed,
            multiplier: currentMultiplier
        });
        
        // Очищаем canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Рисуем график
        ctx.beginPath();
        ctx.moveTo(0, canvas.height);
        
        const maxTime = 30; // Максимум 30 секунд на графике
        const maxMultiplier = Math.max(crashPoint, 10); // Максимальный множитель для масштаба
        
        crashState.graphPoints.forEach(point => {
            const x = (point.time / maxTime) * canvas.width;
            const y = canvas.height - (point.multiplier / maxMultiplier) * canvas.height;
            ctx.lineTo(x, y);
        });
        
        ctx.strokeStyle = currentMultiplier >= crashPoint * 0.9 ? '#dc3545' : '#28a745';
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // Проверяем автокэшауты
        crashState.bets.forEach(bet => {
            if (bet.status === 'active' && bet.autoCashout && currentMultiplier >= bet.autoCashout) {
                processCrashCashout(bet.id, currentMultiplier);
            }
        });
        
        // Проверяем краш
        if (currentMultiplier >= crashPoint) {
            finishCrashGame(crashPoint);
            return;
        }
        
        requestAnimationFrame(drawFrame);
    }
    
    drawFrame();
}

function updateCrashBet() {
    const input = document.getElementById('crashBetAmount');
    if (!input) return;
    
    crashState.betAmount = parseFloat(input.value) || 0.05;
    
    if (crashState.betAmount < 0.05) {
        crashState.betAmount = 0.05;
        input.value = '0.05';
    }
    
    if (crashState.betAmount > currentUser.balance) {
        crashState.betAmount = currentUser.balance;
        input.value = formatBalance(currentUser.balance);
    }
}

function setCrashMinBet() {
    playSound('click');
    crashState.betAmount = 0.05;
    const input = document.getElementById('crashBetAmount');
    if (input) input.value = '0.05';
    updateCrashBet();
}

function setCrashMaxBet() {
    playSound('click');
    crashState.betAmount = currentUser.balance;
    const input = document.getElementById('crashBetAmount');
    if (input) input.value = formatBalance(currentUser.balance);
    updateCrashBet();
}

function placeCrashBet() {
    if (crashState.status !== 'waiting' && crashState.status !== 'countdown') {
        showToast('Прием ставок завершен', 'info');
        return;
    }
    
    playSound('click');
    
    if (crashState.betAmount < 0.05) {
        showToast('Минимальная ставка: 0.05$', 'info');
        return;
    }
    
    if (currentUser.balance < crashState.betAmount) {
        showToast('Недостаточно средств', 'info');
        return;
    }
    
    const autoCashout = parseFloat(document.getElementById('crashAutoCashout').value) || null;
    
    const bet = {
        id: Date.now(),
        userId: currentUser.id,
        username: currentUser.firstName,
        amount: crashState.betAmount,
        autoCashout: autoCashout,
        status: 'active',
        cashoutAt: null,
        winAmount: 0
    };
    
    crashState.bets.push(bet);
    currentUser.balance -= crashState.betAmount;
    updateUserDisplay();
    saveUserData();
    
    if (socket && socket.connected) {
        socket.emit('crash_bet', {
            ...bet,
            gameId: crashState.gameId
        });
    }
    
    showToast(`Ставка ${crashState.betAmount}$ принята!${autoCashout ? ` Автокэшаут: ${autoCashout}x` : ''}`, 'info');
    updateCrashBetsDisplay();
}

function updateCrashBetsDisplay() {
    const betsList = document.getElementById('crashBetsList');
    if (!betsList) return;
    
    betsList.innerHTML = '';
    
    crashState.bets.slice(-10).forEach(bet => {
        const betEl = document.createElement('div');
        betEl.className = 'crash-bet-item';
        betEl.innerHTML = `
            <span>${bet.username}</span>
            <span>${formatBalance(bet.amount)}$</span>
            <span>${bet.autoCashout ? bet.autoCashout + 'x' : 'Нет'}</span>
        `;
        betsList.appendChild(betEl);
    });
}

function cashoutCrash() {
    if (crashState.status !== 'flying') {
        showToast('Игра не активна', 'info');
        return;
    }
    
    const userBet = crashState.bets.find(bet => bet.userId === currentUser.id && bet.status === 'active');
    if (!userBet) {
        showToast('У вас нет активной ставки', 'info');
        return;
    }
    
    processCrashCashout(userBet.id, crashState.currentMultiplier);
}

function processCrashCashout(betId, multiplier) {
    const betIndex = crashState.bets.findIndex(b => b.id === betId);
    if (betIndex === -1 || crashState.bets[betIndex].status !== 'active') return;
    
    const bet = crashState.bets[betIndex];
    const winAmount = bet.amount * multiplier;
    const profit = winAmount - bet.amount;
    
    // Обновляем ставку
    crashState.bets[betIndex].status = 'cashed_out';
    crashState.bets[betIndex].cashoutAt = multiplier;
    crashState.bets[betIndex].winAmount = winAmount;
    
    // Обновляем баланс
    if (bet.userId === currentUser.id) {
        currentUser.balance += winAmount;
        currentUser.stats.totalBets++;
        currentUser.stats.wonBets++;
        currentUser.stats.totalWin += profit;
        updateUserDisplay();
        saveUserData();
        
        showToast(`Вы забрали ${formatBalance(profit)}$! (${multiplier.toFixed(2)}x)`, 'win');
        playSound('win');
    }
    
    // Обновляем банк
    gameBanks.crash.bank -= profit;
    
    updateCrashBetsDisplay();
}

function finishCrashGame(crashPoint) {
    crashState.status = 'crashed';
    
    // Все активные ставки проигрывают
    crashState.bets.forEach(bet => {
        if (bet.status === 'active') {
            bet.status = 'crashed';
            gameBanks.crash.bank += bet.amount;
            
            if (bet.userId === currentUser.id) {
                showToast(`Краш! Вы проиграли ${formatBalance(bet.amount)}$`, 'lose');
                playSound('lose');
            }
        }
    });
    
    // Добавляем в историю
    crashState.history.unshift({
        gameId: crashState.gameId,
        crashPoint: crashPoint,
        timestamp: Date.now()
    });
    
    if (crashState.history.length > 10) {
        crashState.history.pop();
    }
    
    updateCrashHistory();
    
    // Новый раунд через 5 секунд
    setTimeout(() => {
        if (socket && socket.connected) {
            socket.emit('crash_new_round');
        } else {
            startNewCrashRound({ id: Date.now() });
        }
    }, 5000);
}

function updateCrashHistory() {
    const historyList = document.getElementById('crashHistory');
    if (!historyList) return;
    
    historyList.innerHTML = '';
    
    crashState.history.forEach(game => {
        const item = document.createElement('div');
        item.className = 'crash-history-item';
        item.innerHTML = `
            <span>#${game.gameId.toString().slice(-4)}</span>
            <span>${game.crashPoint.toFixed(2)}x</span>
            <span>${new Date(game.timestamp).toLocaleTimeString()}</span>
        `;
        historyList.appendChild(item);
    });
}

function addCrashBet(data) {
    if (data.gameId === crashState.gameId) {
        crashState.bets.push(data);
        updateCrashBetsDisplay();
    }
}

function updateCrashGame(data) {
    if (data.gameId === crashState.gameId) {
        crashState.currentMultiplier = data.multiplier;
        document.getElementById('crashMultiplier').textContent = `${data.multiplier.toFixed(2)}x`;
    }
}

// === ПЛАТЕЖНЫЕ СИСТЕМЫ ===
async function createCryptoBotInvoice(amount, currency = 'USDT') {
    try {
        const response = await fetch(`${CRYPTO_BOT_API}/createInvoice`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN
            },
            body: JSON.stringify({
                asset: currency,
                amount: amount.toString(),
                description: `Deposit for user ${currentUser.id}`,
                hidden_message: 'Thank you for your deposit!',
                expires_in: 3600
            })
        });
        
        const result = await response.json();
        
        if (result.ok && result.result) {
            return {
                invoice_id: result.result.invoice_id,
                pay_url: result.result.pay_url,
                amount: result.result.amount,
                currency: result.result.asset
            };
        } else {
            throw new Error(result.error || 'Ошибка создания счета');
        }
    } catch (error) {
        // Fallback для демо
        return {
            invoice_id: `demo_${Date.now()}`,
            pay_url: 'https://t.me/CryptoBot',
            amount: amount.toString(),
            currency: currency
        };
    }
}

async function createXrocketInvoice(amount, currency = 'USDT') {
    try {
        const response = await fetch(`${XROCKET_API_URL}/createInvoice`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${XROCKET_API_KEY}`
            },
            body: JSON.stringify({
                userId: currentUser.id,
                amount: amount,
                currency: currency,
                description: `Deposit for user ${currentUser.id} in Stash Casino`
            })
        });
        
        if (!response.ok) {
            throw new Error('Ошибка сервера xRocket');
        }
        
        const result = await response.json();
        
        if (result.success && result.data) {
            return result.data;
        } else {
            throw new Error(result.error || 'Ошибка создания счета');
        }
    } catch (error) {
        // Fallback для демо
        return {
            invoice_id: `demo_${Date.now()}`,
            pay_url: 'https://t.me/xrocketbot',
            amount: amount.toString(),
            currency: currency
        };
    }
}

async function transferCryptoBot(userId, amount, currency = 'USDT') {
    try {
        const response = await fetch(`${CRYPTO_BOT_API}/transfer`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Crypto-Pay-API-Token': CRYPTO_BOT_TOKEN
            },
            body: JSON.stringify({
                user_id: userId,
                asset: currency,
                amount: amount.toString(),
                spend_id: `withdraw_${Date.now()}`,
                comment: 'Withdrawal from Stash Casino'
            })
        });
        
        return await response.json();
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

async function transferXrocket(userId, amount, currency = 'USDT') {
    try {
        const response = await fetch(`${XROCKET_API_URL}/transfer`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${XROCKET_API_KEY}`
            },
            body: JSON.stringify({
                userId: userId,
                amount: amount,
                currency: currency,
                description: 'Withdrawal from Stash Casino'
            })
        });
        
        return await response.json();
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// === КРИПТО КОШЕЛЕК ===
function initCryptoWallet() {
    const walletModal = document.getElementById('walletModal');
    const walletOverlay = document.getElementById('walletOverlay');
    const closeWalletBtn = document.getElementById('closeWalletBtn');
    const walletBackBtn = document.getElementById('walletBackBtn');
    
    if (walletModal && walletOverlay) {
        walletOverlay.addEventListener('click', closeWalletModal);
    }
    
    if (closeWalletBtn) {
        closeWalletBtn.addEventListener('click', closeWalletModal);
    }
    
    if (walletBackBtn) {
        walletBackBtn.addEventListener('click', () => {
            document.getElementById('walletMain').style.display = 'block';
            document.getElementById('walletDepositDetails').style.display = 'none';
            document.getElementById('walletWithdrawDetails').style.display = 'none';
            walletBackBtn.style.display = 'none';
            closeWalletBtn.style.display = 'block';
        });
    }
    
    const walletTabs = document.querySelectorAll('.wallet-tab-btn');
    walletTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');
            switchWalletTab(tabName);
        });
    });
    
    // Обработчики для выбора платежной системы
    document.querySelectorAll('.payment-method-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.payment-method-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });
    
    const createDepositBtn = document.getElementById('createDepositBtn');
    if (createDepositBtn) {
        createDepositBtn.addEventListener('click', createInvoiceHandler);
    }
    
    const createWithdrawBtn = document.getElementById('createWithdrawBtn');
    if (createWithdrawBtn) {
        createWithdrawBtn.addEventListener('click', createWithdrawRequest);
    }
}

function openWalletModal() {
    const walletModal = document.getElementById('walletModal');
    const walletOverlay = document.getElementById('walletOverlay');
    
    if (walletModal && walletOverlay) {
        walletModal.style.display = 'block';
        walletOverlay.style.display = 'block';
        
        document.getElementById('walletMain').style.display = 'block';
        document.getElementById('walletDepositDetails').style.display = 'none';
        document.getElementById('walletWithdrawDetails').style.display = 'none';
        
        document.getElementById('walletBackBtn').style.display = 'none';
        document.getElementById('closeWalletBtn').style.display = 'block';
        
        // Обновляем баланс для вывода
        const balanceDisplay = document.getElementById('withdrawBalanceAmount');
        if (balanceDisplay) balanceDisplay.textContent = `${formatBalance(currentUser.balance)}$`;
        
        loadWalletHistory();
        
        setTimeout(() => {
            walletModal.style.opacity = '1';
            walletModal.style.transform = 'translateY(0)';
            walletOverlay.style.opacity = '1';
        }, 10);
    }
}

function closeWalletModal() {
    const walletModal = document.getElementById('walletModal');
    const walletOverlay = document.getElementById('walletOverlay');
    
    if (walletModal && walletOverlay) {
        walletModal.style.opacity = '0';
        walletModal.style.transform = 'translateY(20px)';
        walletOverlay.style.opacity = '0';
        
        setTimeout(() => {
            walletModal.style.display = 'none';
            walletOverlay.style.display = 'none';
        }, 300);
    }
}

function switchWalletTab(tabName) {
    document.querySelectorAll('.wallet-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    const activeTab = document.querySelector(`.wallet-tab-btn[data-tab="${tabName}"]`);
    if (activeTab) activeTab.classList.add('active');
    
    document.querySelectorAll('.wallet-tab-content').forEach(content => {
        content.style.display = 'none';
    });
    
    const tabContent = document.getElementById(`${tabName}Tab`);
    if (tabContent) tabContent.style.display = 'block';
    
    if (tabName === 'history') {
        loadWalletHistory();
    }
}

function openDepositDetails() {
    document.getElementById('walletMain').style.display = 'none';
    document.getElementById('walletDepositDetails').style.display = 'block';
    
    document.getElementById('walletBackBtn').style.display = 'block';
    document.getElementById('closeWalletBtn').style.display = 'none';
    
    const depositInput = document.getElementById('depositCryptoAmount');
    if (depositInput) depositInput.value = '0.50';
}

function openWithdrawDetails() {
    document.getElementById('walletMain').style.display = 'none';
    document.getElementById('walletWithdrawDetails').style.display = 'block';
    
    document.getElementById('walletBackBtn').style.display = 'block';
    document.getElementById('closeWalletBtn').style.display = 'none';
    
    const balanceDisplay = document.getElementById('withdrawBalanceAmount');
    const withdrawInput = document.getElementById('withdrawCryptoAmount');
    
    if (balanceDisplay) balanceDisplay.textContent = `${formatBalance(currentUser.balance)}$`;
    if (withdrawInput) {
        withdrawInput.value = '2.00';
        withdrawInput.max = currentUser.balance;
    }
}

async function createInvoiceHandler() {
    // Проверка на Telegram Web App
    if (!requireTelegramWebApp()) {
        showToast('Пополнение доступно только в Telegram Web App', 'info');
        return;
    }
    
    const amount = parseFloat(document.getElementById('depositCryptoAmount').value);
    const method = document.querySelector('.payment-method-btn.active')?.dataset?.method || 'cryptobot';
    
    if (isNaN(amount) || amount < 0.50) {
        showToast('Минимальная сумма депозита: 0.50$', 'info');
        return;
    }
    
    const createBtn = document.getElementById('createDepositBtn');
    const originalText = createBtn.innerHTML;
    createBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Создание счета...';
    createBtn.disabled = true;
    
    try {
        let invoice;
        
        if (method === 'cryptobot') {
            invoice = await createCryptoBotInvoice(amount, 'USDT');
        } else {
            invoice = await createXrocketInvoice(amount, 'USDT');
        }
        
        if (invoice) {
            showToast(`Счет на оплату создан! Сумма: ${amount}$`, 'info', 3000);
            
            saveTransaction(amount, 'deposit_pending', `Счет на оплату ${amount}$ (${method})`, {
                invoice_id: invoice.invoice_id,
                status: 'pending',
                method: method
            });
            
            // Открываем ссылку для оплаты
            if (window.Telegram?.WebApp && invoice.pay_url) {
                const tg = window.Telegram.WebApp;
                tg.openTelegramLink(invoice.pay_url);
            }
            
            closeWalletModal();
        }
        
    } catch (error) {
        showToast('Ошибка при создании счета: ' + error.message, 'info');
    } finally {
        setTimeout(() => {
            createBtn.innerHTML = originalText;
            createBtn.disabled = false;
        }, 2000);
    }
}

async function createWithdrawRequest() {
    const amount = parseFloat(document.getElementById('withdrawCryptoAmount').value);
    const method = document.querySelector('.payment-method-btn.active')?.dataset?.method || 'cryptobot';
    
    if (isNaN(amount) || amount < 2.00) {
        showToast('Минимальная сумма вывода: 2.00$', 'info');
        return;
    }
    
    if (currentUser.balance < amount) {
        showToast('Недостаточно средств', 'info');
        return;
    }
    
    // Проверяем, что пользователь в Telegram Web App для вывода
    if (!isTelegramWebApp()) {
        showToast('Вывод доступен только в Telegram Web App', 'info');
        return;
    }
    
    const createBtn = document.getElementById('createWithdrawBtn');
    const originalText = createBtn.innerHTML;
    createBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Обработка...';
    createBtn.disabled = true;
    
    try {
        // Резервируем средства
        currentUser.balance -= amount;
        updateUserDisplay();
        saveUserData();
        
        let transferResult;
        
        if (method === 'cryptobot') {
            transferResult = await transferCryptoBot(currentUser.id, amount, 'USDT');
        } else {
            transferResult = await transferXrocket(currentUser.id, amount, 'USDT');
        }
        
        if (transferResult.ok || transferResult.success) {
            showToast('Заявка на вывод создана! Деньги будут зачислены в течение 5 минут.', 'info', 3000);
            
            saveTransaction(-amount, 'withdraw_completed', `Вывод ${amount}$ (${method})`, {
                status: 'completed',
                method: method
            });
        } else {
            // Возвращаем средства если ошибка
            currentUser.balance += amount;
            updateUserDisplay();
            saveUserData();
            
            showToast('Ошибка при создании заявки на вывод: ' + (transferResult.error || 'Неизвестная ошибка'), 'info');
        }
        
        setTimeout(() => {
            closeWalletModal();
        }, 2000);
        
    } catch (error) {
        // Возвращаем средства если ошибка
        currentUser.balance += amount;
        updateUserDisplay();
        saveUserData();
        
        showToast('Ошибка при создании заявки: ' + error.message, 'info');
    } finally {
        setTimeout(() => {
            createBtn.innerHTML = originalText;
            createBtn.disabled = false;
        }, 2000);
    }
}

function loadWalletHistory() {
    const transactions = JSON.parse(localStorage.getItem(`transactions_${currentUser.id}`) || '[]');
    const container = document.getElementById('walletHistoryList');
    
    if (!container) return;
    
    container.innerHTML = '';
    
    const recentTransactions = transactions.slice(-20).reverse();
    
    if (recentTransactions.length === 0) {
        container.innerHTML = `
            <div class="empty-history">
                <i class="fas fa-history"></i>
                <div>История транзакций пуста</div>
            </div>
        `;
        return;
    }
    
    recentTransactions.forEach(tx => {
        const item = document.createElement('div');
        item.className = 'wallet-history-item';
        
        const icon = tx.amount > 0 ? 'arrow-down' : 'arrow-up';
        const typeClass = tx.amount > 0 ? 'deposit' : 'withdraw';
        const amountSign = tx.amount > 0 ? '+' : '';
        const status = tx.metadata?.status || 'completed';
        
        let statusBadge = '';
        if (status === 'pending') {
            statusBadge = '<span class="status-badge pending">Ожидает</span>';
        } else if (status === 'completed') {
            statusBadge = '<span class="status-badge completed">Выполнено</span>';
        }
        
        item.innerHTML = `
            <div class="wallet-history-icon ${typeClass}">
                <i class="fas fa-${icon}"></i>
            </div>
            <div class="wallet-history-details">
                <div class="wallet-history-type">${tx.description}</div>
                <div class="wallet-history-date">${new Date(tx.timestamp).toLocaleString('ru-RU')}</div>
            </div>
            <div class="wallet-history-amount">
                <div class="amount ${typeClass}">${amountSign}${formatBalance(tx.amount)}$</div>
                ${statusBadge}
            </div>
        `;
        
        container.appendChild(item);
    });
}

function saveTransaction(amount, type, description, metadata = {}) {
    const tx = {
        id: Date.now(),
        amount: amount,
        type: type,
        description: description,
        timestamp: new Date().toISOString(),
        metadata: metadata
    };
    
    const transactions = JSON.parse(localStorage.getItem(`transactions_${currentUser.id}`) || '[]');
    transactions.push(tx);
    localStorage.setItem(`transactions_${currentUser.id}`, JSON.stringify(transactions));
    
    if (document.getElementById('walletHistoryList')) {
        loadWalletHistory();
    }
}

// === БОНУСЫ ===
let isBonusProcessing = false;

function claimDailyBonus() {
    if (isBonusProcessing) return;
    
    playSound('click');
    isBonusProcessing = true;
    
    if (currentUser.balance > 0.05) {
        showToast('Бонус доступен только при балансе менее 0.05$', 'info');
        isBonusProcessing = false;
        return;
    }
    
    const bonusBtn = document.getElementById('dailyBonusBtn');
    bonusBtn.disabled = true;
    bonusBtn.textContent = 'Обработка...';
    
    try {
        const lastBonusDate = localStorage.getItem(`last_bonus_${currentUser.id}`);
        const today = new Date().toDateString();
        
        if (lastBonusDate === today) {
            showToast('Вы уже получали бонус сегодня. Приходите завтра!', 'info');
            bonusBtn.disabled = false;
            bonusBtn.textContent = 'Получить бонус';
            isBonusProcessing = false;
            return;
        }
        
        const bonusAmount = 0.06 + Math.random() * 0.14;
        currentUser.balance += bonusAmount;
        
        localStorage.setItem(`last_bonus_${currentUser.id}`, today);
        
        updateUserDisplay();
        saveUserData();
        
        saveTransaction(bonusAmount, 'bonus', 'Ежедневный бонус');
        
        showToast(`Ежедневный бонус: ${formatBalance(bonusAmount)}$`, 'win');
        playSound('win');
        
        bonusBtn.textContent = 'Получено';
        bonusBtn.style.background = '#28a745';
        
    } catch (error) {
        bonusBtn.disabled = false;
        bonusBtn.textContent = 'Получить бонус';
    } finally {
        setTimeout(() => {
            isBonusProcessing = false;
        }, 2000);
    }
}

let isPromoProcessing = false;

function activatePromo() {
    if (isPromoProcessing) return;
    
    playSound('click');
    isPromoProcessing = true;
    
    const promoCode = document.getElementById('promoCode').value.trim().toUpperCase();
    
    if (!promoCode) {
        showToast('Введите промокод', 'info');
        isPromoProcessing = false;
        return;
    }
    
    const usedPromos = JSON.parse(localStorage.getItem(`used_promos_${currentUser.id}`) || '[]');
    
    if (usedPromos.includes(promoCode)) {
        showToast('Этот промокод уже использован', 'info');
        isPromoProcessing = false;
        return;
    }
    
    const validPromos = {
        'WELCOME10': 0.10,
        'BONUS2024': 0.20,
        'FREEMONEY': 0.15,
        'START05': 0.05
    };
    
    if (validPromos[promoCode]) {
        const bonusAmount = validPromos[promoCode];
        currentUser.balance += bonusAmount;
        
        usedPromos.push(promoCode);
        localStorage.setItem(`used_promos_${currentUser.id}`, JSON.stringify(usedPromos));
        
        updateUserDisplay();
        saveUserData();
        
        saveTransaction(bonusAmount, 'bonus', `Промокод: ${promoCode}`);
        
        showToast(`Промокод активирован! +${formatBalance(bonusAmount)}$`, 'win');
        playSound('win');
        
        document.getElementById('promoCode').value = '';
    } else {
        showToast('Неверный промокод', 'info');
    }
    
    setTimeout(() => {
        isPromoProcessing = false;
    }, 2000);
}

// === ПЕРЕКЛЮЧЕНИЕ СТРАНИЦ ===
function showPage(pageId) {
    playSound('click');
    
    // Обновляем навигацию
    document.querySelectorAll('.side-nav-item, .bottom-nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    if (pageId === 'mainPage') {
        const activeSideNav = document.querySelector('.side-nav-item[onclick*="mainPage"]');
        const activeBottomNav = document.querySelector('.bottom-nav-item[onclick*="mainPage"]');
        if (activeSideNav) activeSideNav.classList.add('active');
        if (activeBottomNav) activeBottomNav.classList.add('active');
    } else if (pageId === 'bonusPage') {
        const activeSideNav = document.querySelector('.side-nav-item[onclick*="bonusPage"]');
        const activeBottomNav = document.querySelector('.bottom-nav-item[onclick*="bonusPage"]');
        if (activeSideNav) activeSideNav.classList.add('active');
        if (activeBottomNav) activeBottomNav.classList.add('active');
    } else if (pageId === 'profilePage') {
        const activeSideNav = document.querySelector('.side-nav-item[onclick*="profilePage"]');
        const activeBottomNav = document.querySelector('.bottom-nav-item[onclick*="profilePage"]');
        if (activeSideNav) activeSideNav.classList.add('active');
        if (activeBottomNav) activeBottomNav.classList.add('active');
    }
    
    // Скрываем все страницы
    document.querySelectorAll('.main-content').forEach(page => {
        page.classList.remove('active');
        page.style.opacity = '0';
    });
    
    // Показываем целевую страницу
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.add('active');
        setTimeout(() => {
            targetPage.style.opacity = '1';
        }, 50);
    }
}

function openGame(game) {
    playSound('click');
    
    if (game === 'dice') {
        showPage('dicePage');
    } else if (game === 'mines') {
        showPage('minesPage');
    } else if (game === 'x50') {
        showPage('x50Page');
    } else if (game === 'crash') {
        showPage('crashPage');
    } else if (game === 'tower') {
        showToast('Игра Tower в разработке', 'info');
    } else if (game === 'plinko') {
        showToast('Игра Plinko в разработке', 'info');
    } else {
        showToast('Игра в разработке', 'info');
    }
}

function backToMain() {
    playSound('click');
    showPage('mainPage');
}

// === ЧАТ В TELEGRAM ===
function openTelegramChat() {
    playSound('click');
    
    if (window.Telegram?.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.openTelegramLink('https://t.me/StashCasinoBot');
    } else {
        window.open('https://t.me/StashCasinoBot', '_blank');
    }
}

// === ИНИЦИАЛИЗАЦИЯ ===
document.addEventListener('DOMContentLoaded', () => {
    initUser();
    
    // Добавляем обработчики клика для звуков
    document.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            playSound('click');
        });
    });
});

// === ЭКСПОРТ ФУНКЦИЙ ДЛЯ HTML ===
window.openGame = openGame;
window.showPage = showPage;
window.backToMain = backToMain;
window.selectOutcome = selectOutcome;
window.setMinBet = setMinBet;
window.setMaxBet = setMaxBet;
window.placeDiceBet = placeDiceBet;
window.openWalletModal = openWalletModal;
window.openDepositDetails = openDepositDetails;
window.openWithdrawDetails = openWithdrawDetails;
window.createInvoiceHandler = createInvoiceHandler;
window.createWithdrawRequest = createWithdrawRequest;
window.claimDailyBonus = claimDailyBonus;
window.activatePromo = activatePromo;
window.toggleSearch = openSearchModal;
window.openSearchModal = openSearchModal;
window.closeSearchModal = closeSearchModal;
window.performModalSearch = () => performModalSearch(document.getElementById('searchModalInput').value);
window.showAllGames = showAllGames;
window.filterGames = filterGames;
window.openTelegramChat = openTelegramChat;

// Mines функции
window.updateMinesBet = updateMinesBet;
window.setMinesMinBet = setMinesMinBet;
window.setMinesMaxBet = setMinesMaxBet;
window.updateMinesSlider = updateMinesSlider;
window.startMinesGame = startMinesGame;
window.cashoutMines = cashoutMines;

// X50 функции
window.updateX50Bet = updateX50Bet;
window.setX50MinBet = setX50MinBet;
window.setX50MaxBet = setX50MaxBet;
window.placeX50Bet = placeX50Bet;

// Crash функции
window.updateCrashBet = updateCrashBet;
window.setCrashMinBet = setCrashMinBet;
window.setCrashMaxBet = setCrashMaxBet;
window.placeCrashBet = placeCrashBet;
window.cashoutCrash = cashoutCrash;