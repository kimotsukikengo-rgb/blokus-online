// ブロックス AI（簡単・普通・難しい）
(function() {
  'use strict';

  // 全有効手を列挙（候補位置を絞り込んで高速化）
  function findAllValidMoves(state, playerIndex) {
    const player = state.players[playerIndex];
    const color = player.color;
    const board = state.board;
    const placedCount = PIECE_DEFINITIONS.length - player.pieces.length;
    const moves = [];

    // 候補セル: ピースを置き始める可能性のあるセルを絞る
    const candidateCells = new Set();

    if (placedCount === 0) {
      // 最初の手: コーナー周辺のみ
      const corner = state.corners[playerIndex];
      for (let dr = -4; dr <= 4; dr++) {
        for (let dc = -4; dc <= 4; dc++) {
          const r = corner[0] + dr;
          const c = corner[1] + dc;
          if (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE) {
            candidateCells.add(r * BOARD_SIZE + c);
          }
        }
      }
    } else {
      // 自色の対角セル周辺を候補にする
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (board[r][c] === color) {
            const diags = [[r-1,c-1],[r-1,c+1],[r+1,c-1],[r+1,c+1]];
            for (const [dr, dc] of diags) {
              if (dr >= 0 && dr < BOARD_SIZE && dc >= 0 && dc < BOARD_SIZE && board[dr][dc] === null) {
                // この対角セルの周辺も候補に
                for (let er = -4; er <= 4; er++) {
                  for (let ec = -4; ec <= 4; ec++) {
                    const nr = dr + er;
                    const nc = dc + ec;
                    if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                      candidateCells.add(nr * BOARD_SIZE + nc);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    const candidates = Array.from(candidateCells).map(v => [Math.floor(v / BOARD_SIZE), v % BOARD_SIZE]);

    for (const pieceId of player.pieces) {
      const pieceDef = PIECE_DEFINITIONS.find(p => p.id === pieceId);
      const variations = getAllVariations(pieceDef.cells);
      for (let vi = 0; vi < variations.length; vi++) {
        const variation = variations[vi];
        for (const [r, c] of candidates) {
          if (canPlacePiece(state, playerIndex, variation, r, c)) {
            moves.push({ pieceId, variation, row: r, col: c, size: variation.length });
          }
        }
      }
    }

    return moves;
  }

  // --- 評価関数ヘルパー ---

  // 配置後に生まれる新しい角（接続ポイント）の数
  function countNewCorners(state, playerIndex, variation, row, col) {
    const color = state.players[playerIndex].color;
    const board = state.board;
    const placed = new Set();
    const absoluteCells = variation.map(([r, c]) => {
      const ar = row + r;
      const ac = col + c;
      placed.add(ar * BOARD_SIZE + ac);
      return [ar, ac];
    });

    let corners = 0;
    for (const [r, c] of absoluteCells) {
      const diags = [[r-1,c-1],[r-1,c+1],[r+1,c-1],[r+1,c+1]];
      for (const [dr, dc] of diags) {
        if (dr < 0 || dr >= BOARD_SIZE || dc < 0 || dc >= BOARD_SIZE) continue;
        if (board[dr][dc] !== null) continue;
        if (placed.has(dr * BOARD_SIZE + dc)) continue;

        // この角セルが辺で自色に隣接していないか確認
        const adj = [[dr-1,dc],[dr+1,dc],[dr,dc-1],[dr,dc+1]];
        let blocked = false;
        for (const [ar, ac] of adj) {
          if (ar >= 0 && ar < BOARD_SIZE && ac >= 0 && ac < BOARD_SIZE) {
            if (board[ar][ac] === color || placed.has(ar * BOARD_SIZE + ac)) {
              blocked = true;
              break;
            }
          }
        }
        if (!blocked) corners++;
      }
    }
    return corners;
  }

  // ボード中央への近さ
  function centerDistance(variation, row, col) {
    const center = (BOARD_SIZE - 1) / 2;
    let totalDist = 0;
    for (const [r, c] of variation) {
      const dr = (row + r) - center;
      const dc = (col + c) - center;
      totalDist += Math.sqrt(dr * dr + dc * dc);
    }
    return totalDist / variation.length;
  }

  // 相手の角をブロックする数
  function countBlockedOpponentCorners(state, playerIndex, variation, row, col) {
    const board = state.board;
    const placed = new Set();
    variation.forEach(([r, c]) => placed.add((row + r) * BOARD_SIZE + (col + c)));

    let blocked = 0;
    for (let pi = 0; pi < state.playerCount; pi++) {
      if (pi === playerIndex) continue;
      const oppColor = state.players[pi].color;
      // 相手の対角候補セルをピースが塞ぐか
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (board[r][c] === oppColor) {
            const diags = [[r-1,c-1],[r-1,c+1],[r+1,c-1],[r+1,c+1]];
            for (const [dr, dc] of diags) {
              if (placed.has(dr * BOARD_SIZE + dc)) {
                blocked++;
              }
            }
          }
        }
      }
    }
    return blocked;
  }

  // --- 難易度別AI ---

  // 簡単: ランダムな有効手（小さいピース優先の傾向）
  function aiEasy(state, playerIndex) {
    const moves = findAllValidMoves(state, playerIndex);
    if (moves.length === 0) return null;
    // 完全ランダム
    return moves[Math.floor(Math.random() * moves.length)];
  }

  // 普通: 大きいピース優先 + 中央寄り
  function aiNormal(state, playerIndex) {
    const moves = findAllValidMoves(state, playerIndex);
    if (moves.length === 0) return null;

    // スコア計算
    const scored = moves.map(move => {
      let score = 0;
      // 大きいピースを優先（序盤ほど重要）
      score += move.size * 10;
      // 中央寄り
      score -= centerDistance(move.variation, move.row, move.col) * 0.5;
      // 新しい角の数
      score += countNewCorners(state, playerIndex, move.variation, move.row, move.col) * 2;
      // ランダム性を少し加える
      score += Math.random() * 5;
      return { ...move, score };
    });

    scored.sort((a, b) => b.score - a.score);
    // 上位5手からランダム
    const topN = Math.min(5, scored.length);
    return scored[Math.floor(Math.random() * topN)];
  }

  // 難しい: 戦略的配置（大きいピース優先 + 角最大化 + 相手ブロック + 領地拡大）
  function aiHard(state, playerIndex) {
    const moves = findAllValidMoves(state, playerIndex);
    if (moves.length === 0) return null;

    const scored = moves.map(move => {
      let score = 0;
      // 大きいピースを強く優先
      score += move.size * 15;
      // 中央寄りを重視（序盤）
      const placedCount = PIECE_DEFINITIONS.length - state.players[playerIndex].pieces.length;
      const centerWeight = placedCount < 5 ? 2.0 : 0.5;
      score -= centerDistance(move.variation, move.row, move.col) * centerWeight;
      // 新しい角を最大化
      score += countNewCorners(state, playerIndex, move.variation, move.row, move.col) * 5;
      // 相手の角をブロック
      score += countBlockedOpponentCorners(state, playerIndex, move.variation, move.row, move.col) * 4;
      // 微小ランダム（同点回避）
      score += Math.random() * 1;
      return { ...move, score };
    });

    scored.sort((a, b) => b.score - a.score);
    // 最良手を選択（上位2手から）
    const topN = Math.min(2, scored.length);
    return scored[Math.floor(Math.random() * topN)];
  }

  // --- 公開API ---
  window.BlokusAI = {
    getMove: function(state, playerIndex, difficulty) {
      switch (difficulty) {
        case 'easy': return aiEasy(state, playerIndex);
        case 'normal': return aiNormal(state, playerIndex);
        case 'hard': return aiHard(state, playerIndex);
        default: return aiNormal(state, playerIndex);
      }
    },
    findAllValidMoves: findAllValidMoves,
  };
})();
