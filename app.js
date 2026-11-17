(function () {
  "use strict";

  // ==========================================
  // ★ ここにSupabaseの接続情報を設定してください
  // ==========================================
  const SUPABASE_URL = "https://idstfjcrxuvbmakpgntm.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_uqzAODN57ID3MwIAchCvbA_36wWHAjp";

  const supabaseClient = window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  const Engine = window.ShogiEngine;
  const PIECE_NAMES = { P: "歩", L: "香", N: "桂", S: "銀", G: "金", B: "角", R: "飛", K: "玉" };
  const PROMOTED_NAMES = { P: "と", L: "成香", N: "成桂", S: "成銀", B: "馬", R: "龍" };
  const HAND_ORDER = ["R", "B", "G", "S", "N", "L", "P"];
  const ROW_NAMES = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const FILE_NAMES = ["９", "８", "７", "６", "５", "４", "３", "２", "１"];

  // ブラウザごとのプレイヤー識別ID
  const clientId = sessionStorage.getItem("shogi_client_id") || crypto.randomUUID();
  sessionStorage.setItem("shogi_client_id", clientId);

  const state = {
    game: Engine.initialState(),
    mode: "cpu", // "cpu" | "pvp" | "online"
    selected: null,
    destinations: [],
    history: [],
    records: [],
    repetitions: new Map(),
    gameOver: false,
    result: "",
    pendingPromotion: null,
    lastMove: null,
    cpuTimer: null,
    // オンライン対戦用ステート
    online: {
      roomId: null,
      myRole: null, // 0: 先手, 1: 後手
      status: "idle", // "idle" | "waiting" | "playing" | "finished"
      channel: null,
    },
  };

  const boardElement = document.getElementById("board");
  const moveList = document.getElementById("move-list");
  const emptyHistory = document.getElementById("empty-history");
  const promotionDialog = document.getElementById("promotion-dialog");

  // 後手視点で盤面を上下反転させるかどうか
  function isFlipped() {
    return state.mode === "online" && state.online.myRole === 1;
  }

  function playerName(owner) {
    if (state.mode === "cpu") return owner === 0 ? "あなた" : "コンピューター";
    if (state.mode === "online") {
      if (state.online.myRole === null) return owner === 0 ? "先手" : "後手";
      return owner === state.online.myRole ? "あなた" : "対戦相手";
    }
    return owner === 0 ? "先手" : "後手";
  }

  function pieceName(piece) {
    return piece.promoted ? PROMOTED_NAMES[piece.type] : PIECE_NAMES[piece.type];
  }

  function addBoard() {
    boardElement.replaceChildren();
    for (let vRow = 0; vRow < 9; vRow += 1) {
      for (let vCol = 0; vCol < 9; vCol += 1) {
        const square = document.createElement("button");
        square.type = "button";
        square.className = "square";
        square.setAttribute("role", "gridcell");
        square.addEventListener("click", onSquareClick);
        boardElement.append(square);
      }
    }
    render();
  }

  function render() {
    const flipped = isFlipped();

    // 筋・段のラベル更新（後手視点なら反転）
    const fileLabels = document.getElementById("file-labels").children;
    const rankLabels = document.getElementById("rank-labels").children;
    for (let i = 0; i < 9; i += 1) {
      fileLabels[i].textContent = flipped ? FILE_NAMES[8 - i] : FILE_NAMES[i];
      rankLabels[i].textContent = flipped ? ROW_NAMES[8 - i] : ROW_NAMES[i];
    }

    const checkedKing = state.game.board.flatMap((rank, row) =>
      rank.map((piece, col) => piece && piece.owner === state.game.turn && piece.type === "K" ? [row, col] : null)
    ).find(Boolean);

    Array.from(boardElement.children).forEach((square, idx) => {
      const vRow = Math.floor(idx / 9);
      const vCol = idx % 9;
      // 論理座標への変換
      const row = flipped ? 8 - vRow : vRow;
      const col = flipped ? 8 - vCol : vCol;
      square.dataset.row = String(row);
      square.dataset.col = String(col);

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
      if (checkedKing && checkedKing[0] === row && checkedKing[1] === col && Engine.isInCheck(state.game, state.game.turn)) {
        square.classList.add("in-check");
      }

      square.setAttribute("aria-label", `${9 - col}筋${ROW_NAMES[row]}${piece ? pieceName(piece) : "空き"}${piece && piece.owner === 0 ? " 先手" : piece ? " 後手" : ""}`);

      if (piece) {
        const pieceElement = document.createElement("span");
        // 後手視点のときは、先手の駒を逆さま(goteクラス付与)に表示する
        const isOpponentOrientation = flipped ? piece.owner === 0 : piece.owner === 1;
        pieceElement.className = `piece${isOpponentOrientation ? " gote" : ""}${piece.promoted ? " promoted" : ""}`;
        pieceElement.textContent = pieceName(piece);
        square.append(pieceElement);
      }
    });

    renderHands();
    renderPlayers();
    renderHistory();
    renderStatus();
    document.getElementById("undo").disabled = state.history.length === 0 || (state.mode === "cpu" && state.history.length < 2);
  }

  function renderHands() {
    const flipped = isFlipped();
    // 画面上側(top-hand)と下側(bottom-hand)にどちらの持ち駒を割り当てるか
    const slots = [
      { elementId: "top-hand", owner: flipped ? 0 : 1 },
      { elementId: "bottom-hand", owner: flipped ? 1 : 0 },
    ];

    for (const { elementId, owner } of slots) {
      const element = document.getElementById(elementId);
      element.replaceChildren();
      for (const type of HAND_ORDER) {
        const count = state.game.hands[owner][type];
        if (!count) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "hand-piece";
        button.setAttribute("aria-label", `${PIECE_NAMES[type]} ${count}枚、${owner === 0 ? "先手" : "後手"}の持ち駒`);
        button.setAttribute("aria-pressed", String(Boolean(state.selected && state.selected.drop === type && state.selected.owner === owner)));
        button.disabled = !canOperate(owner);
        button.innerHTML = `${PIECE_NAMES[type]}<small>${count > 1 ? count : ""}</small>`;
        if (state.selected && state.selected.drop === type && state.selected.owner === owner) button.classList.add("selected");
        button.addEventListener("click", () => selectHand(owner, type));
        element.append(button);
      }
    }
  }

  function renderPlayers() {
    const flipped = isFlipped();
    const activeOwner = state.game.turn;
    const isPlaying = state.mode !== "online" || state.online.status === "playing";

    const slots = [
      { prefix: "top", owner: flipped ? 0 : 1 },
      { prefix: "bottom", owner: flipped ? 1 : 0 },
    ];

    for (const { prefix, owner } of slots) {
      document.getElementById(`${prefix}-player`).classList.toggle("active", activeOwner === owner && !state.gameOver && isPlaying);
      document.getElementById(`${prefix}-avatar`).textContent = owner === 0 ? "先" : "後";
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

    if (state.mode === "online") {
      if (state.online.status === "idle") {
        status.textContent = "オンライン対局";
        detail.textContent = "部屋を作るか、IDを入力して参加してください";
        icon.textContent = "●";
        return;
      }
      if (state.online.status === "waiting") {
        status.textContent = "対戦相手を待っています…";
        detail.textContent = `部屋ID「${state.online.roomId}」を相手に伝えてください`;
        icon.textContent = "…";
        return;
      }
    }

    if (state.gameOver) {
      status.textContent = state.result;
      detail.textContent = state.mode === "online" ? "対局が終了しました" : "新しい対局で、もう一局始められます";
      icon.textContent = "✓";
      icon.classList.add("finished");
    } else if (Engine.isInCheck(state.game, state.game.turn)) {
      status.textContent = `${playerName(state.game.turn)}は王手です`;
      detail.textContent = canOperate(state.game.turn) ? "王手を解消する手を指してください" : "相手の手を待っています";
      icon.textContent = "!";
      icon.classList.add("check");
    } else {
      status.textContent = `${playerName(state.game.turn)}の手番です`;
      if (!canOperate(state.game.turn)) {
        detail.textContent = "相手の指し手を待っています…";
      } else {
        detail.textContent = state.selected ? "移動先を選んでください" : "駒を選んで移動先を選択";
      }
      icon.textContent = "●";
    }
  }

  // 現在このクライアントが操作可能か判定
  function canOperate(owner = state.game.turn) {
    if (state.gameOver || state.pendingPromotion) return false;
    if (state.game.turn !== owner) return false;
    if (state.mode === "cpu") return owner === 0;
    if (state.mode === "online") {
      return state.online.status === "playing" && state.online.myRole === owner;
    }
    return true;
  }

  function onSquareClick(event) {
    if (!canOperate()) return;
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
    if (!canOperate(owner)) return;
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

  async function commitMove(move) {
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

    checkGameEnd();
    render();

    // オンライン対戦時はSupabaseへ盤面を保存
    if (state.mode === "online" && state.online.roomId) {
      await syncRoomToSupabase();
    }
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
      state.result = perpetualChecker === undefined
        ? "千日手です（引き分け）"
        : `${perpetualChecker === 0 ? "先手" : "後手"}の反則負け（連続王手）`;
      if (state.mode === "online") state.online.status = "finished";
      return;
    }

    const moves = Engine.legalMoves(state.game);
    if (moves.length === 0) {
      const winner = 1 - state.game.turn;
      state.gameOver = true;
      const reason = Engine.isInCheck(state.game, state.game.turn) ? "詰み" : "指し手なし";
      state.result = state.mode === "online"
        ? `${winner === 0 ? "先手" : "後手"}の勝ちです（${reason}）`
        : `${playerName(winner)}の勝ちです（${reason}）`;
      if (state.mode === "online") state.online.status = "finished";
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
    if (move.promote) score += 75 + (values[game.board[move.from[0]][move.from[1]].type] || 0) * 0.1;
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
      render();
      return;
    }
    const rankedMoves = moves.map((move) => ({ move, score: scoreMove(move, state.game) }));
    rankedMoves.sort((a, b) => b.score - a.score);
    commitMove(rankedMoves[0].move);
  }

  function resetBoardState() {
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
  }

  function startGame() {
    resetBoardState();
    render();
  }

  function undoMove() {
    if (state.history.length === 0 || state.mode === "online") return;
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

  // ==========================================
  // Supabase オンライン対戦ロジック
  // ==========================================
  function generateRoomId() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let id = "";
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
  }

  function checkSupabaseConfigured() {
    if (!supabaseClient || SUPABASE_URL.includes("YOUR_PROJECT_ID")) {
      alert("app.js の冒頭に Supabase の URL と ANON KEY を設定してください。");
      return false;
    }
    return true;
  }

  async function createOnlineRoom() {
    if (!checkSupabaseConfigured()) return;
    resetBoardState();
    const roomId = generateRoomId();

    const { error } = await supabaseClient.from("shogi_rooms").insert({
      id: roomId,
      game_state: state.game,
      records: [],
      last_move: null,
      status: "waiting",
      sente_id: clientId,
    });

    if (error) {
      alert("部屋の作成に失敗しました: " + error.message);
      return;
    }

    state.online.roomId = roomId;
    state.online.myRole = 0; // 作成者は先手
    state.online.status = "waiting";
    subscribeToRoom(roomId);
    updateOnlineUI();
    render();
  }

  async function joinOnlineRoom() {
    if (!checkSupabaseConfigured()) return;
    const input = document.getElementById("room-id-input");
    const roomId = input.value.trim().toUpperCase();
    if (roomId.length < 4) {
      alert("部屋IDを入力してください。");
      return;
    }

    const { data, error } = await supabaseClient
      .from("shogi_rooms")
      .select("*")
      .eq("id", roomId)
      .single();

    if (error || !data) {
      alert("指定された部屋が見つかりません。");
      return;
    }

    // 再接続チェック
    let role = null;
    if (data.sente_id === clientId) {
      role = 0;
    } else if (data.gote_id === clientId) {
      role = 1;
    } else if (data.status === "waiting" && !data.gote_id) {
      // 後手として参加確定
      const { error: updateError } = await supabaseClient
        .from("shogi_rooms")
        .update({ gote_id: clientId, status: "playing" })
        .eq("id", roomId);

      if (updateError) {
        alert("入室に失敗しました: " + updateError.message);
        return;
      }
      role = 1;
      data.status = "playing";
    } else {
      alert("この部屋はすでに満員か、対局が終了しています。");
      return;
    }

    resetBoardState();
    state.online.roomId = roomId;
    state.online.myRole = role;
    applyRemoteRoomData(data);
    subscribeToRoom(roomId);
    updateOnlineUI();
    render();
  }

  function subscribeToRoom(roomId) {
    if (state.online.channel) {
      supabaseClient.removeChannel(state.online.channel);
    }

    state.online.channel = supabaseClient
      .channel(`room:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "shogi_rooms",
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          applyRemoteRoomData(payload.new);
          updateOnlineUI();
          render();
        }
      )
      .subscribe();
  }

  function applyRemoteRoomData(room) {
    state.game = room.game_state;
    state.records = room.records || [];
    state.lastMove = room.last_move || null;
    state.online.status = room.status;

    // 千日手カウントの再構築
    const key = Engine.positionKey(state.game);
    const occurrences = state.repetitions.get(key) || [];
    if (!occurrences.includes(state.records.length)) {
      occurrences.push(state.records.length);
      state.repetitions.set(key, occurrences);
    }

    if (room.status === "finished") {
      state.gameOver = true;
      state.result = room.result || "対局終了";
    } else {
      state.gameOver = false;
      state.result = "";
    }
    state.selected = null;
    state.destinations = [];
  }

  async function syncRoomToSupabase() {
    if (!state.online.roomId) return;
    await supabaseClient
      .from("shogi_rooms")
      .update({
        game_state: state.game,
        records: state.records,
        last_move: state.lastMove,
        status: state.gameOver ? "finished" : "playing",
        result: state.result,
        updated_at: new Date().toISOString(),
      })
      .eq("id", state.online.roomId);
  }

  async function resignOnlineGame() {
    if (state.online.status !== "playing" || state.gameOver) return;
    if (!confirm("本当に投了しますか？")) return;

    const winner = 1 - state.online.myRole;
    state.gameOver = true;
    state.online.status = "finished";
    state.result = `${winner === 0 ? "先手" : "後手"}の勝ちです（投了）`;
    render();
    updateOnlineUI();
    await syncRoomToSupabase();
  }

  function leaveOnlineRoom() {
    if (state.online.channel && supabaseClient) {
      supabaseClient.removeChannel(state.online.channel);
    }
    state.online = { roomId: null, myRole: null, status: "idle", channel: null };
    resetBoardState();
    updateOnlineUI();
    render();
  }

  function updateOnlineUI() {
    const isOnline = state.mode === "online";
    document.getElementById("local-controls").hidden = isOnline;
    document.getElementById("online-controls").hidden = !isOnline;

    if (isOnline) {
      const inRoom = Boolean(state.online.roomId);
      document.getElementById("online-lobby").hidden = inRoom;
      document.getElementById("online-active").hidden = !inRoom;
      if (inRoom) {
        document.getElementById("display-room-id").textContent = state.online.roomId;
        document.getElementById("resign-btn").disabled = state.online.status !== "playing" || state.gameOver;
      }
    }
  }

  // ==========================================
  // イベントリスナー登録
  // ==========================================
  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.mode === "online" && state.online.roomId) {
        leaveOnlineRoom();
      }
      state.mode = button.dataset.mode;
      document.querySelectorAll(".mode-button").forEach((choice) => {
        const active = choice === button;
        choice.classList.toggle("active", active);
        choice.setAttribute("aria-pressed", String(active));
      });
      updateOnlineUI();
      startGame();
    });
  });

  document.getElementById("new-game").addEventListener("click", startGame);
  document.getElementById("undo").addEventListener("click", undoMove);
  document.getElementById("create-room").addEventListener("click", createOnlineRoom);
  document.getElementById("join-room").addEventListener("click", joinOnlineRoom);
  document.getElementById("resign-btn").addEventListener("click", resignOnlineGame);
  document.getElementById("leave-room").addEventListener("click", leaveOnlineRoom);

  document.getElementById("copy-room-id").addEventListener("click", (e) => {
    if (!state.online.roomId) return;
    navigator.clipboard.writeText(state.online.roomId);
    const btn = e.currentTarget;
    btn.textContent = "完了!";
    setTimeout(() => { btn.textContent = "コピー"; }, 1500);
  });

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
  updateOnlineUI();
  addBoard();
})();