// ブロックス メインアプリケーション
(function() {
  'use strict';

  // --- 定数 ---
  const COLOR_NAMES_JP = { blue: '青', yellow: '黄', red: '赤', green: '緑' };

  // --- DOM要素 ---
  const $ = id => document.getElementById(id);
  const screens = {
    lobby: $('lobby'),
    waiting: $('waiting'),
    cpuSetup: $('cpu-setup'),
    localSetup: $('local-setup'),
    game: $('game'),
    result: $('result'),
  };

  const boardCanvas = $('board-canvas');
  const boardCtx = boardCanvas.getContext('2d');
  const trayCanvas = $('tray-canvas');
  const trayCtx = trayCanvas.getContext('2d');

  // --- 状態 ---
  let socket = null;
  let gameState = null;
  let myPlayerIndex = -1;
  let isLocalGame = false;
  let isOnline = false;
  let isCpuGame = false;
  let cpuDifficulty = 'normal';
  let aiThinking = false;
  let roomCode = '';

  // 選択中のピース
  let selectedPieceId = null;
  let currentPieceCells = null; // 現在の回転/反転状態のセル
  let previewRow = -1;
  let previewCol = -1;
  let canPlace = false;

  // ボード描画
  let cellSize = 16;
  let boardOffsetX = 0;
  let boardOffsetY = 0;

  // トレイ
  let trayPieces = [];
  let trayCellSize = 14;

  // --- 安全なDOM操作ヘルパー ---
  function createPlayerItem(colorValue, label) {
    const div = document.createElement('div');
    div.className = 'player-item';
    const dot = document.createElement('span');
    dot.className = 'color-dot';
    dot.style.background = colorValue;
    const text = document.createElement('span');
    text.textContent = label;
    div.appendChild(dot);
    div.appendChild(text);
    return div;
  }

  function createColorDot(colorValue) {
    const dot = document.createElement('span');
    dot.className = 'color-dot';
    dot.style.background = colorValue;
    return dot;
  }

  // --- 画面切替 ---
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // --- Socket.io 接続 ---
  function connectSocket() {
    if (socket) return;
    socket = io();

    socket.on('room-created', (data) => {
      roomCode = data.code;
      $('room-code-display').textContent = data.code;
      showScreen('waiting');
      updateWaitingRoom(data);
    });

    socket.on('room-joined', (data) => {
      roomCode = data.code;
      $('room-code-display').textContent = data.code;
      myPlayerIndex = data.playerIndex;
      showScreen('waiting');
      updateWaitingRoom(data);
    });

    socket.on('room-updated', (data) => {
      updateWaitingRoom(data);
    });

    socket.on('game-started', (data) => {
      gameState = data.state;
      myPlayerIndex = data.playerIndex;
      isOnline = true;
      isLocalGame = false;
      isCpuGame = false;
      startGame();
    });

    socket.on('game-updated', (data) => {
      gameState = data.state;
      selectedPieceId = null;
      currentPieceCells = null;
      render();
    });

    socket.on('game-over', (data) => {
      gameState = data.state;
      showResults();
    });

    socket.on('error', (data) => {
      alert(data.message);
    });

    socket.on('player-left', (data) => {
      if (data.inGame) {
        alert('プレイヤーが退出しました');
        showScreen('lobby');
      } else {
        updateWaitingRoom(data);
      }
    });
  }

  function updateWaitingRoom(data) {
    const list = $('player-list');
    list.textContent = '';
    const players = data.players || [];
    players.forEach((p, i) => {
      const label = 'プレイヤー ' + (i + 1) + (p.isHost ? ' (ホスト)' : '');
      list.appendChild(createPlayerItem(COLOR_VALUES[COLORS[i]], label));
    });

    const isHost = players.length > 0 && players[0].id === socket.id;
    const countSelect = $('player-count');
    countSelect.disabled = !isHost;
    $('btn-start').disabled = !(isHost && players.length >= 2);
  }

  // --- ロビーイベント ---
  $('btn-create').addEventListener('click', () => {
    connectSocket();
    socket.emit('create-room');
  });

  $('btn-join').addEventListener('click', () => {
    const code = $('room-code-input').value.trim().toUpperCase();
    if (code.length < 4) {
      alert('部屋コードを入力してください');
      return;
    }
    connectSocket();
    socket.emit('join-room', { code });
  });

  $('btn-start').addEventListener('click', () => {
    const count = parseInt($('player-count').value);
    socket.emit('start-game', { playerCount: count });
  });

  $('btn-leave').addEventListener('click', () => {
    socket.emit('leave-room');
    showScreen('lobby');
  });

  // --- コンピューター対戦 ---
  $('btn-cpu').addEventListener('click', () => {
    showScreen('cpuSetup');
  });

  $('btn-cpu-back').addEventListener('click', () => {
    showScreen('lobby');
  });

  // 難易度ボタン
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      cpuDifficulty = btn.getAttribute('data-diff');
    });
  });

  $('btn-cpu-start').addEventListener('click', () => {
    const count = parseInt($('cpu-player-count').value);
    gameState = createInitialState(count);
    myPlayerIndex = 0;
    isLocalGame = false;
    isOnline = false;
    isCpuGame = true;
    aiThinking = false;
    startGame();
  });

  // --- ローカル対戦 ---
  $('btn-local').addEventListener('click', () => {
    showScreen('localSetup');
  });

  $('btn-local-back').addEventListener('click', () => {
    showScreen('lobby');
  });

  $('btn-local-start').addEventListener('click', () => {
    const count = parseInt($('local-player-count').value);
    gameState = createInitialState(count);
    myPlayerIndex = 0;
    isLocalGame = true;
    isOnline = false;
    isCpuGame = false;
    startGame();
  });

  $('btn-back-lobby').addEventListener('click', () => {
    showScreen('lobby');
  });

  // --- ゲーム操作 ---
  $('btn-rotate').addEventListener('click', () => {
    if (aiThinking) return;
    if (!selectedPieceId || !currentPieceCells) return;
    // 90度時計回り回転
    currentPieceCells = rotateOnce(currentPieceCells);
    render();
  });

  $('btn-flip').addEventListener('click', () => {
    if (aiThinking) return;
    if (!selectedPieceId || !currentPieceCells) return;
    // 左右反転
    currentPieceCells = flipOnce(currentPieceCells);
    render();
  });

  $('btn-pass').addEventListener('click', () => {
    if (aiThinking) return;
    if (!gameState || gameState.gameOver) return;

    const pi = getCurrentHumanPlayer();
    if (gameState.currentPlayer !== pi) return;

    if (isOnline) {
      socket.emit('pass-turn');
    } else {
      gameState = passTurn(gameState, pi);
      selectedPieceId = null;
      currentPieceCells = null;
      if (gameState.gameOver) {
        showResults();
      } else {
        render();
        if (isCpuGame) scheduleAiTurn();
      }
    }
  });

  // 現在のプレイヤーインデックスを取得
  function getCurrentHumanPlayer() {
    if (isLocalGame) return gameState.currentPlayer;
    return myPlayerIndex;
  }

  // --- AIターン処理 ---
  function isAiTurn() {
    if (!isCpuGame || !gameState || gameState.gameOver) return false;
    return gameState.currentPlayer !== myPlayerIndex;
  }

  function scheduleAiTurn() {
    if (!isAiTurn()) return;

    aiThinking = true;
    render();

    // 少し遅延させて「考えている」感を出す
    const delay = cpuDifficulty === 'easy' ? 400 : cpuDifficulty === 'normal' ? 700 : 1000;
    setTimeout(() => {
      executeAiTurn();
    }, delay);
  }

  function executeAiTurn() {
    if (!gameState || gameState.gameOver) {
      aiThinking = false;
      return;
    }

    const pi = gameState.currentPlayer;
    const move = BlokusAI.getMove(gameState, pi, cpuDifficulty);

    if (move) {
      gameState = placePiece(gameState, pi, move.pieceId, move.variation, move.row, move.col);
    } else {
      gameState = passTurn(gameState, pi);
    }

    aiThinking = false;

    if (gameState.gameOver) {
      render();
      setTimeout(() => showResults(), 500);
      return;
    }

    render();

    // 次もAIターンなら連続実行
    if (isAiTurn()) {
      scheduleAiTurn();
    }
  }

  // --- ゲーム開始 ---
  function startGame() {
    showScreen('game');
    selectedPieceId = null;
    currentPieceCells = null;
    aiThinking = false;
    resizeCanvases();
    render();

    // CPU対戦で最初からAIターンの場合
    if (isCpuGame && isAiTurn()) {
      scheduleAiTurn();
    }
  }

  // --- Canvas サイズ ---
  function resizeCanvases() {
    const container = $('board-container');
    const w = container.clientWidth;
    const h = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    cellSize = Math.floor(Math.min(w, h) / (BOARD_SIZE + 1));
    const boardPixels = cellSize * BOARD_SIZE;

    boardCanvas.width = w * dpr;
    boardCanvas.height = h * dpr;
    boardCanvas.style.width = w + 'px';
    boardCanvas.style.height = h + 'px';
    boardCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    boardOffsetX = Math.floor((w - boardPixels) / 2);
    boardOffsetY = Math.floor((h - boardPixels) / 2);

    // トレイ
    const trayH = trayCanvas.parentElement.clientHeight;
    trayCellSize = Math.floor(trayH / 7);

    trayCanvas.height = trayH * dpr;
    trayCanvas.style.height = trayH + 'px';
    trayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  window.addEventListener('resize', () => {
    if (screens.game.classList.contains('active')) {
      resizeCanvases();
      render();
    }
  });

  // --- 描画 ---
  function render() {
    if (!gameState) return;
    drawBoard();
    drawTray();
    updateHeader();
  }

  function drawBoard() {
    const w = boardCanvas.clientWidth;
    const h = boardCanvas.clientHeight;
    boardCtx.clearRect(0, 0, w, h);

    const boardPixels = cellSize * BOARD_SIZE;

    // ボード背景
    boardCtx.fillStyle = '#ddd';
    boardCtx.fillRect(boardOffsetX, boardOffsetY, boardPixels, boardPixels);

    // グリッド線
    boardCtx.strokeStyle = '#bbb';
    boardCtx.lineWidth = 0.5;
    for (let i = 0; i <= BOARD_SIZE; i++) {
      boardCtx.beginPath();
      boardCtx.moveTo(boardOffsetX + i * cellSize, boardOffsetY);
      boardCtx.lineTo(boardOffsetX + i * cellSize, boardOffsetY + boardPixels);
      boardCtx.stroke();
      boardCtx.beginPath();
      boardCtx.moveTo(boardOffsetX, boardOffsetY + i * cellSize);
      boardCtx.lineTo(boardOffsetX + boardPixels, boardOffsetY + i * cellSize);
      boardCtx.stroke();
    }

    // コーナーマーカー
    const corners = [
      [0, 0], [0, BOARD_SIZE - 1],
      [BOARD_SIZE - 1, BOARD_SIZE - 1], [BOARD_SIZE - 1, 0]
    ];
    corners.forEach((c, i) => {
      if (i < gameState.playerCount) {
        const x = boardOffsetX + c[1] * cellSize;
        const y = boardOffsetY + c[0] * cellSize;
        boardCtx.fillStyle = COLOR_VALUES[COLORS[i]] + '40';
        boardCtx.fillRect(x, y, cellSize, cellSize);
      }
    });

    // 配置済みピース
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const color = gameState.board[r][c];
        if (color) {
          const x = boardOffsetX + c * cellSize;
          const y = boardOffsetY + r * cellSize;
          boardCtx.fillStyle = COLOR_VALUES[color];
          boardCtx.fillRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
          boardCtx.fillStyle = 'rgba(255,255,255,0.15)';
          boardCtx.fillRect(x + 0.5, y + 0.5, cellSize - 1, 2);
          boardCtx.fillRect(x + 0.5, y + 0.5, 2, cellSize - 1);
        }
      }
    }

    // プレビュー
    if (selectedPieceId && currentPieceCells && previewRow >= 0 && previewCol >= 0) {
      const pi = getCurrentHumanPlayer();
      const color = gameState.players[pi].color;
      canPlace = canPlacePiece(gameState, pi, currentPieceCells, previewRow, previewCol);

      for (const [r, c] of currentPieceCells) {
        const ar = previewRow + r;
        const ac = previewCol + c;
        if (ar >= 0 && ar < BOARD_SIZE && ac >= 0 && ac < BOARD_SIZE) {
          const x = boardOffsetX + ac * cellSize;
          const y = boardOffsetY + ar * cellSize;
          boardCtx.fillStyle = canPlace
            ? COLOR_VALUES[color] + '80'
            : '#ff000050';
          boardCtx.fillRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
        }
      }
    }
  }

  function drawTray() {
    if (!gameState) return;
    const pi = isCpuGame ? myPlayerIndex : (isLocalGame ? gameState.currentPlayer : myPlayerIndex);
    const player = gameState.players[pi];
    const pieces = player.pieces;

    trayPieces = [];
    let offsetX = 10;
    const padding = 8;

    for (const pieceId of pieces) {
      const def = PIECE_DEFINITIONS.find(p => p.id === pieceId);
      const cells = normalizeCells(def.cells);
      const maxR = Math.max(...cells.map(([r]) => r)) + 1;
      const maxC = Math.max(...cells.map(([, c]) => c)) + 1;
      const pieceW = maxC * trayCellSize;
      const pieceH = maxR * trayCellSize;

      trayPieces.push({
        id: pieceId,
        cells,
        x: offsetX,
        y: Math.floor((trayCanvas.clientHeight - pieceH) / 2),
        w: pieceW,
        h: pieceH,
      });

      offsetX += pieceW + padding;
    }

    const totalWidth = offsetX + 10;
    const dpr = window.devicePixelRatio || 1;
    trayCanvas.width = Math.max(totalWidth, trayCanvas.parentElement.clientWidth) * dpr;
    trayCanvas.style.width = Math.max(totalWidth, trayCanvas.parentElement.clientWidth) + 'px';
    trayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    trayCtx.clearRect(0, 0, trayCanvas.clientWidth, trayCanvas.clientHeight);

    const color = COLOR_VALUES[player.color];

    for (const tp of trayPieces) {
      const isSelected = tp.id === selectedPieceId;

      if (isSelected) {
        trayCtx.fillStyle = 'rgba(255,255,255,0.1)';
        trayCtx.fillRect(tp.x - 4, tp.y - 4, tp.w + 8, tp.h + 8);
        trayCtx.strokeStyle = '#fff';
        trayCtx.lineWidth = 2;
        trayCtx.strokeRect(tp.x - 4, tp.y - 4, tp.w + 8, tp.h + 8);
      }

      for (const [r, c] of tp.cells) {
        const x = tp.x + c * trayCellSize;
        const y = tp.y + r * trayCellSize;
        trayCtx.fillStyle = color;
        trayCtx.fillRect(x + 0.5, y + 0.5, trayCellSize - 1, trayCellSize - 1);
        trayCtx.fillStyle = 'rgba(255,255,255,0.15)';
        trayCtx.fillRect(x + 0.5, y + 0.5, trayCellSize - 1, 1.5);
        trayCtx.fillRect(x + 0.5, y + 0.5, 1.5, trayCellSize - 1);
      }
    }
  }

  function updateHeader() {
    const pi = gameState.currentPlayer;
    const player = gameState.players[pi];
    const colorJP = COLOR_NAMES_JP[player.color];

    const turnEl = $('turn-indicator');
    turnEl.textContent = '';
    turnEl.appendChild(createColorDot(COLOR_VALUES[player.color]));

    const turnText = document.createElement('span');
    if (isCpuGame && pi !== myPlayerIndex) {
      turnText.textContent = colorJP + ' (CPU)';
    } else {
      turnText.textContent = colorJP + 'のターン';
    }
    turnEl.appendChild(turnText);

    // AI思考中表示
    if (aiThinking) {
      const thinkEl = document.createElement('span');
      thinkEl.className = 'ai-thinking';
      thinkEl.textContent = '考え中...';
      turnEl.appendChild(thinkEl);
    }

    const remaining = player.pieces.length;
    $('game-info').textContent = '残り ' + remaining + ' ピース';
  }

  // --- ボードタッチ/クリック ---
  boardCanvas.addEventListener('pointerdown', (e) => {
    if (aiThinking) return;
    e.preventDefault();
    const rect = boardCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const col = Math.floor((x - boardOffsetX) / cellSize);
    const row = Math.floor((y - boardOffsetY) / cellSize);

    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return;

    if (selectedPieceId && currentPieceCells) {
      previewRow = row;
      previewCol = col;

      const pi = getCurrentHumanPlayer();

      if (gameState.currentPlayer !== pi && !isLocalGame) return;

      if (canPlacePiece(gameState, pi, currentPieceCells, row, col)) {
        if (isOnline) {
          socket.emit('place-piece', {
            pieceId: selectedPieceId,
            variation: currentPieceCells,
            row,
            col,
          });
        } else {
          gameState = placePiece(gameState, pi, selectedPieceId, currentPieceCells, row, col);
          if (gameState.gameOver) {
            showResults();
            return;
          }
        }
        selectedPieceId = null;
        currentPieceCells = null;
        previewRow = -1;
        previewCol = -1;

        render();

        // CPU対戦: 人間の手の後にAIターンを開始
        if (isCpuGame && isAiTurn()) {
          scheduleAiTurn();
        }
        return;
      }
      render();
    }
  });

  boardCanvas.addEventListener('pointermove', (e) => {
    if (aiThinking) return;
    if (!selectedPieceId || !currentPieceCells) return;
    e.preventDefault();
    const rect = boardCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const col = Math.floor((x - boardOffsetX) / cellSize);
    const row = Math.floor((y - boardOffsetY) / cellSize);

    if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
      previewRow = row;
      previewCol = col;
      render();
    }
  });

  // --- トレイタッチ ---
  function handleTrayTap(clientX, clientY) {
    if (aiThinking) return;
    const rect = trayCanvas.getBoundingClientRect();
    const x = clientX - rect.left + trayCanvas.parentElement.scrollLeft;
    const y = clientY - rect.top;

    for (const tp of trayPieces) {
      if (x >= tp.x - 4 && x <= tp.x + tp.w + 4 &&
          y >= tp.y - 4 && y <= tp.y + tp.h + 4) {
        if (selectedPieceId === tp.id) {
          selectedPieceId = null;
          currentPieceCells = null;
        } else {
          selectedPieceId = tp.id;
          const def = PIECE_DEFINITIONS.find(p => p.id === tp.id);
          currentPieceCells = normalizeCells(def.cells);
        }
        previewRow = -1;
        previewCol = -1;
        render();
        return;
      }
    }
  }

  // 二重発火防止用タイムスタンプ
  let lastTrayTapTime = 0;
  function guardedTrayTap(clientX, clientY) {
    const now = Date.now();
    if (now - lastTrayTapTime < 300) return;
    lastTrayTapTime = now;
    handleTrayTap(clientX, clientY);
  }

  // clickイベントはモバイルでも確実に発火する
  trayCanvas.addEventListener('click', (e) => {
    guardedTrayTap(e.clientX, e.clientY);
  });

  // touchendフォールバック（clickが発火しないケースに対応）
  let trayTouchStart = null;
  trayCanvas.parentElement.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      trayTouchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, { passive: true });
  trayCanvas.parentElement.addEventListener('touchend', (e) => {
    if (!trayTouchStart || e.changedTouches.length === 0) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - trayTouchStart.x;
    const dy = touch.clientY - trayTouchStart.y;
    trayTouchStart = null;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
    guardedTrayTap(touch.clientX, touch.clientY);
  }, { passive: true });

  // --- 結果表示 ---
  function showResults() {
    const container = $('result-scores');
    container.textContent = '';

    const sorted = gameState.players
      .map((p, i) => ({ ...p, index: i }))
      .sort((a, b) => b.score - a.score);

    const bestScore = sorted[0].score;

    sorted.forEach((p) => {
      const div = document.createElement('div');
      div.className = 'score-row' + (p.score === bestScore ? ' winner' : '');

      const dot = document.createElement('span');
      dot.className = 'color-dot';
      dot.style.background = COLOR_VALUES[p.color];

      const name = document.createElement('span');
      name.className = 'name';
      let nameText = COLOR_NAMES_JP[p.color];
      if (isCpuGame && p.index !== myPlayerIndex) {
        nameText += ' (CPU)';
      }
      if (p.score === bestScore) {
        nameText += ' \uD83C\uDFC6';
      }
      name.textContent = nameText;

      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = (p.score > 0 ? '+' : '') + p.score + '点';

      div.appendChild(dot);
      div.appendChild(name);
      div.appendChild(score);
      container.appendChild(div);
    });

    showScreen('result');
  }

  // --- 初期化 ---
  showScreen('lobby');
})();
