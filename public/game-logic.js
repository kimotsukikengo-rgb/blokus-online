// ブロックス ゲームロジック（クライアント・サーバー共有）

const BOARD_SIZE = 20;
const COLORS = ['blue', 'yellow', 'red', 'green'];
const COLOR_VALUES = {
  blue: '#0066CC',
  yellow: '#FFD700',
  red: '#CC0000',
  green: '#009933'
};

// 21種類のピース定義（各ピースはセルの相対座標配列）
const PIECE_DEFINITIONS = [
  // 1マス (1個)
  { id: 'I1', cells: [[0,0]] },
  // 2マス (1個)
  { id: 'I2', cells: [[0,0],[1,0]] },
  // 3マス (2個)
  { id: 'I3', cells: [[0,0],[1,0],[2,0]] },
  { id: 'L3', cells: [[0,0],[1,0],[1,1]] },
  // 4マス (5個)
  { id: 'I4', cells: [[0,0],[1,0],[2,0],[3,0]] },
  { id: 'L4', cells: [[0,0],[1,0],[2,0],[2,1]] },
  { id: 'T4', cells: [[0,0],[1,0],[2,0],[1,1]] },
  { id: 'O4', cells: [[0,0],[1,0],[0,1],[1,1]] },
  { id: 'S4', cells: [[1,0],[2,0],[0,1],[1,1]] },
  // 5マス (12個)
  { id: 'I5', cells: [[0,0],[1,0],[2,0],[3,0],[4,0]] },
  { id: 'L5', cells: [[0,0],[1,0],[2,0],[3,0],[3,1]] },
  { id: 'Y5', cells: [[0,0],[1,0],[2,0],[3,0],[1,1]] },
  { id: 'N5', cells: [[1,0],[2,0],[3,0],[0,1],[1,1]] },
  { id: 'P5', cells: [[0,0],[1,0],[2,0],[1,1],[2,1]] },
  { id: 'F5', cells: [[1,0],[2,0],[0,1],[1,1],[1,2]] },
  { id: 'T5', cells: [[0,0],[1,0],[2,0],[1,1],[1,2]] },
  { id: 'U5', cells: [[0,0],[2,0],[0,1],[1,1],[2,1]] },
  { id: 'V5', cells: [[0,0],[1,0],[2,0],[2,1],[2,2]] },
  { id: 'W5', cells: [[0,0],[1,0],[1,1],[2,1],[2,2]] },
  { id: 'X5', cells: [[1,0],[0,1],[1,1],[2,1],[1,2]] },
  { id: 'Z5', cells: [[0,0],[1,0],[1,1],[1,2],[2,2]] },
];

// ピースの回転（90度時計回り）
function rotateCells(cells) {
  return cells.map(([r, c]) => [c, -r]);
}

// ピースの反転（左右ミラー）
function flipCells(cells) {
  return cells.map(([r, c]) => [r, -c]);
}

// セルを正規化（最小座標が0,0になるようにシフト）
function normalizeCells(cells) {
  const minR = Math.min(...cells.map(([r]) => r));
  const minC = Math.min(...cells.map(([, c]) => c));
  const normalized = cells.map(([r, c]) => [r - minR, c - minC]);
  // ソートして一意にする
  normalized.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return normalized;
}

// ピースの全バリエーション（回転・反転）を取得
function getAllVariations(cells) {
  const variations = [];
  const seen = new Set();
  let current = cells;

  for (let flip = 0; flip < 2; flip++) {
    for (let rot = 0; rot < 4; rot++) {
      const norm = normalizeCells(current);
      const key = JSON.stringify(norm);
      if (!seen.has(key)) {
        seen.add(key);
        variations.push(norm);
      }
      current = rotateCells(current);
    }
    current = flipCells(cells);
  }
  return variations;
}

// 回転と反転を独立操作するための関数
// 現在のセルを90度回転して正規化
function rotateOnce(cells) {
  return normalizeCells(rotateCells(cells));
}

// 現在のセルを左右反転して正規化
function flipOnce(cells) {
  return normalizeCells(flipCells(cells));
}

// ゲーム状態の初期化
function createInitialState(playerCount) {
  const board = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null)
  );

  const players = [];
  for (let i = 0; i < playerCount; i++) {
    players.push({
      color: COLORS[i],
      pieces: PIECE_DEFINITIONS.map(p => p.id),
      passed: false,
      score: 0,
    });
  }

  // 各プレイヤーのスタートコーナー
  const corners = [
    [0, 0],                           // 青: 左上
    [0, BOARD_SIZE - 1],              // 黄: 右上
    [BOARD_SIZE - 1, BOARD_SIZE - 1], // 赤: 右下
    [BOARD_SIZE - 1, 0],              // 緑: 左下
  ];

  return {
    board,
    players,
    currentPlayer: 0,
    playerCount,
    corners: corners.slice(0, playerCount),
    gameOver: false,
    turnCount: 0,
  };
}

