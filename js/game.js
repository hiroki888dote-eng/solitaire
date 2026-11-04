/* =========================================================
   ソリティア（クロンダイク）のプログラム
   ---------------------------------------------------------
   ・カードをタップ → 置ける場所へ自動で移動
   ・カードを指でドラッグ → 好きな場所へ移動
   ・右上の山札をタップ → カードをめくる
   ・途中の状態はスマホに自動保存（アプリを閉じても続きから）
   ========================================================= */
"use strict";

/* ---------- 決まった値 ---------- */
// マーク（♠♥♦♣）。後ろの ︎ は「絵文字ではなく文字で表示して」という印
const SUITS = ["♠︎", "♥︎", "♦︎", "♣︎"];
// 数字（1〜13）の表示。0番目は使わない
const RANKS = [null, "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
// 保存するときの名前
const SAVE_KEY = "solitaire-save-v1";
// 山札を置く列（0が一番左、6が一番右）。組札は左の4列（0〜3）
const STOCK_COL = 6;

/* ---------- 画面の部品 ---------- */
const board = document.getElementById("board");
const timeEl = document.getElementById("time");
const movesEl = document.getElementById("moves");
// 目安の表示と「配っています…」は、古い画面ファイルには無いことがあるので、無ければ作る
const targetEl = document.getElementById("target") || makeEl("span", "target", document.querySelector(".stats"));
const dealingEl = document.getElementById("dealing") || makeEl("div", "dealing", document.body, "カードを配っています…");
function makeEl(tag, id, parent, text = "") {
  const el = document.createElement(tag);
  el.id = id;
  el.textContent = text;
  if (tag === "div") el.hidden = true;
  (parent || document.body).appendChild(el);
  return el;
}
const winEl = document.getElementById("win");
const winText = document.getElementById("winText");

/* ---------- ゲームの状態 ---------- */
// state の中身：
//   stock       … 右上の山札（裏向き）
//   waste       … 山札からめくったカード
//   foundations … 左上の4つの組札（A→Kの順に積む場所）
//   tableau     … 下の7列の場札
//   moves       … 手数 / elapsed … 経過秒数 / started … 始まったか
//   won         … クリアしたか / drawCount … 1回にめくる枚数（いつも1）
//   target      … 手数の目安（コンピューターが見つけた解き方の手数）
let state;
let history = [];        // 「戻す」用に、1手ごとの状態を記録しておく
const cardEls = {};      // カードの番号 → 画面上のカード部品
const slotEls = {};      // 置き場所のわく
let L;                   // カードの大きさや位置（画面サイズから計算）
let drag = null;         // 今ドラッグしているカードの情報
let autoRunning = false; // 自動片付け中かどうか

/* =========================================================
   ちょっとした道具
   ========================================================= */
// 赤いカード（♥と♦）かどうか
function isRed(card) {
  return card.suit === 1 || card.suit === 2;
}

// 配列の最後（＝一番上のカード）
function topCard(pile) {
  return pile[pile.length - 1];
}

// 秒を「分:秒」の形にする（例：75 → 1:15）
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, "0");
  return m + ":" + s;
}

/* =========================================================
   新しいゲームを始める
   ========================================================= */
// 52枚のカードを作って、よく混ぜる
function createDeck() {
  const deck = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 1; rank <= 13; rank++) {
      // id はカード1枚ごとの番号（0〜51）
      deck.push({ id: suit * 13 + rank - 1, suit, rank, up: false });
    }
  }
  // 「フィッシャー・イェーツ」という、かたよりなく混ぜる方法
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/* ---------- 解き方さがし係（solver.js）とのやりとり ----------
   solver.js は裏側で「必ずクリアできる配り方」と「手数の目安」を探してくれる。
   待たずに遊べるように、次のゲームの配り方を前もって用意しておく。 */
let solver = null;
try {
  solver = new Worker("js/solver.js");
} catch (err) {
  solver = null; // 使えない環境なら、目安なしで遊ぶ
}
let readyDeal = null;   // 用意できた次の配り方
let requesting = false; // 今さがしてもらっている途中か
let onDealReady = null; // 配り方が届いたらすること
let dealing = false;    // 配り方を待っている間は true（操作できない）

function requestDeal() {
  if (!solver || requesting || readyDeal) return;
  requesting = true;
  solver.postMessage("deal");
}

// 届いたときの処理（届かなかったときも、待っている人がいれば先へ進める）
function dealArrived(data) {
  requesting = false;
  readyDeal = data;
  if (onDealReady) {
    const next = onDealReady;
    onDealReady = null;
    next();
  }
}
if (solver) {
  solver.onmessage = (e) => dealArrived(e.data);
  solver.onerror = () => {
    solver = null;
    dealArrived(null);
  };
}

