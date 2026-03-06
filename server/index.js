const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const {
  createInitialState, canPlacePiece, placePiece, passTurn,
  hasValidMove, PIECE_DEFINITIONS, getAllVariations, normalizeCells,
} = require('../public/game-logic.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 静的ファイル配信
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- ルーム管理 ---
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 5; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

function getRoomBySocket(socketId) {
  for (const [code, room] of rooms) {
    const idx = room.players.findIndex(p => p.id === socketId);
    if (idx !== -1) return { code, room, playerIndex: idx };
  }
  return null;
}

// --- Socket.io ---
io.on('connection', (socket) => {
  console.log('接続:', socket.id);

  // 部屋作成
  socket.on('create-room', () => {
    // 既存の部屋から退出
    leaveCurrentRoom(socket);

    const code = generateRoomCode();
    const room = {
      players: [{ id: socket.id, isHost: true }],
      state: null,
      started: false,
    };
    rooms.set(code, room);
    socket.join(code);

    socket.emit('room-created', {
      code,
      players: room.players,
      playerIndex: 0,
    });
  });

  // 部屋参加
  socket.on('join-room', (data) => {
    const code = (data.code || '').toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      socket.emit('error', { message: '部屋が見つかりません' });
      return;
    }
    if (room.started) {
      socket.emit('error', { message: 'ゲームは既に開始されています' });
      return;
    }
    if (room.players.length >= 4) {
      socket.emit('error', { message: '部屋が満員です' });
      return;
    }

    leaveCurrentRoom(socket);

    const playerIndex = room.players.length;
    room.players.push({ id: socket.id, isHost: false });
    socket.join(code);

    socket.emit('room-joined', {
      code,
      players: room.players,
      playerIndex,
    });

    socket.to(code).emit('room-updated', {
      players: room.players,
    });
  });

  // ゲーム開始
  socket.on('start-game', (data) => {
    const info = getRoomBySocket(socket.id);
    if (!info) return;
    const { code, room } = info;

    if (room.players[0].id !== socket.id) {
      socket.emit('error', { message: 'ホストのみ開始できます' });
      return;
    }

    const playerCount = Math.min(4, Math.max(2, data.playerCount || room.players.length));
    room.state = createInitialState(playerCount);
    room.started = true;

    // 各プレイヤーにゲーム状態を送信
    room.players.forEach((p, i) => {
      io.to(p.id).emit('game-started', {
        state: room.state,
        playerIndex: i,
      });
    });
  });

  // ピース配置
  socket.on('place-piece', (data) => {
    const info = getRoomBySocket(socket.id);
    if (!info) return;
    const { code, room } = info;

    if (!room.state || room.state.gameOver) return;
    if (room.state.currentPlayer !== info.playerIndex) {
      socket.emit('error', { message: 'あなたのターンではありません' });
      return;
    }

    const { pieceId, variation, row, col } = data;

    // バリデーション: ピースが存在し、プレイヤーが持っているか
    const player = room.state.players[info.playerIndex];
    if (!player.pieces.includes(pieceId)) {
      socket.emit('error', { message: '無効なピースです' });
      return;
    }

    // バリデーション: バリエーションが有効か
    const pieceDef = PIECE_DEFINITIONS.find(p => p.id === pieceId);
    const validVariations = getAllVariations(pieceDef.cells);
    const normalizedInput = normalizeCells(variation);
    const isValidVariation = validVariations.some(
      v => JSON.stringify(v) === JSON.stringify(normalizedInput)
    );
    if (!isValidVariation) {
      socket.emit('error', { message: '無効なピースの向きです' });
      return;
    }

    // 配置可能チェック
    if (!canPlacePiece(room.state, info.playerIndex, normalizedInput, row, col)) {
      socket.emit('error', { message: 'この位置には置けません' });
      return;
    }

    room.state = placePiece(room.state, info.playerIndex, pieceId, normalizedInput, row, col);

    if (room.state.gameOver) {
      io.to(code).emit('game-over', { state: room.state });
      rooms.delete(code);
    } else {
      io.to(code).emit('game-updated', { state: room.state });
    }
  });

  // パス
  socket.on('pass-turn', () => {
    const info = getRoomBySocket(socket.id);
    if (!info) return;
    const { code, room } = info;

    if (!room.state || room.state.gameOver) return;
    if (room.state.currentPlayer !== info.playerIndex) return;

    room.state = passTurn(room.state, info.playerIndex);

    if (room.state.gameOver) {
      io.to(code).emit('game-over', { state: room.state });
      rooms.delete(code);
    } else {
      io.to(code).emit('game-updated', { state: room.state });
    }
  });

  // 退出
  socket.on('leave-room', () => {
    leaveCurrentRoom(socket);
  });

  socket.on('disconnect', () => {
    console.log('切断:', socket.id);
    leaveCurrentRoom(socket);
  });

  function leaveCurrentRoom(sock) {
    const info = getRoomBySocket(sock.id);
    if (!info) return;
    const { code, room } = info;

    room.players.splice(info.playerIndex, 1);
    sock.leave(code);

    if (room.players.length === 0) {
      rooms.delete(code);
    } else {
      if (room.started) {
        io.to(code).emit('player-left', { inGame: true });
        rooms.delete(code);
      } else {
        // ホスト権限を次のプレイヤーに
        room.players[0].isHost = true;
        io.to(code).emit('player-left', {
          inGame: false,
          players: room.players,
        });
      }
    }
  }
});

// --- サーバー起動 ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ブロックス サーバー起動: http://localhost:${PORT}`);
});
