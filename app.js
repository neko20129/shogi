(function () {
  "use strict";

  const Engine = window.ShogiEngine;
  const PIECE_NAMES = { P: "歩", L: "香", N: "桂", S: "銀", G: "金", B: "角", R: "飛", K: "玉" };
  const PROMOTED_NAMES = { P: "と", L: "成香", N: "成桂", S: "成銀", B: "馬", R: "龍" };
  const HAND_ORDER = ["R", "B", "G", "S", "N", "L", "P"];
  const ROW_NAMES = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const state = {
    game: Engine.initialState(),
    mode: "cpu",
    selected: null,
    destinations: [],
    history: [],
    records: [],
    repetitions: new Map(),
    gameOver: false,
    pendingPromotion: null,
    lastMove: null,
    cpuTimer: null,
  };

  const boardElement = document.getElementById("board");
  const moveList = document.getElementById("move-list");
  const emptyHistory = document.getElementById("empty-history");
  const promotionDialog = document.getElementById("promotion-dialog");

  function playerName(owner) {
    if (state.mode === "cpu") return owner === 0 ? "あなた" : "コンピューター";
    return owner === 0 ? "先手" : "後手";
  }

  function pieceName(piece) {
    return piece.promoted ? PROMOTED_NAMES[piece.type] : PIECE_NAMES[piece.type];
  }

  function addBoard() {
    boardElement.replaceChildren();
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        const square = document.createElement("button");
        square.type = "button";
        square.className = "square";
        square.setAttribute("role", "gridcell");
        square.dataset.row = String(row);
        square.dataset.col = String(col);
        square.addEventListener("click", onSquareClick);
        boardElement.append(square);
      }
    }
    render();
  }

  function render() {
    const checkedKing = state.game.board.flatMap((rank, row) =>
      rank.map((piece, col) => piece && piece.owner === state.game.turn && piece.type === "K" ? [row, col] : null)
    ).find(Boolean);
    for (const square of boardElement.children) {
      const row = Number(square.dataset.row);
      const col = Number(square.dataset.col);
      const piece = state.game.board[row][col];
      const isSelected = state.selected && !state.selected.drop &&
        state.selected.from[0] === row && state.selected.from[1] === col;
      const isDestination = state.destinations.some((move) => move.to[0] === row && move.to[1] === col);
      square.replaceChildren();
      square.className = "square";
      if (isSelected) square.classList.add("selected");
      if (isDestination) square.classList.add("legal-target");
      if (isDestination && piece) square.classList.add("capture-target");
      if (state.lastMove && state.lastMove.to[0] === row && state.lastMove.to[1] === col) square.classList.add("last-move");
      if (checkedKing && checkedKing[0] === row && checkedKing[1] === col && Engine.isInCheck(state.game, state.game.turn)) square.classList.add("in-check");
      square.setAttribute("aria-label", `${9 - col}筋${ROW_NAMES[row]}${piece ? pieceName(piece) : "空き"}${piece && piece.owner === 0 ? " 先手" : piece ? " 後手" : ""}`);
      if (piece) {
        const pieceElement = document.createElement("span");
        pieceElement.className = `piece${piece.owner === 1 ? " gote" : ""}${piece.promoted ? " promoted" : ""}`;
        pieceElement.textContent = pieceName(piece);
        square.append(pieceElement);
      }
    }
    renderHands();
    renderPlayers();
    renderHistory();
    renderStatus();
    document.getElementById("undo").disabled = state.history.length === 0 || state.mode === "cpu" && state.history.length < 2;
  }

  function renderHands() {
    for (const owner of [1, 0]) {
      const element = document.getElementById(owner === 0 ? "sente-hand" : "gote-hand");
      element.replaceChildren();
      for (const type of HAND_ORDER) {
        const count = state.game.hands[owner][type];
        if (!count) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "hand-piece";
        button.setAttribute("aria-label", `${PIECE_NAMES[type]} ${count}枚、${owner === 0 ? "先手" : "後手"}の持ち駒`);
        button.setAttribute("aria-pressed", String(Boolean(state.selected && state.selected.drop === type && state.selected.owner === owner)));
        button.disabled = state.game.turn !== owner || state.gameOver || (state.mode === "cpu" && owner === 1);
        button.innerHTML = `${PIECE_NAMES[type]}<small>${count > 1 ? count : ""}</small>`;
        if (state.selected && state.selected.drop === type && state.selected.owner === owner) button.classList.add("selected");
        button.addEventListener("click", () => selectHand(owner, type));
        element.append(button);
      }
    }
  }

  function renderPlayers() {
    const activeOwner = state.game.turn;
    for (const owner of [0, 1]) {
      const prefix = owner === 0 ? "sente" : "gote";
      document.getElementById(`${prefix}-player`).classList.toggle("active", activeOwner === owner && !state.gameOver);
      document.getElementById(`${prefix}-name`).textContent = playerName(owner);
      document.getElementById(`${prefix}-caption`).textContent = owner === 0 ? "SENTE" : "GOTE";
      document.getElementById(`${prefix}-turn`).textContent = owner === 0 ? "先手番" : "後手番";
    }
  }

  function renderHistory() {
    moveList.replaceChildren();
    emptyHistory.hidden = state.records.length > 0;
    for (let index = 0; index < state.records.length; index += 2) {
      const row = document.createElement("li");
      row.className = "move-row";
      const number = document.createElement("span");
      number.className = "move-number";
      number.textContent = `${index / 2 + 1}.`;
      row.append(number);
      for (let owner = 0; owner < 2; owner += 1) {
        const cell = document.createElement("span");
        const record = state.records[index + owner];
        cell.className = `move-cell${record && index + owner === state.records.length - 1 ? " current" : ""}`;
        cell.textContent = record ? record.text : "";
        row.append(cell);
      }
      moveList.append(row);
    }
    moveList.scrollTop = moveList.scrollHeight;
    document.getElementById("move-count").textContent = `${state.records.length}手`;
  }

  function renderStatus() {
    const status = document.getElementById("game-status");
    const detail = document.getElementById("status-detail");
    const icon = document.getElementById("status-icon");
    icon.className = "status-icon";
    if (state.gameOver) {
      status.textContent = state.result;
      detail.textContent = "新しい対局で、もう一局始められます";
      icon.textContent = "✓";
      icon.classList.add("finished");
    } else if (Engine.isInCheck(state.game, state.game.turn)) {
      status.textContent = `${playerName(state.game.turn)}は王手です`;
      detail.textContent = "王手を解消する手を指してください";
      icon.textContent = "!";
      icon.classList.add("check");
    } else {
      status.textContent = `${playerName(state.game.turn)}の手番です`;
      detail.textContent = state.selected ? "移動先を選んでください" : "駒を選んで移動先を選択";
      icon.textContent = "●";
    }
  }

  function onSquareClick(event) {
    if (state.gameOver || state.mode === "cpu" && state.game.turn === 1 || state.pendingPromotion) return;
    const row = Number(event.currentTarget.dataset.row);
    const col = Number(event.currentTarget.dataset.col);
    const moves = state.destinations.filter((move) => move.to[0] === row && move.to[1] === col);
    if (moves.length) {
      if (moves.some((move) => move.promote) && moves.some((move) => !move.promote)) {
        state.pendingPromotion = moves;
        promotionDialog.showModal();
      } else {
        commitMove(moves[0]);
      }
      return;
    }
    const piece = state.game.board[row][col];
    if (piece && piece.owner === state.game.turn) selectPiece(row, col);
    else clearSelection();
  }

  function selectPiece(row, col) {
    const allMoves = Engine.legalMoves(state.game);
    state.selected = { from: [row, col] };
    state.destinations = allMoves.filter((move) => !move.drop && move.from[0] === row && move.from[1] === col);
    render();
  }

  function selectHand(owner, type) {
    if (owner !== state.game.turn || state.gameOver) return;
    if (state.selected && state.selected.drop === type && state.selected.owner === owner) {
      clearSelection();
      return;
    }
    state.selected = { drop: type, owner };
    state.destinations = Engine.legalMoves(state.game).filter((move) => move.drop === type);
    render();
  }

  function clearSelection() {
    state.selected = null;
    state.destinations = [];
    render();
  }

  function commitMove(move) {
    const owner = state.game.turn;
    const oldState = state.game;
    const from = move.drop ? null : oldState.board[move.from[0]][move.from[1]];
    state.history.push({
      game: Engine.cloneState(oldState),
      lastMove: state.lastMove,
      recordCount: state.records.length,
      repetitions: new Map([...state.repetitions].map(([key, counts]) => [key, [...counts]])),
    });
    state.game = Engine.applyMove(oldState, move);
    state.lastMove = move;
    state.selected = null;
    state.destinations = [];
    const notation = makeNotation(move, from);
    const givesCheck = Engine.isInCheck(state.game, state.game.turn);
    state.records.push({ text: `${notation}${givesCheck ? " 王手" : ""}`, mover: owner, givesCheck });
    render();
    checkGameEnd();
  }

  function makeNotation(move, movingPiece) {
    const [row, col] = move.to;
    const destination = `${9 - col}${ROW_NAMES[row]}`;
    if (move.drop) return `${destination}${PIECE_NAMES[move.drop]}打`;
    return `${destination}${pieceName({ ...movingPiece, promoted: movingPiece.promoted || move.promote })}${move.promote ? "成" : ""}`;
  }

  function checkGameEnd() {
    if (state.gameOver) return;
    const key = Engine.positionKey(state.game);
    const occurrences = state.repetitions.get(key) || [];
    occurrences.push(state.records.length);
    state.repetitions.set(key, occurrences);
    if (occurrences.length >= 4) {
      const start = occurrences[occurrences.length - 4];
      const cycle = state.records.slice(start);
      const perpetualChecker = [0, 1].find((owner) => {
        const checks = cycle.filter((record) => record.mover === owner);
        return checks.length > 0 && checks.every((record) => record.givesCheck);
      });
      state.gameOver = true;
      state.result = perpetualChecker === undefined ? "千日手です（引き分け）" : `${playerName(1 - perpetualChecker)}の勝ちです（連続王手）`;
      render();
      return;
    }
    const moves = Engine.legalMoves(state.game);
    if (moves.length === 0) {
      state.gameOver = true;
      state.result = Engine.isInCheck(state.game, state.game.turn)
        ? `${playerName(1 - state.game.turn)}の勝ちです（詰み）`
        : `${playerName(1 - state.game.turn)}の勝ちです（指し手なし）`;
      render();
      return;
    }
    if (state.mode === "cpu" && state.game.turn === 1) {
      state.cpuTimer = window.setTimeout(playComputerMove, 420);
    }
  }

  function scoreMove(move, game) {
    const values = { P: 100, L: 280, N: 320, S: 450, G: 550, B: 800, R: 1000, K: 10000 };
    let score = Math.random() * 8;
    const target = game.board[move.to[0]][move.to[1]];
    if (target) score += values[target.type] * (target.promoted ? 1 : 1.08) + 35;
    if (move.promote) score += 75 + (values[game.board[move.from[0]][move.from[1]].type] || 0) * .1;
    const next = Engine.applyMove(game, move);
    if (Engine.isInCheck(next, next.turn)) score += 55;
    const [row, col] = move.to;
    score += (4 - Math.abs(4 - row)) * 1.4 + (4 - Math.abs(4 - col)) * 1.4;
    return score;
  }

  function playComputerMove() {
    state.cpuTimer = null;
    if (state.gameOver || state.mode !== "cpu" || state.game.turn !== 1) return;
    const moves = Engine.legalMoves(state.game);
    if (!moves.length) {
      checkGameEnd();
      return;
    }
    const rankedMoves = moves.map((move) => ({ move, score: scoreMove(move, state.game) }));
    rankedMoves.sort((a, b) => b.score - a.score);
    commitMove(rankedMoves[0].move);
  }

  function startGame() {
    window.clearTimeout(state.cpuTimer);
    state.game = Engine.initialState();
    state.selected = null;
    state.destinations = [];
    state.history = [];
    state.records = [];
    state.repetitions = new Map([[Engine.positionKey(state.game), [0]]]);
    state.gameOver = false;
    state.result = "";
    state.lastMove = null;
    state.pendingPromotion = null;
    if (promotionDialog.open) promotionDialog.close();
    render();
  }

  function undoMove() {
    if (state.history.length === 0) return;
    window.clearTimeout(state.cpuTimer);
    const steps = state.mode === "cpu" ? Math.min(2, state.history.length) : 1;
    for (let step = 0; step < steps; step += 1) {
      const snapshot = state.history.pop();
      state.game = snapshot.game;
      state.lastMove = snapshot.lastMove;
      state.records.length = snapshot.recordCount;
      state.repetitions = snapshot.repetitions;
    }
    state.gameOver = false;
    state.result = "";
    state.selected = null;
    state.destinations = [];
    render();
  }

  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      document.querySelectorAll(".mode-button").forEach((choice) => {
        const active = choice === button;
        choice.classList.toggle("active", active);
        choice.setAttribute("aria-pressed", String(active));
      });
      startGame();
    });
  });
  document.getElementById("new-game").addEventListener("click", startGame);
  document.getElementById("undo").addEventListener("click", undoMove);
  document.getElementById("promote-yes").addEventListener("click", () => {
    const move = state.pendingPromotion && state.pendingPromotion.find((candidate) => candidate.promote);
    promotionDialog.close();
    state.pendingPromotion = null;
    if (move) commitMove(move);
  });
  promotionDialog.addEventListener("cancel", () => {
    state.pendingPromotion = null;
    render();
  });
  document.getElementById("promote-no").addEventListener("click", () => {
    const move = state.pendingPromotion && state.pendingPromotion.find((candidate) => !candidate.promote);
    promotionDialog.close();
    state.pendingPromotion = null;
    if (move) commitMove(move);
  });

  state.repetitions.set(Engine.positionKey(state.game), [0]);
  addBoard();
})();