// 新しいゲーム：用意してある配り方があればすぐ配る。なければ届くまで待つ
function newGame() {
  if (readyDeal || !solver) {
    startDeal(readyDeal);
    return;
  }
  dealing = true;
  dealingEl.hidden = false; // 「配っています…」を出す
  onDealReady = () => startDeal(readyDeal);
  requestDeal();
}

// 実際にカードを配る。data は solver.js から届いた配り方（なければ普通に混ぜる）
function startDeal(data) {
  readyDeal = null;
  dealing = false;
  dealingEl.hidden = true;
  const deck = data
    ? data.deck.map((id) => ({ id, suit: Math.floor(id / 13), rank: (id % 13) + 1, up: false }))
    : createDeck();
  const tableau = [[], [], [], [], [], [], []];
  // 1列目に1枚、2列目に2枚 … 7列目に7枚、と配る
  for (let row = 0; row < 7; row++) {
    for (let col = row; col < 7; col++) {
      tableau[col].push(deck.pop());
    }
  }
  // 各列の一番上だけ表にする
  tableau.forEach((col) => (topCard(col).up = true));

  state = {
    stock: deck, // 残りは全部山札へ
    waste: [],
    foundations: [[], [], [], []],
    tableau,
    moves: 0,
    elapsed: 0,
    started: false,
    won: false,
    drawCount: 1, // 1枚めくりだけ
    target: data ? data.target : null, // 手数の目安
  };
  history = [];
  winEl.hidden = true;
  save();
  render();
  updateInfo();
  requestDeal(); // 次のゲームの配り方を、今のうちに裏で用意しておく
}

/* =========================================================
   カードの場所を調べる
   ========================================================= */
// 「場所」は { pile: 種類, i: 何番目の列, idx: 列の中の何枚目 } で表す
function getPile(loc) {
  if (loc.pile === "stock") return state.stock;
  if (loc.pile === "waste") return state.waste;
  if (loc.pile === "foundation") return state.foundations[loc.i];
  return state.tableau[loc.i];
}

// カードの番号から、今どこにあるかを探す
function findCard(id) {
  const check = (pile, name, i) => {
    const idx = pile.findIndex((c) => c.id === id);
    return idx >= 0 ? { pile: name, i, idx } : null;
  };
  let loc = check(state.stock, "stock", 0) || check(state.waste, "waste", 0);
  for (let i = 0; i < 4 && !loc; i++) loc = check(state.foundations[i], "foundation", i);
  for (let i = 0; i < 7 && !loc; i++) loc = check(state.tableau[i], "tableau", i);
  return loc;
}

/* =========================================================
   ルール：置けるかどうか
   ========================================================= */
// 組札（左上）に置けるか：空ならAだけ。それ以外は同じマークで1つ大きい数
function canFoundation(card, fi) {
  const f = state.foundations[fi];
  if (f.length === 0) return card.rank === 1;
  const t = topCard(f);
  return t.suit === card.suit && card.rank === t.rank + 1;
}

// 場札（下の列）に置けるか：空ならKだけ。それ以外は色ちがいで1つ小さい数
function canTableau(card, ti) {
  const col = state.tableau[ti];
  if (col.length === 0) return card.rank === 13;
  const t = topCard(col);
  return t.up && isRed(t) !== isRed(card) && card.rank === t.rank - 1;
}

/* =========================================================
   カードを動かす
   ========================================================= */
// 「戻す」ために今の状態を記録する（経過時間は記録しない）
function snapshot() {
  const { elapsed, ...rest } = state;
  history.push(JSON.stringify(rest));
  if (history.length > 300) history.shift(); // 多くなりすぎたら古いものを捨てる
}

// loc の位置にあるカード（とその上に重なったカード）を target へ動かす
// 動かせたら true、ルール上ダメなら false を返す
function tryMove(loc, target) {
  const src = getPile(loc);
  const cards = src.slice(loc.idx); // つかんだカードから上を全部
  const card = cards[0];

  if (target.pile === "foundation") {
    // 組札には1枚ずつしか置けない
    if (cards.length !== 1 || !canFoundation(card, target.i)) return false;
  } else {
    if (loc.pile === "tableau" && loc.i === target.i) return false; // 同じ列は意味がない
    if (!canTableau(card, target.i)) return false;
  }

  snapshot();
  src.splice(loc.idx); // 元の場所から取り除いて
  getPile(target).push(...cards); // 新しい場所に積む
  afterMove();
  return true;
}

