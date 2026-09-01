/*
 * data/questions.js の日本語文にふりがなを付ける注釈データを生成する。
 *
 *   node tools/gen-furigana.mjs
 *   -> data/furigana.js   window.FE_RUBY = { <id>: {...} }
 *
 * 本文は複製せず「文字位置 + 読み」だけを持つ。各フィールドの値は
 *   "<原文の文字数>;<開始>,<長さ>,<読み>|<開始>,<長さ>,<読み>|…"
 * 原文が更新されて文字数が合わなくなった場合，実行時にそのフィールドの
 * 注釈だけを捨てられるようにするための保険である。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import kuromoji from "kuromoji";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DICT = path.join(HERE, "node_modules", "kuromoji", "dict");
const SRC = path.join(ROOT, "data", "questions.js");
const OUT = path.join(ROOT, "data", "furigana.js");
const REPORT = path.join(HERE, "furigana-report.txt");

/* ---------- 文字種 ---------- */
const KANJI = /[々㐀-䶿一-鿿豈-﫿]/;
const hasKanji = (s) => KANJI.test(s);

// 片仮名を平仮名へ。長音符・中黒などはそのまま残す
function toHira(s) {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    out += c >= 0x30a1 && c <= 0x30f6 ? String.fromCodePoint(c - 0x60) : ch;
  }
  return out;
}

/* ---------- 表記と読みの対応付け ---------- */
// 「読み」→ 読(よ)み のように送り仮名を除いた位置へ読みを割り当てる。
// 対応が取れないときは null を返し，呼び出し側で語全体に振る。
function align(surface, reading) {
  // 漢字の塊と，それ以外の塊に分ける
  const segs = [];
  for (const ch of surface) {
    const k = hasKanji(ch);
    const last = segs[segs.length - 1];
    if (last && last.kanji === k) last.text += ch;
    else segs.push({ kanji: k, text: ch });
  }
  if (segs.length === 1) return [[0, surface.length, reading]];

  const out = [];
  let pos = 0;   // surface 上の位置
  let ri = 0;    // reading 上の位置
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (!seg.kanji) {
      const kana = toHira(seg.text);
      if (!reading.startsWith(kana, ri)) return null;
      ri += kana.length;
      pos += seg.text.length;
      continue;
    }
    const next = segs[i + 1];
    let end;
    if (!next) {
      end = reading.length;
    } else {
      // 次の仮名塊が読みのどこで現れるかで，漢字が食う読みの長さが決まる。
      // 漢字には最低 1 音を割り当てたいので ri+1 から探す。
      end = reading.indexOf(toHira(next.text), ri + 1);
      if (end < 0) return null;
    }
    if (end <= ri) return null;
    out.push([pos, seg.text.length, reading.slice(ri, end)]);
    ri = end;
    pos += seg.text.length;
  }
  if (ri !== reading.length) return null;   // 読みが余る＝対応付け失敗
  return out;
}

/* ---------- 読み方の補正 ---------- */
// IPADIC は一般語の辞書なので，試験文特有の文脈（数詞・IT 用語）を取り違える。
// 頻出の取り違えだけを，1 文字語＋前後の文字で機械的に直す。
const DAY = {
  2:"ふつか", 3:"みっか", 4:"よっか", 5:"いつか", 6:"むいか", 7:"なのか",
  8:"ようか", 9:"ここのか", 10:"とおか", 14:"じゅうよっか", 20:"はつか", 24:"にじゅうよっか",
};
const toHalf = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

function fixReading(surface, reading, text, at) {
  if (surface.length !== 1 || !reading) return reading;
  const before = text.slice(Math.max(0, at - 8), at);
  const after = text.slice(at + 1, at + 3);
  const m = before.match(/([0-9０-９]+)\s*$/);
  const num = m ? parseInt(toHalf(m[1]), 10) : null;
  const digit = num !== null || /[nｎ]\s*$/.test(before);
  switch (surface) {
    case "値": return reading === "ね" ? "あたい" : reading;                       // 値 → あたい
    case "行": return /^(くだり|あるき|ゆき|いき)$/.test(reading) ? "ぎょう" : reading; // 表の行
    case "間": return reading === "ま" ? "あいだ" : reading;                        // 〜の間で
    case "位": return reading === "くらい" ? "い" : reading;                        // 第 1 位・下位
    case "台": return reading === "だい" ? reading : "だい";                        // 2 台
    case "進": return digit ? "しん" : reading;                                     // 2 進数
    case "月": return digit && reading === "つき" ? "がつ" : reading;               // 4 月（1 か月 は げつ）
    case "年": return digit && reading === "とし" ? "ねん" : reading;               // 21 年
    case "分": return digit ? (after.startsWith("の") ? "ぶん" : "ふん") : reading;  // 30 分 / 3 分の 1
    case "人":
      if (!digit) return reading === "じん" ? "にん" : reading;                     // 監査人
      if (after.startsWith("日")) return "にん";                                    // 人日
      return num === 1 ? "ひとり" : num === 2 ? "ふたり" : "にん";
    case "日": {
      if (!digit) return reading;
      // 「4 月 1 日」のような日付は ついたち。単独の「1 日」は いちにち もあるため触らない
      if (num === 1) return /月\s*$/.test(before.replace(/[0-9０-９\s]+$/, "")) ? "ついたち" : "にち";
      return DAY[num] || "にち";
    }
  }
  return reading;
}

