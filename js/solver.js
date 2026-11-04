/* =========================================================
   解き方さがし（ソルバー）
   ---------------------------------------------------------
   ・ゲームとは別に、裏側（Web Worker という別の作業場所）で動く
   ・カードを配って、クリアまでの手順をコンピューターが探す
   ・見つかったら「配り方」と「手数の目安」をゲームに知らせる
   ・見つからない配り方は捨てて、配り直す（＝必ずクリアできるゲームになる）

   手数の数え方はゲームと同じ：
     カードを1回動かす＝1手、山札を1枚めくる＝1手、山札を戻す＝1手
   ========================================================= */
"use strict";

/* ---------- カードは 0〜51 の番号で表す ---------- */
// 番号 = マーク×13 + (数字-1)。マーク：0=♠ 1=♥ 2=♦ 3=♣
const SUIT = (c) => (c / 13) | 0;
const RANK = (c) => (c % 13) + 1;
const IS_RED = (c) => {
  const s = SUIT(c);
  return s === 1 || s === 2;
};

// 52枚をよく混ぜた並びを作る（ゲームの createDeck と同じ混ぜ方）
function shuffledDeck() {
  const deck = [];
  for (let i = 0; i < 52; i++) deck.push(i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/* ---------- 盤の状態 ----------
   tab  … 場札7列（下から順）。down[i] はその列の裏向きの枚数
   f    … 組札4つ。マークごとに何枚積んだか
   T    … 山札とめくった札を「めくる順」に1列に並べたもの
   p    … そのうち何枚めくってあるか（T[p-1] がめくった札の一番上）
*/
function initialState(deck) {
  const d = deck.slice();
  const tab = [[], [], [], [], [], [], []];
  // ゲームと同じ配り方（後ろから1枚ずつ取る）
  for (let row = 0; row < 7; row++) {
    for (let col = row; col < 7; col++) tab[col].push(d.pop());
  }
  // 残りは山札。ゲームでは後ろから順にめくるので、逆順にすると「めくる順」になる
  return { tab, down: [0, 1, 2, 3, 4, 5, 6], f: [0, 0, 0, 0], T: d.reverse(), p: 0 };
}

// 組札に置けるか
function canF(c, f) {
  return f[SUIT(c)] === RANK(c) - 1;
}

// 場札の列に置けるか（空ならKだけ、それ以外は色ちがいで1つ小さい数）
function canT(c, col) {
  if (col.length === 0) return RANK(c) === 13;
  const t = col[col.length - 1];
  return IS_RED(t) !== IS_RED(c) && RANK(t) === RANK(c) + 1;
}

// 組札に置いても損をしないカードか
// （そのカードの上に置きたくなる「反対の色で1つ小さい数」が、もう全部組札にある）
function isSafe(c, f) {
  const r = RANK(c);
  if (r <= 2) return true;
  return IS_RED(c) ? f[0] >= r - 1 && f[3] >= r - 1 : f[1] >= r - 1 && f[2] >= r - 1;
}

// 状態のコピー（変える列だけ後で新しく作る）
function clone(s) {
  return { tab: s.tab.slice(), down: s.down.slice(), f: s.f.slice(), T: s.T, p: s.p };
}

// 列 a の k 枚目から上を取り除く。裏向きのカードが一番上に出たら表にする
function cutColumn(n, a, k) {
  n.tab[a] = n.tab[a].slice(0, k);
  if (k > 0 && k === n.down[a]) n.down[a]--;
}

// 今の状態から打てる手を全部あげる。[次の状態, 手数, 手の内容] のリスト
function successors(s) {
  const out = [];

  // ① 損をしない組札への移動があれば、それだけを打つ（考える手を減らす工夫）
  for (let a = 0; a < 7; a++) {
    const col = s.tab[a];
    if (!col.length) continue;
    const c = col[col.length - 1];
    if (canF(c, s.f) && isSafe(c, s.f)) {
      const n = clone(s);
      n.f[SUIT(c)]++;
      cutColumn(n, a, col.length - 1);
      return [[n, 1, { kind: "tableau", a, idx: col.length - 1, to: "f" }]];
    }
  }

  // ② 場札の一番上 → 組札
  for (let a = 0; a < 7; a++) {
    const col = s.tab[a];
    if (!col.length) continue;
    const c = col[col.length - 1];
    if (canF(c, s.f)) {
      const n = clone(s);
      n.f[SUIT(c)]++;
      cutColumn(n, a, col.length - 1);
      out.push([n, 1, { kind: "tableau", a, idx: col.length - 1, to: "f" }]);
    }
  }

  // ③ 山札のカード → 組札 or 場札
  //   山札は何度でも戻せるので、どのカードも「めくれば」使える。
  //   めくる回数（戻す1手も含む）を手数に足す
  const L = s.T.length;
  for (let j = 0; j < L; j++) {
    const c = s.T[j];
    const draws = j >= s.p - 1 ? j - s.p + 1 : L - s.p + 1 + (j + 1);
    const toF = canF(c, s.f);
    const targets = [];
    let emptyUsed = false;
    for (let b = 0; b < 7; b++) {
      if (!canT(c, s.tab[b])) continue;
      if (s.tab[b].length === 0) {
        if (emptyUsed) continue; // 空いている列はどれも同じなので1つだけ
        emptyUsed = true;
      }
      targets.push(b);
    }
    if (!toF && !targets.length) continue;
    const T2 = s.T.slice(0, j).concat(s.T.slice(j + 1));
    if (toF) {
      const n = clone(s);
      n.T = T2;
      n.p = j;
      n.f[SUIT(c)]++;
      out.push([n, draws + 1, { kind: "waste", draws, to: "f" }]);
    }
    for (const b of targets) {
      const n = clone(s);
      n.T = T2;
      n.p = j;
      n.tab[b] = s.tab[b].concat([c]);
      out.push([n, draws + 1, { kind: "waste", draws, to: b }]);
    }
  }

  // ④ 場札の表向きの束 → 別の列
  for (let a = 0; a < 7; a++) {
    const col = s.tab[a];
    for (let k = s.down[a]; k < col.length; k++) {
      // 束の途中から動かすのは、下に出てくるカードが組札に行けるときだけ
      if (k > s.down[a] && !canF(col[k - 1], s.f)) continue;
      let emptyUsed = false;
      for (let b = 0; b < 7; b++) {
        if (b === a || !canT(col[k], s.tab[b])) continue;
        if (s.tab[b].length === 0) {
          // 列ごと空の列へ動かしても意味がない
          if (k === 0 || emptyUsed) continue;
          emptyUsed = true;
        }
        const n = clone(s);
        n.tab[b] = s.tab[b].concat(col.slice(k));
        cutColumn(n, a, k);
        out.push([n, 1, { kind: "tableau", a, idx: k, to: b }]);
      }
    }
  }
  return out;
}

// 同じ状態を何度も調べないための「名前」を作る
// （列の順番がちがうだけの状態は同じとみなす）
function keyOf(s) {
  const cols = [];
  for (let a = 0; a < 7; a++) {
    cols.push(String.fromCharCode(33 + s.down[a], ...s.tab[a].map((c) => c + 60)));
  }
  cols.sort();
  return String.fromCharCode(...s.f.map((x) => x + 33), s.p + 33, ...s.T.map((c) => c + 60)) + "|" + cols.join("|");
}

const sumF = (s) => s.f[0] + s.f[1] + s.f[2] + s.f[3];
const sumDown = (s) => s.down.reduce((x, y) => x + y, 0);

/* ---------- 優先度つきの順番待ち（小さい順に取り出す） ---------- */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(x) {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].pri <= a[i].pri) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].pri < a[m].pri) m = l;
        if (r < a.length && a[r].pri < a[m].pri) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/* ---------- 解き方をさがす ----------
   「今までの手数 ＋ W × 残りの見込み」が小さい状態から順に調べる。
   W が大きいほど速く見つかるが、手数は多めになりやすい。
   場札が全部表向きで山札もなくなったら、あとは残りを組札へ運ぶだけなのでゴール。
*/
function search(start, W, deadline, bestSoFar) {
  const heap = new Heap();
  const seen = new Map();
  const h = (s) => 52 - sumF(s) + sumDown(s);
  heap.push({ s: start, g: 0, pri: 0, parent: null, move: null });
  seen.set(keyOf(start), 0);
  let count = 0;
  while (heap.size) {
    const node = heap.pop();
    const s = node.s;
    if (++count % 512 === 0 && Date.now() > deadline) return null; // 時間切れ
    if (s.T.length === 0 && sumDown(s) === 0) {
      // ゴール：残りのカードは1枚1手で組札へ
      const total = node.g + (52 - sumF(s));
      const path = [];
      for (let n = node; n.parent; n = n.parent) path.push(n.move);
      return { moves: total, path: path.reverse() };
    }
    for (const [n, cost, move] of successors(s)) {
      const g = node.g + cost;
      if (g + (52 - sumF(n)) >= bestSoFar) continue; // 今の最良より良くならない
      const k = keyOf(n);
      const old = seen.get(k);
      if (old !== undefined && old <= g) continue;
      seen.set(k, g);
      heap.push({ s: n, g, pri: g + W * h(n), parent: node, move });
    }
  }
  return null;
}