// 山札をタップしたとき：めくる。山札が空なら、めくったカードを山札に戻す
function drawStock() {
  if (state.stock.length === 0) {
    if (state.waste.length === 0) return;
    snapshot();
    state.stock = state.waste.reverse().map((c) => ({ ...c, up: false }));
    state.waste = [];
  } else {
    snapshot();
    const n = Math.min(state.drawCount, state.stock.length);
    for (let k = 0; k < n; k++) {
      const c = state.stock.pop();
      c.up = true;
      state.waste.push(c);
    }
  }
  afterMove();
}

// 1手動かしたあとに毎回やること
function afterMove() {
  // 場札の一番上が裏向きなら、自動で表にする
  state.tableau.forEach((col) => {
    if (col.length && !topCard(col).up) topCard(col).up = true;
  });
  state.moves++;
  state.started = true; // ここから時間を数え始める
  save();
  render();
  updateInfo();
  checkWin();
  // 全部表向きになったら、少し待ってから自動で片付け始める
  if (canAutoComplete()) setTimeout(autoComplete, 350);
}

// 「戻す」ボタン
function undo() {
  if (autoRunning || state.won || history.length === 0) return;
  const prev = JSON.parse(history.pop());
  state = { ...prev, elapsed: state.elapsed }; // 時間は戻さない
  save();
  render();
  updateInfo();
}

// カードをタップしたとき：置ける場所を自動で探して動かす
function autoMove(loc) {
  const src = getPile(loc);
  const card = src[loc.idx];
  const isTopCard = loc.idx === src.length - 1;

  // ① 一番上のカードなら、まず組札（左上）に置けるか試す
  if (isTopCard && loc.pile !== "foundation") {
    for (let fi = 0; fi < 4; fi++) {
      if (tryMove(loc, { pile: "foundation", i: fi })) return;
    }
  }

  // ② 場札の列に置けるか試す（空いている列は最後の手段）
  let emptyCol = -1;
  for (let ti = 0; ti < 7; ti++) {
    if (loc.pile === "tableau" && ti === loc.i) continue;
    if (state.tableau[ti].length === 0) {
      // すでに列の一番下にあるKを、別の空き列へ動かしても意味がないので除く
      const alreadyBottom = loc.pile === "tableau" && loc.idx === 0;
      if (card.rank === 13 && emptyCol < 0 && !alreadyBottom) emptyCol = ti;
      continue;
    }
    if (tryMove(loc, { pile: "tableau", i: ti })) return;
  }
  if (emptyCol >= 0 && tryMove(loc, { pile: "tableau", i: emptyCol })) return;

  // ③ どこにも置けない → プルプルさせて知らせる
  shake(src.slice(loc.idx));
}

// めくった札をタップしたとき：左上の組札に置けるなら収納する
function storeToFoundation(loc) {
  for (let fi = 0; fi < 4; fi++) {
    if (tryMove(loc, { pile: "foundation", i: fi })) return;
  }
  shake([getPile(loc)[loc.idx]]); // 収納できない → プルプル
}

// カードをプルプルふるわせて「ここには置けない」と知らせる
function shake(cards) {
  cards.forEach((c) => {
    const el = cardEls[c.id];
    el.classList.remove("shake");
    void el.offsetWidth; // アニメーションをもう一度動かすためのおまじない
    el.classList.add("shake");
  });
}

/* =========================================================
   クリア判定と自動片付け
   ========================================================= */
function checkWin() {
  if (state.won) return;
  if (state.foundations.every((f) => f.length === 13)) {
    state.won = true;
    save();
    setTimeout(() => {
      winText.innerHTML = scoreHTML();
      winEl.hidden = false;
    }, 400);
  }
}

// クリアしたときの採点：自分の手数と目安の差で星をつける
function scoreHTML() {
  const info = `あなた ${state.moves}手` +
    (state.target ? `　／　目安 ${state.target}手` : "") +
    `<br>タイム ${formatTime(state.elapsed)}`;
  if (!state.target) return `<div class="sub">${info}</div>`;

  const diff = state.moves - state.target; // プラスなら目安より多い
  let stars, msg;
  if (diff < 0) {
    stars = "★★★";
    msg = `目安より ${-diff}手 少ない！すごい！`;
  } else if (diff === 0) {
    stars = "★★★";
    msg = "目安ぴったり！";
  } else if (diff <= 10) {
    stars = "★★☆";
    msg = `目安との差 +${diff}手　おしい！`;
  } else if (diff <= 30) {
    stars = "★☆☆";
    msg = `目安との差 +${diff}手`;
  } else {
    stars = "☆☆☆";
    msg = `目安との差 +${diff}手　次はもっと少なく！`;
  }
  return `<div class="stars">${stars}</div><div class="diff">${msg}</div><div class="sub">${info}</div>`;
}