/* ---------- 集計 ---------- */
const stat = { tok: 0, ok: 0, whole: 0, noread: 0, fields: 0, annotated: 0 };
const wholeWords = new Map();   // 語全体に振った語（抽査用）

function annotate(tokenizer, text) {
  if (typeof text !== "string" || !text || !hasKanji(text)) return null;
  stat.fields++;
  const tokens = tokenizer.tokenize(text);
  const out = [];
  let cursor = 0;
  for (const t of tokens) {
    const surface = t.surface_form;
    const at = text.indexOf(surface, cursor);
    if (at < 0) continue;               // 念のため：見つからなければ捨てる
    cursor = at + surface.length;
    if (!hasKanji(surface)) continue;
    stat.tok++;
    let reading = t.reading && t.reading !== "*" ? toHira(t.reading) : "";
    reading = fixReading(surface, reading, text, at);
    if (!reading || reading === surface) { stat.noread++; continue; }
    const parts = align(surface, reading);
    if (parts) {
      stat.ok++;
      for (const [o, l, y] of parts) out.push([at + o, l, y]);
    } else {
      stat.whole++;
      wholeWords.set(surface, (wholeWords.get(surface) || 0) + 1);
      out.push([at, surface.length, reading]);
    }
  }
  if (!out.length) return null;
  stat.annotated += out.length;
  return text.length + ";" + out.map(([s, l, y]) => s + "," + l + "," + y).join("|");
}

/* ---------- 本体 ---------- */
const require = createRequire(import.meta.url);
global.window = {};
require(SRC);
const DATA = global.window.FE_DATA || [];
if (!DATA.length) { console.error("questions.js を読み込めませんでした"); process.exit(1); }

const tokenizer = await new Promise((res, rej) =>
  kuromoji.builder({ dicPath: DICT }).build((e, t) => (e ? rej(e) : res(t))));

const RUBY = {};
let done = 0;
for (const q of DATA) {
  const rec = {};
  const put = (v) => (v ? v : undefined);

  rec.q = put(annotate(tokenizer, q.question));

  const c = {};
  (q.content || []).forEach((b, i) => {
    if (b.type !== "text") return;
    const a = annotate(tokenizer, b.value);
    // 本文 1 段落目は question と同一のことが多い。重複はそのまま捨てる
    if (a && !(i === 0 && a === rec.q)) c[i] = a;
  });
  if (Object.keys(c).length) rec.c = c;

  const o = {};
  for (const k of Object.keys(q.choices || {})) {
    const jp = q.choices[k].jp;
    if (Array.isArray(jp)) {
      const arr = jp.map((s) => annotate(tokenizer, s) || 0);
      if (arr.some(Boolean)) o[k] = arr;
    } else {
      const a = annotate(tokenizer, jp);
      if (a) o[k] = a;
    }
  }
  if (Object.keys(o).length) rec.o = o;

  if (q.explanation) rec.e = put(annotate(tokenizer, q.explanation.jp));

  const w = {};
  for (const k of Object.keys(q.explanation_wrong || {})) {
    const a = annotate(tokenizer, q.explanation_wrong[k].jp);
    if (a) w[k] = a;
  }
  if (Object.keys(w).length) rec.w = w;

  if (Object.keys(rec).some((k) => rec[k] !== undefined)) RUBY[q.id] = rec;
  if (++done % 200 === 0) console.log("  " + done + " / " + DATA.length);
}

fs.writeFileSync(OUT, "window.FE_RUBY=" + JSON.stringify(RUBY) + ";\n", "utf8");

/* ---------- 報告 ---------- */
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
const rate = ((stat.whole / (stat.ok + stat.whole)) * 100).toFixed(2);
const lines = [
  "furigana 生成レポート",
  "問題数            " + DATA.length,
  "対象フィールド    " + stat.fields,
  "漢字を含む語      " + stat.tok,
  "  送り仮名を分離  " + stat.ok,
  "  語全体に付与    " + stat.whole + "  (" + rate + "%)",
  "  読み無しで除外  " + stat.noread,
  "付与した注釈      " + stat.annotated,
  "出力              data/furigana.js  " + kb + " KB",
  "",
  "語全体に付与した語（上位 60・抽査用）",
];
[...wholeWords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)
  .forEach(([w2, n]) => lines.push("  " + String(n).padStart(4) + "  " + w2));
const text = lines.join("\n") + "\n";
fs.writeFileSync(REPORT, text, "utf8");
console.log("\n" + text);
