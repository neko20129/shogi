"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../shogi.js");

function emptyState() {
  const board = Array.from({ length: 9 }, () => Array(9).fill(null));
  board[8][4] = { type: "K", owner: 0, promoted: false };
  board[0][4] = { type: "K", owner: 1, promoted: false };
  return {
    board,
    hands: [
      { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 },
      { P: 0, L: 0, N: 0, S: 0, G: 0, B: 0, R: 0 },
    ],
    turn: 0,
  };
}

test("initial position contains both armies and legal first moves", () => {
  const state = Engine.initialState();
  assert.equal(state.board.flat().filter(Boolean).length, 40);
  assert.ok(Engine.legalMoves(state).length > 0);
  assert.equal(Engine.isInCheck(state, 0), false);
  assert.equal(Engine.isInCheck(state, 1), false);
});

test("check is detected and unrelated moves cannot leave the king exposed", () => {
  const state = emptyState();
  state.board[4][4] = { type: "R", owner: 1, promoted: false };
  state.board[8][0] = { type: "P", owner: 0, promoted: false };
  assert.equal(Engine.isInCheck(state, 0), true);
  assert.equal(
    Engine.legalMoves(state).some((move) => move.from?.[0] === 8 && move.from?.[1] === 0),
    false,
  );
});

test("a pawn entering the promotion zone can promote or remain unpromoted", () => {
  const state = emptyState();
  state.board[3][0] = { type: "P", owner: 0, promoted: false };
  const moves = Engine.legalMoves(state).filter((move) => move.from?.[0] === 3 && move.from?.[1] === 0);
  assert.deepEqual(moves.map((move) => move.promote).sort(), [false, true]);
});

test("captured promoted pieces return to hand in their basic form", () => {
  const state = emptyState();
  state.board[7][4] = { type: "R", owner: 0, promoted: false };
  state.board[5][4] = { type: "P", owner: 1, promoted: true };
  const move = Engine.legalMoves(state).find((candidate) =>
    candidate.from?.[0] === 7 && candidate.from?.[1] === 4 &&
    candidate.to[0] === 5 && candidate.to[1] === 4
  );
  assert.ok(move);
  const next = Engine.applyMove(state, move);
  assert.equal(next.hands[0].P, 1);
  assert.equal(next.board[5][4].owner, 0);
});

test("a pawn cannot be dropped on a file that already has an unpromoted pawn", () => {
  const state = emptyState();
  state.hands[0].P = 1;
  state.board[6][2] = { type: "P", owner: 0, promoted: false };
  const drops = Engine.legalMoves(state).filter((move) => move.drop === "P");
  assert.equal(drops.some((move) => move.to[1] === 2), false);
  assert.ok(drops.some((move) => move.to[1] !== 2));
});

test("a pawn drop that checkmates the opponent is illegal", () => {
  const state = emptyState();
  state.board[0][4] = { type: "K", owner: 1, promoted: false };
  state.board[4][3] = { type: "R", owner: 0, promoted: false };
  state.board[4][5] = { type: "R", owner: 0, promoted: false };
  state.board[2][4] = { type: "G", owner: 0, promoted: false };
  state.board[1][2] = { type: "S", owner: 0, promoted: false };
  state.hands[0].P = 1;
  assert.equal(
    Engine.legalMoves(state).some((move) => move.drop === "P" && move.to[0] === 1 && move.to[1] === 4),
    false,
  );
});