// 山札もめくった札もなくなり、場札が全部表向きになったら、あとは片付けるだけ
function canAutoComplete() {
  return (
    !state.won &&
    !autoRunning &&
    state.stock.length === 0 && // 山札が残っている間は、自分でめくって置く
    state.waste.length === 0 && // めくった札も、自分で場か組札に置き終わるまで待つ
    state.tableau.every((col) => col.every((c) => c.up))
  );
}

// 場札の一番上から、組札に置けるカードを1枚探して動かす。動かせたら true
function moveOneToFoundation() {
  for (let ti = 0; ti < 7; ti++) {
    const col = state.tableau[ti];
    if (!col.length) continue;
    for (let fi = 0; fi < 4; fi++) {
      if (tryMove({ pile: "tableau", i: ti, idx: col.length - 1 }, { pile: "foundation", i: fi })) return true;
    }
  }
  return false;
}

// 1枚ずつ、少し時間をあけて組札へ運ぶ（自動で動く）
function autoComplete() {
  if (!canAutoComplete()) return;
  autoRunning = true;
  const step = () => {
    if (!state.won && moveOneToFoundation()) {
      setTimeout(step, 90); // 0.09秒ごとに1枚
      return;
    }
    autoRunning = false; // 全部片付いた（または、もう動かせるカードがない）
  };
  step();
}

/* =========================================================
   画面に描く
   ========================================================= */
// 画面の大きさから、カードの大きさと位置を計算する
function computeLayout() {
  const W = board.clientWidth;
  const H = board.clientHeight;
  const gap = Math.max(3, Math.round(W * 0.012)); // カードとカードのすき間
  // 横に7枚並ぶ大きさ。ただし横向き画面で大きくなりすぎないように制限
  let cw = (W - gap * 8) / 7;
  cw = Math.floor(Math.min(cw, (H * 0.22) / 1.4, 110));
  const ch = Math.round(cw * 1.4); // カードの縦は横の1.4倍
  const left = Math.round((W - (cw * 7 + gap * 6)) / 2); // 真ん中に寄せる
  const topY = Math.round(gap * 1.5); // 上の段（山札・組札）の高さ
  const tabY = topY + ch + gap * 3; // 下の段（場札）の高さ
  return { W, H, gap, cw, ch, left, topY, tabY, colX: (i) => left + i * (cw + gap) };
}

/* ---------- カードの絵柄 ---------- */
// 2〜10 のマークの位置。本物のトランプと同じ並び方
// [横の位置(%), 縦の位置(%)]  横は 20=左, 50=真ん中, 80=右
const PIP_LAYOUT = {
  2: [[50, 0], [50, 100]],
  3: [[50, 0], [50, 50], [50, 100]],
  4: [[20, 0], [80, 0], [20, 100], [80, 100]],
  5: [[20, 0], [80, 0], [50, 50], [20, 100], [80, 100]],
  6: [[20, 0], [80, 0], [20, 50], [80, 50], [20, 100], [80, 100]],
  7: [[20, 0], [80, 0], [50, 25], [20, 50], [80, 50], [20, 100], [80, 100]],
  8: [[20, 0], [80, 0], [50, 25], [20, 50], [80, 50], [50, 75], [20, 100], [80, 100]],
  9: [[20, 0], [80, 0], [20, 33], [80, 33], [50, 50], [20, 67], [80, 67], [20, 100], [80, 100]],
  10: [[20, 0], [80, 0], [50, 17], [20, 33], [80, 33], [20, 67], [80, 67], [50, 83], [20, 100], [80, 100]],
};

// カードの下の部分（数字の下）の中身を作る
function cardBody(rank, suit) {
  const s = SUITS[suit];
  if (rank === 1) return `<span class="ace">${s}</span>`; // A は大きなマーク1つ
  if (rank >= 11) return `<div class="face">${faceSVG(rank, suit)}</div>`; // 絵札
  // 2〜10：決まった位置にマークを並べる（下半分は逆さま）
  const pips = PIP_LAYOUT[rank]
    .map(([x, y]) => `<span${y > 50 ? ' class="flip"' : ""} style="left:${x}%;top:${y}%">${s}</span>`)
    .join("");
  return `<div class="pips">${pips}</div>`;
}