// 指定位置にピースを配置できるか判定
function canPlacePiece(state, playerIndex, pieceCells, row, col) {
  const { board, players } = state;
  const color = players[playerIndex].color;
  const placedCount = PIECE_DEFINITIONS.length - players[playerIndex].pieces.length;

  // 各セルがボード内で空いているか確認
  const absoluteCells = pieceCells.map(([r, c]) => [row + r, col + c]);

  for (const [r, c] of absoluteCells) {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
    if (board[r][c] !== null) return false;
  }

  if (placedCount === 0) {
    // 最初のピースはコーナーを含む必要がある
    const corner = state.corners[playerIndex];
    const coversCorner = absoluteCells.some(
      ([r, c]) => r === corner[0] && c === corner[1]
    );
    if (!coversCorner) return false;
  } else {
    // 同じ色の辺が隣接してはいけない
    for (const [r, c] of absoluteCells) {
      const adjacents = [[r-1,c],[r+1,c],[r,c-1],[r,c+1]];
      for (const [ar, ac] of adjacents) {
        if (ar >= 0 && ar < BOARD_SIZE && ac >= 0 && ac < BOARD_SIZE) {
          if (board[ar][ac] === color) return false;
        }
      }
    }

    // 同じ色の角が少なくとも1つ隣接している必要がある
    let hasCornerContact = false;
    for (const [r, c] of absoluteCells) {
      const diagonals = [[r-1,c-1],[r-1,c+1],[r+1,c-1],[r+1,c+1]];
      for (const [dr, dc] of diagonals) {
        if (dr >= 0 && dr < BOARD_SIZE && dc >= 0 && dc < BOARD_SIZE) {
          if (board[dr][dc] === color) {
            // この対角セルがピース自身のセルでないか確認
            const isOwnCell = absoluteCells.some(
              ([ar, ac]) => ar === dr && ac === dc
            );
            if (!isOwnCell) {
              hasCornerContact = true;
            }
          }
        }
      }
    }
    if (!hasCornerContact) return false;
  }

  return true;
}

// ピースを配置
function placePiece(state, playerIndex, pieceId, variation, row, col) {
  const newState = JSON.parse(JSON.stringify(state));
  const player = newState.players[playerIndex];
  const color = player.color;

  const absoluteCells = variation.map(([r, c]) => [row + r, col + c]);
  for (const [r, c] of absoluteCells) {
    newState.board[r][c] = color;
  }

  player.pieces = player.pieces.filter(id => id !== pieceId);
  newState.turnCount++;

  // 次のプレイヤーへ
  advanceTurn(newState);

  return newState;
}

// ターンを進める
function advanceTurn(state) {
  const { playerCount } = state;
  let next = (state.currentPlayer + 1) % playerCount;
  let checked = 0;

  while (checked < playerCount) {
    if (!state.players[next].passed) {
      // このプレイヤーが置けるかチェック
      if (hasValidMove(state, next)) {
        state.currentPlayer = next;
        return;
      } else {
        state.players[next].passed = true;
      }
    }
    next = (next + 1) % playerCount;
    checked++;
  }

  // 全員パス → ゲーム終了
  state.gameOver = true;
  calculateScores(state);
}

// 有効な手があるか確認
function hasValidMove(state, playerIndex) {
  const player = state.players[playerIndex];
  for (const pieceId of player.pieces) {
    const pieceDef = PIECE_DEFINITIONS.find(p => p.id === pieceId);
    const variations = getAllVariations(pieceDef.cells);
    for (const variation of variations) {
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (canPlacePiece(state, playerIndex, variation, r, c)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

// スコア計算
function calculateScores(state) {
  for (const player of state.players) {
    if (player.pieces.length === 0) {
      // 全ピース配置 +15点、最後が1マスなら+5点ボーナス = +20点
      player.score = 15;
      // ボーナスチェックは簡略化（+15固定）
    } else {
      let totalCells = 0;
      for (const pieceId of player.pieces) {
        const pieceDef = PIECE_DEFINITIONS.find(p => p.id === pieceId);
        totalCells += pieceDef.cells.length;
      }
      player.score = -totalCells;
    }
  }
}

// パスする
function passTurn(state, playerIndex) {
  const newState = JSON.parse(JSON.stringify(state));
  newState.players[playerIndex].passed = true;
  newState.turnCount++;
  advanceTurn(newState);
  return newState;
}

// エクスポート（Node.jsとブラウザ両対応）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BOARD_SIZE, COLORS, COLOR_VALUES, PIECE_DEFINITIONS,
    getAllVariations, normalizeCells, rotateCells, flipCells,
    rotateOnce, flipOnce,
    createInitialState, canPlacePiece, placePiece, passTurn,
    hasValidMove, calculateScores,
  };
}
