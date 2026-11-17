(function (root, factory) {
  const engine = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = engine;
  if (root) root.ShogiEngine = engine;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TYPES = ["P", "L", "N", "S", "G", "B", "R", "K"];
  const PROMOTABLE = new Set(["P", "L", "N", "S", "B", "R"]);
  const PROMOTED = { P: "+P", L: "+L", N: "+N", S: "+S", B: "+B", R: "+R" };
  const DEMOTED = { "+P": "P", "+L": "L", "+N": "N", "+S": "S", "+B": "B", "+R": "R" };

  function initialState() {
    const board = Array.from({ length: 9 }, () => Array(9).fill(null));
    const back = ["L", "N", "S", "G", "K", "G", "S", "N", "L"];
    for (let col = 0; col < 9; col += 1) {
      board[0][col] = { type: back[col], owner: 1, promoted: false };
      board[2][col] = { type: "P", owner: 1, promoted: false };
      board[6][col] = { type: "P", owner: 0, promoted: false };
      board[8][col] = { type: back[col], owner: 0, promoted: false };
    }
    board[1][1] = { type: "R", owner: 1, promoted: false };
    board[1][7] = { type: "B", owner: 1, promoted: false };
    board[7][1] = { type: "B", owner: 0, promoted: false };
    board[7][7] = { type: "R", owner: 0, promoted: false };
    return { board, hands: [emptyHand(), emptyHand()], turn: 0 };
  }

  function emptyHand() {
    return { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 };
  }

  function cloneState(state) {
    return {
      board: state.board.map((row) => row.map((piece) => (piece ? { ...piece } : null))),
      hands: state.hands.map((hand) => ({ ...hand })),
      turn: state.turn,
    };
  }

  function inside(row, col) {
    return row >= 0 && row < 9 && col >= 0 && col < 9;
  }

  function inPromotionZone(owner, row) {
    return owner === 0 ? row <= 2 : row >= 6;
  }

  function isMandatoryPromotion(type, owner, row) {
    if ((type === "P" || type === "L") && (owner === 0 ? row === 0 : row === 8)) return true;
    return type === "N" && (owner === 0 ? row <= 1 : row >= 7);
  }

  function addMove(state, moves, fromRow, fromCol, row, col, owner) {
    if (!inside(row, col)) return false;
    const target = state.board[row][col];
    if (target && target.owner === owner) return false;
    moves.push({ from: [fromRow, fromCol], to: [row, col], promote: false });
    const piece = state.board[fromRow][fromCol];
    if (PROMOTABLE.has(piece.type) && !piece.promoted &&
        (inPromotionZone(owner, fromRow) || inPromotionZone(owner, row))) {
      if (isMandatoryPromotion(piece.type, owner, row)) moves[moves.length - 1].promote = true;
      else moves.push({ from: [fromRow, fromCol], to: [row, col], promote: true });
    }
    return !target;
  }

  function pseudoMoves(state, owner) {
    const moves = [];
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        const piece = state.board[row][col];
        if (!piece || piece.owner !== owner) continue;
        const forward = owner === 0 ? -1 : 1;
        const gold = piece.type === "G" || (piece.promoted && ["P", "L", "N", "S"].includes(piece.type));
        const steps = [];
        const slides = [];
        if (gold) {
          steps.push([forward, 0], [forward, -1], [forward, 1], [0, -1], [0, 1], [-forward, 0]);
        } else if (piece.type === "K") {
          for (let dr = -1; dr <= 1; dr += 1) {
            for (let dc = -1; dc <= 1; dc += 1) if (dr || dc) steps.push([dr, dc]);
          }
        } else if (piece.type === "P" && !piece.promoted) {
          steps.push([forward, 0]);
        } else if (piece.type === "L" && !piece.promoted) {
          slides.push([forward, 0]);
        } else if (piece.type === "N" && !piece.promoted) {
          steps.push([forward * 2, -1], [forward * 2, 1]);
        } else if (piece.type === "S" && !piece.promoted) {
          steps.push([forward, 0], [forward, -1], [forward, 1], [-forward, -1], [-forward, 1]);
        } else if (piece.type === "B") {
          slides.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
          if (piece.promoted) steps.push([-1, 0], [1, 0], [0, -1], [0, 1]);
        } else if (piece.type === "R") {
          slides.push([-1, 0], [1, 0], [0, -1], [0, 1]);
          if (piece.promoted) steps.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
        }
        for (const [dr, dc] of steps) addMove(state, moves, row, col, row + dr, col + dc, owner);
        for (const [dr, dc] of slides) {
          let nextRow = row + dr;
          let nextCol = col + dc;
          while (inside(nextRow, nextCol)) {
            if (!addMove(state, moves, row, col, nextRow, nextCol, owner)) break;
            nextRow += dr;
            nextCol += dc;
          }
        }
      }
    }

    for (const type of TYPES.slice(0, -1)) {
      if (!state.hands[owner][type]) continue;
      for (let row = 0; row < 9; row += 1) {
        if ((type === "P" || type === "L") && (owner === 0 ? row === 0 : row === 8)) continue;
        if (type === "N" && (owner === 0 ? row <= 1 : row >= 7)) continue;
        for (let col = 0; col < 9; col += 1) {
          if (state.board[row][col]) continue;
          if (type === "P" && state.board.some((rank) => {
            const piece = rank[col];
            return piece && piece.owner === owner && piece.type === "P" && !piece.promoted;
          })) continue;
          moves.push({ drop: type, to: [row, col], promote: false });
        }
      }
    }
    return moves;
  }

  function applyUnchecked(state, move, owner) {
    const next = cloneState(state);
    const [row, col] = move.to;
    if (move.drop) {
      next.hands[owner][move.drop] -= 1;
      next.board[row][col] = { type: move.drop, owner, promoted: false };
    } else {
      const [fromRow, fromCol] = move.from;
      const captured = next.board[row][col];
      if (captured) {
        const capturedType = captured.promoted ? DEMOTED[`+${captured.type}`] : captured.type;
        next.hands[owner][capturedType] += 1;
      }
      const piece = next.board[fromRow][fromCol];
      next.board[fromRow][fromCol] = null;
      next.board[row][col] = { ...piece, promoted: piece.promoted || move.promote };
    }
    next.turn = 1 - owner;
    return next;
  }

  function isInCheck(state, owner) {
    let king;
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        const piece = state.board[row][col];
        if (piece && piece.owner === owner && piece.type === "K") king = [row, col];
      }
    }
    if (!king) return true;
    return pseudoMoves(state, 1 - owner).some((move) =>
      !move.drop && move.to[0] === king[0] && move.to[1] === king[1]
    );
  }

  function legalMoves(state, owner = state.turn, options = {}) {
    const enforcePawnDropMate = options.enforcePawnDropMate !== false;
    return pseudoMoves(state, owner).filter((move) => {
      if (!move.drop && state.board[move.to[0]][move.to[1]]?.type === "K") return false;
      const next = applyUnchecked(state, move, owner);
      if (isInCheck(next, owner)) return false;
      if (enforcePawnDropMate && move.drop === "P" && isInCheck(next, 1 - owner)) {
        return legalMoves(next, 1 - owner, { enforcePawnDropMate: false }).length > 0;
      }
      return true;
    });
  }

  function applyMove(state, move) {
    return applyUnchecked(state, move, state.turn);
  }

  function positionKey(state) {
    const board = state.board.map((row) => row.map((piece) => {
      if (!piece) return ".";
      return `${piece.owner}${piece.promoted ? "+" : ""}${piece.type}`;
    }).join(",")).join("/");
    const hands = state.hands.map((hand) => TYPES.slice(0, -1).map((type) => hand[type]).join(",")).join("/");
    return `${board}|${hands}|${state.turn}`;
  }

  return { initialState, cloneState, legalMoves, applyMove, isInCheck, inPromotionZone, positionKey };
});