// J・Q・K の絵（SVG という、図形で絵を描くしくみを使う）
// 本物のトランプのように、上半分に人物を描き、下半分には同じ絵を逆さまにして描く
function faceSVG(rank, suit) {
  const red = suit === 1 || suit === 2;
  // トランプの絵札でよく使われる、赤・青・黄・黒の4色
  const main = red ? "#c8202a" : "#1f4fa0"; // 服の色
  const trim = red ? "#1f4fa0" : "#c8202a"; // 飾りの色（服と反対の色）
  const yellow = "#f2c230"; // 金色の飾り
  const ink = "#222"; // 輪かくの線
  const skin = "#f8d6ae"; // 肌の色
  const suitColor = red ? "#c8202a" : "#222";
  const line = `stroke="${ink}" stroke-width=".5"`;
  // 共通パーツ：顔と目
  const face = `<ellipse cx="30" cy="15" rx="6" ry="6.8" fill="${skin}" ${line}/>`;
  const eyes = `<circle cx="27.6" cy="14.3" r=".8" fill="${ink}"/><circle cx="32.4" cy="14.3" r=".8" fill="${ink}"/>`;
  // 小さなマーク（人物の横に置く）
  const mark = (x) =>
    `<text x="${x}" y="11" font-size="9" text-anchor="middle" fill="${suitColor}">${SUITS[suit]}</text>`;

  let half = ""; // 上半分の絵（y が 0〜33 の範囲に描く）

  if (rank === 13) {
    // ---- K：王様（剣・王冠・ひげ・毛皮のえり） ----
    half =
      `<line x1="47" y1="2" x2="47" y2="33" stroke="#8e99a6" stroke-width="1.6"/>` + // 剣
      `<line x1="43.5" y1="9" x2="50.5" y2="9" stroke="${yellow}" stroke-width="1.8"/>` + // 剣のつば
      `<circle cx="47" cy="2.2" r="1.3" fill="${yellow}"/>` +
      `<path d="M9 33 L12 24 Q30 19 48 24 L51 33 Z" fill="${main}" ${line}/>` + // 服
      `<path d="M12.5 24.5 L16 33 M47.5 24.5 L44 33" stroke="${yellow}" stroke-width="2"/>` + // 服のもよう
      `<rect x="27" y="22" width="6" height="11" fill="${yellow}" ${line}/>` +
      `<circle cx="30" cy="27" r=".9" fill="${trim}"/><circle cx="30" cy="31" r=".9" fill="${trim}"/>` +
      `<path d="M19 23.5 Q30 28.5 41 23.5 L41 26 Q30 31 19 26 Z" fill="#fff" ${line}/>` + // 毛皮のえり
      `<circle cx="23" cy="26" r=".6" fill="${ink}"/><circle cx="37" cy="26" r=".6" fill="${ink}"/>` +
      face +
      `<path d="M24 16 Q24.5 25 30 26 Q35.5 25 36 16 Q33 19.5 30 19 Q27 19.5 24 16 Z" fill="#6b3e1c"/>` + // ひげ
      `<path d="M27 18.3 Q30 16.8 33 18.3 Q30 19.3 27 18.3 Z" fill="#4a2a12"/>` + // 口ひげ
      eyes +
      `<path d="M23 9 L23 2.5 L26.3 5.5 L30 1 L33.7 5.5 L37 2.5 L37 9 Z" fill="${yellow}" ${line}/>` + // 王冠
      `<rect x="23" y="7.3" width="14" height="2" fill="${trim}"/>` +
      mark(12);
  } else if (rank === 12) {
    // ---- Q：女王様（長い髪・王冠・お花） ----
    half =
      `<path d="M23 10 Q21 22 24 25 L36 25 Q39 22 37 10 Q30 4 23 10 Z" fill="#d08a2a" ${line}/>` + // 長い髪
      `<path d="M9 33 L13 25 Q30 20 47 25 L51 33 Z" fill="${main}" ${line}/>` + // ドレス
      `<path d="M16 24.5 L30 33 L44 24.5" fill="none" stroke="${yellow}" stroke-width="2"/>` + // ドレスのもよう
      `<path d="M22 23 L30 29 L38 23" fill="none" stroke="#fff" stroke-width="1.4"/>` +
      face +
      `<path d="M23.8 12 Q30 6 36.2 12 Q33 9.8 30 10.3 Q27 9.8 23.8 12 Z" fill="#d08a2a"/>` + // 前髪
      eyes +
      `<ellipse cx="30" cy="18.8" rx="1.5" ry=".7" fill="#c8202a"/>` + // くちびる
      `<path d="M24 9 L24.3 4 L27 6.3 L30 3 L33 6.3 L35.7 4 L36 9 Z" fill="${yellow}" ${line}/>` + // 王冠
      `<line x1="46" y1="33" x2="46" y2="19" stroke="#2f7d32" stroke-width="1.2"/>` + // お花のくき
      `<circle cx="44.4" cy="17" r="1.7" fill="#e0457b"/><circle cx="47.6" cy="17" r="1.7" fill="#e0457b"/>` + // 花びら
      `<circle cx="46" cy="15.4" r="1.7" fill="#e0457b"/><circle cx="46" cy="18.6" r="1.7" fill="#e0457b"/>` +
      `<circle cx="46" cy="17" r="1.1" fill="${yellow}"/>` +
      mark(12);
  } else {
    // ---- J：若い騎士（やり・羽根つきのぼうし） ----
    half =
      `<line x1="13" y1="1" x2="13" y2="33" stroke="#7a4a22" stroke-width="1.4"/>` + // やりの柄
      `<path d="M13 3.5 L18 5.5 L18 10 L13 8.5 Z" fill="#8e99a6" ${line}/>` + // やりの刃
      `<path d="M9 33 L13 24 Q30 19.5 47 24 L51 33 Z" fill="${main}" ${line}/>` + // 服
      `<path d="M20 22.5 L24 33 M40 22.5 L36 33" stroke="${yellow}" stroke-width="2"/>` + // 服のもよう
      `<path d="M23 22.5 Q30 27 37 22.5 L37 24.5 Q30 29 23 24.5 Z" fill="#fff" ${line}/>` + // えり
      `<path d="M23.5 10 Q22.5 20 25 22 L35 22 Q37.5 20 36.5 10 Z" fill="#e3a43a"/>` + // 髪
      face +
      eyes +
      `<path d="M28 18.3 Q30 19.8 32 18.3" fill="none" stroke="#a0522d" stroke-width=".8" stroke-linecap="round"/>` + // 口
      `<path d="M36 5 Q42 0 49 1 Q43 4 37.5 8 Z" fill="#fff" ${line}/>` + // 羽根
      `<path d="M22 10.5 Q23 2.5 30 2.5 Q37 2.5 38 10.5 Z" fill="${trim}" ${line}/>` + // ぼうし
      `<rect x="22" y="8.8" width="16" height="2" fill="${yellow}"/>` +
      mark(48);
  }

  return (
    `<svg viewBox="0 0 60 66" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x=".8" y=".8" width="58.4" height="64.4" rx="3" fill="#fffaf0" stroke="${suitColor}" stroke-width="1.2"/>` + // わく
    `<g>${half}</g>` + // 上半分
    `<g transform="rotate(180 30 33)">${half}</g>` + // 下半分（同じ絵を逆さまに）
    `<line x1="6" y1="33" x2="54" y2="33" stroke="${suitColor}" stroke-width=".6"/>` + // 真ん中の線
    `</svg>`
  );
}