// 1つの配り方について、なるべく短い解き方をさがす
// 見つからなければ null（＝この配り方は使わない）
function solveDeal(deck, firstMs = 800, refineMs = 700) {
  const start = initialState(deck);
  let best = search(start, 3, Date.now() + firstMs, Infinity);
  if (!best) return null;
  // 見つかったら、残りの時間でもっと短い解き方を探す
  const end = Date.now() + refineMs;
  for (const W of [2, 1.5, 1.2]) {
    if (Date.now() >= end) break;
    const r = search(start, W, end, best.moves);
    if (r && r.moves < best.moves) best = r;
  }
  return best;
}

/* ---------- ゲームとのやりとり ---------- */
// ゲームから「配って」と頼まれたら、解ける配り方が見つかるまで配り直す
if (typeof self !== "undefined" && typeof self.postMessage === "function" && typeof module === "undefined") {
  self.onmessage = () => {
    for (let tries = 1; tries <= 40; tries++) {
      const deck = shuffledDeck();
      const r = solveDeal(deck);
      if (r) {
        self.postMessage({ deck, target: r.moves, path: r.path, tries });
        return;
      }
    }
    // 万一ずっと見つからなければ、目安なしで配る
    self.postMessage({ deck: shuffledDeck(), target: null, path: null, tries: 40 });
  };
}

// テスト用（パソコンの node で動かすとき）
if (typeof module !== "undefined") {
  module.exports = { shuffledDeck, solveDeal, initialState, successors, keyOf };
}