// 最初に1回だけ、カード52枚とわくを作る
function buildElements() {
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 1; rank <= 13; rank++) {
      const el = document.createElement("div");
      el.className = "card" + (suit === 1 || suit === 2 ? " red" : "");
      const id = suit * 13 + rank - 1;
      el.dataset.id = id;
      el.style.left = "-999px"; // 最初に配るまでは画面の外に置いておく
      el.innerHTML =
        `<span class="corner${rank === 10 ? " ten" : ""}">${RANKS[rank]}<i>${SUITS[suit]}</i></span>` +
        cardBody(rank, suit);
      cardEls[id] = el;
    }
  }
  // わく：山札・めくり札・組札4つ・場札7列
  const makeSlot = (key, text = "") => {
    const el = document.createElement("div");
    el.className = "slot";
    el.dataset.slot = key;
    el.textContent = text;
    board.appendChild(el);
    slotEls[key] = el;
  };
  makeSlot("stock");
  makeSlot("waste");
  for (let i = 0; i < 4; i++) makeSlot("f" + i, "A");
  for (let i = 0; i < 7; i++) makeSlot("t" + i);
  // カードはわくより後に入れる（わくの上に表示されるように）
  Object.values(cardEls).forEach((el) => board.appendChild(el));
}

// カード1枚を (x, y) の位置に置く。z は重なり順
function place(card, x, y, z) {
  const el = cardEls[card.id];
  el.style.left = x + "px";
  el.style.top = y + "px";
  el.style.zIndex = z;
  el.style.transform = "";
  el.classList.toggle("down", !card.up);
  el.classList.remove("dragging");
}

// わく1つを置く
function placeSlot(key, x, y) {
  slotEls[key].style.left = x + "px";
  slotEls[key].style.top = y + "px";
}

// 今の状態どおりに、全部のカードを並べ直す
function render() {
  L = computeLayout();
  board.style.setProperty("--cw", L.cw + "px");
  board.style.setProperty("--ch", L.ch + "px");
  let z = 1;

  // --- 山札（右上：一番右の列） ---
  placeSlot("stock", L.colX(STOCK_COL), L.topY);
  // 山札が空でも戻せるカードがあるときは「↻」を出す
  slotEls.stock.textContent = state.stock.length === 0 && state.waste.length > 0 ? "↻" : "";
  state.stock.forEach((c) => place(c, L.colX(STOCK_COL), L.topY, z++));

  // --- めくったカード（山札の左） ---
  // 3枚めくりのときは、左から右へ少しずつずらして見せる。
  // 一番上のカードがいつも山札のすぐ左に来るように、ずらす分だけ左から始める
  const wasteX = L.colX(STOCK_COL - 1);
  placeSlot("waste", wasteX, L.topY);
  const fanFrom = state.drawCount === 3 ? Math.max(0, state.waste.length - 3) : state.waste.length;
  const shift = L.cw * 0.5;
  const fanCount = state.waste.length - fanFrom; // ずらして見せる枚数（0〜3）
  state.waste.forEach((c, k) => {
    // 下に隠れているカードは、一番左のずらしたカードと同じ位置
    const fromRight = k >= fanFrom ? state.waste.length - 1 - k : fanCount - 1;
    place(c, wasteX - Math.max(0, fromRight) * shift, L.topY, z++);
  });

  // --- 組札（左上の4つ） ---
  state.foundations.forEach((f, i) => {
    placeSlot("f" + i, L.colX(i), L.topY);
    f.forEach((c) => place(c, L.colX(i), L.topY, z++));
  });

  // --- 場札（下の7列） ---
  const downStep = L.ch * 0.1; // 裏向きカードの重なり幅
  const upStep = L.ch * 0.4; // 表向きカードの重なり幅
  const room = L.H - L.tabY - L.ch - L.gap; // 下に使える高さ
  state.tableau.forEach((col, i) => {
    placeSlot("t" + i, L.colX(i), L.tabY);
    // 列が長くて画面からはみ出しそうなら、重なり幅を縮める
    let need = 0;
    col.forEach((c, k) => { if (k < col.length - 1) need += c.up ? upStep : downStep; });
    const shrink = need > room ? room / need : 1;
    let y = L.tabY;
    col.forEach((c) => {
      place(c, L.colX(i), y, z++);
      y += (c.up ? upStep : downStep) * shrink;
    });
  });

}

// 上のバーの時間・手数・目安を更新
function updateInfo() {
  timeEl.textContent = "⏱ " + formatTime(state.elapsed);
  movesEl.textContent = state.moves + "手";
  targetEl.textContent = state.target ? "目安 " + state.target + "手" : "";
}

/* =========================================================
   指（マウス）の操作
   ========================================================= */
board.addEventListener("pointerdown", (e) => {
  if (!state || dealing || autoRunning || state.won || drag) return;

  // 山札の場所をタップしたら、必ずめくる
  // （すばやく連打したとき、移動中のカードに当たってしまうのを防ぐ）
  const r = board.getBoundingClientRect();
  const bx = e.clientX - r.left;
  const by = e.clientY - r.top;
  // 山札の少し上（盤のいちばん上のすき間）をタップしたときも、山札をめくる
  const sx = L.colX(STOCK_COL);
  if (bx >= sx - L.gap / 2 && bx <= sx + L.cw + L.gap / 2 && by >= 0 && by <= L.topY + L.ch) {
    e.preventDefault();
    lastStockTap = Date.now();
    drawStock();
    return;
  }

  const target = e.target.closest(".card, .slot");
  if (!target) return;
  e.preventDefault();

  // 空の山札のわくをタップ → めくったカードを山札に戻す
  if (target.classList.contains("slot")) {
    if (target.dataset.slot === "stock") drawStock();
    return;
  }

  const loc = findCard(Number(target.dataset.id));
  if (loc.pile === "stock") { drawStock(); return; }

  const pile = getPile(loc);
  const card = pile[loc.idx];
  if (!card.up) return; // 裏向きは動かせない
  // 場札以外（めくり札・組札）は一番上の1枚だけ動かせる
  if (loc.pile !== "tableau" && loc.idx !== pile.length - 1) return;

  const cards = pile.slice(loc.idx);
  drag = {
    loc,
    els: cards.map((c) => cardEls[c.id]),
    x0: e.clientX,
    y0: e.clientY,
    moved: false,
    pointerId: e.pointerId,
  };
});

window.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const dx = e.clientX - drag.x0;
  const dy = e.clientY - drag.y0;
  // 少し動いたら「ドラッグ」とみなす（ちょっとのブレはタップ扱い）
  if (!drag.moved && Math.hypot(dx, dy) > 6) {
    drag.moved = true;
    drag.els.forEach((el, k) => {
      el.classList.add("dragging");
      el.style.zIndex = 1000 + k; // 一番手前に
    });
  }
  if (drag.moved) {
    drag.els.forEach((el) => (el.style.transform = `translate(${dx}px, ${dy}px)`));
  }
});

window.addEventListener("pointerup", (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  drag = null;

  // 動かしていない → タップ。自動で置き場所を探す
  // ただし、めくった札（山札の左の札）は、タップすると左上の組札にだけ収納する
  // （場札の列に置きたいときはドラッグで動かす）
  if (!d.moved) {
    if (d.loc.pile === "waste") storeToFoundation(d.loc);
    else autoMove(d.loc);
    return;
  }

  const dx = e.clientX - d.x0;
  const dy = e.clientY - d.y0;
  // 指を離した位置にカードをいったん止める（ここから元の場所や新しい場所へ動かす）
  d.els.forEach((el) => {
    el.style.left = parseFloat(el.style.left) + dx + "px";
    el.style.top = parseFloat(el.style.top) + dy + "px";
    el.style.transform = "";
  });
  void board.offsetWidth; // 位置の変更をいったん確定させる
  d.els.forEach((el) => el.classList.remove("dragging"));

  // つかんだカードの真ん中が、どの場所の上にあるか
  const first = d.els[0];
  const cx = parseFloat(first.style.left) + L.cw / 2;
  const cy = parseFloat(first.style.top) + L.ch / 2;
  const t = dropTarget(cx, cy);
  if (!(t && tryMove(d.loc, t))) render(); // 置けなければ元の場所へ戻す
});

// 電話がかかってきた等で操作が中断されたとき
window.addEventListener("pointercancel", () => {
  if (!drag) return;
  drag = null;
  render();
});

// 盤の上の (x, y) が、どの置き場所に当たるかを調べる
function dropTarget(x, y) {
  const col = Math.floor((x - L.left + L.gap / 2) / (L.cw + L.gap));
  if (col < 0 || col > 6) return null;
  if (y < L.tabY - L.gap) {
    // 上の段：左の4つが組札
    return col <= 3 ? { pile: "foundation", i: col } : null;
  }
  return { pile: "tableau", i: col };
}

/* =========================================================
   ボタン
   ========================================================= */
document.getElementById("newBtn").addEventListener("click", () => {
  if (!state || dealing || autoRunning) return;
  if (state.moves > 0 && !state.won && !confirm("今のゲームをやめて、新しいゲームを始めますか？")) return;
  newGame();
});

// 山札を連打している最中に指が「戻す」に当たっても戻らないように、
// 山札をタップしてから少しの間（0.6秒）は「戻す」を受け付けない
let lastStockTap = 0;
document.getElementById("undoBtn").addEventListener("click", () => {
  if (Date.now() - lastStockTap < 600) return;
  if (state && !dealing) undo();
});

document.getElementById("againBtn").addEventListener("click", () => newGame());

/* =========================================================
   保存と読み込み（スマホの中に保存）
   ========================================================= */
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ state, history: history.slice(-100) }));
  } catch (err) {
    // 保存できなくてもゲームは続けられるので、何もしない
  }
}

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (data && data.state && data.state.tableau && data.state.tableau.length === 7) {
      state = data.state;
      history = data.history || [];
      return true;
    }
  } catch (err) {
    // 壊れたデータなら無視して新しく始める
  }
  return false;
}

/* =========================================================
   タイマー（1秒ごとに経過時間を増やす）
   ========================================================= */
setInterval(() => {
  // 始まっていて、クリア前で、画面が見えているときだけ数える
  if (state && !dealing && state.started && !state.won && document.visibilityState === "visible") {
    state.elapsed++;
    updateInfo();
    if (state.elapsed % 5 === 0) save(); // 5秒ごとに保存
  }
}, 1000);

/* =========================================================
   スタート！
   ========================================================= */
buildElements();
if (load() && !state.won && state.drawCount === 1) {
  // 前回の続きから
  render();
  updateInfo();
  if (canAutoComplete()) setTimeout(autoComplete, 500); // 片付けの途中だったら続ける
  requestDeal(); // 次のゲームの配り方を用意しておく
} else {
  // 初めて／前回クリア済み／前の3枚めくりのゲーム → 新しいゲーム
  state = null;
  newGame();
}

// 画面の向きや大きさが変わったら並べ直す
window.addEventListener("resize", () => {
  if (state) render();
});

// オフラインでも遊べるようにする仕組み（サービスワーカー）を登録
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
