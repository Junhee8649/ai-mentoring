/* Jua 서브셋 생성기 — 대상 HTML 이 실제로 쓰는 글자만 담은 woff2 를 만들어
   그 파일의 <style id="font"> 블록을 통째로 갈아 끼운다.

   왜 필요한가:
     외부 폰트를 못 쓰는 제약 때문에 @font-face 가 없었고, Jua 가 설치되지
     않은 PC 에서는 전부 맑은 고딕으로 떨어졌다. 화면이 촌스러웠던 최대 원인.

   왜 서브셋인가:
     Jua 전체를 넣으면 base64 로 1.11MB 다. 쓰는 글자만 담으면 177KB 로 준다.
     대신 문구를 고치면 다시 돌려야 한다 — 잊어도 index.html 의 폰트 가드가
     멘토 창에서 잡아 준다.

   사용법:  node build/font.mjs elem-senior/10-biased-data/index.html
   요구사항: Node 18+ (전역 fetch), 인터넷. 결과는 커밋되므로 도구 사용자에겐 불필요.        */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
if (!target) {
  console.error("사용법: node build/font.mjs <index.html 경로 (tools/ 기준)>");
  process.exit(1);
}
const file = resolve(ROOT, target);

const BEGIN = "/* FONT:BEGIN */";
const END = "/* FONT:END */";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const html = readFileSync(file, "utf8");

/* 이미 박혀 있는 폰트 블록은 글자 수집 대상에서 뺀다.
   안 빼면 base64 문자열이 '쓰는 글자'로 잡혀 서브셋이 엉뚱해진다. */
const scanned = html.replace(
  new RegExp(escapeRe(BEGIN) + "[\\s\\S]*?" + escapeRe(END), "g"),
  ""
);

const chars = [...new Set([...scanned])]
  .filter((c) => {
    const cp = c.codePointAt(0);
    return cp >= 0x20 && cp !== 0x7f;      // 제어문자 제외
  })
  .sort();

console.log(`글자 ${chars.length}자 수집`);

/* Google Fonts css2 는 &text= 로 서브셋을 만들어 준다.
   한글 한 자가 URL 인코딩되면 9바이트라, 한 번에 다 보내면 URL 이 GET 한계를
   넘는다. 250자씩 끊고 청크마다 @font-face 를 하나씩 만든다.
   같은 font-family 이름에 unicode-range 를 붙여 나눠 선언하면 브라우저가
   글자별로 알아서 고른다 — 폰트 병합 도구가 필요 없다.               */
const CHUNK = 250;
const faces = [];
let bytes = 0;

for (let i = 0; i < chars.length; i += CHUNK) {
  const chunk = chars.slice(i, i + CHUNK);
  const css = await get(
    "https://fonts.googleapis.com/css2?family=Jua&text=" +
      encodeURIComponent(chunk.join("")),
    "text"
  );
  const url = css.match(/https:\/\/fonts\.gstatic\.com[^)]*/)?.[0];
  if (!url) throw new Error(`청크 ${i} 의 폰트 URL 을 찾지 못했습니다:\n` + css.slice(0, 300));

  const buf = await get(url, "buffer");
  bytes += buf.length;

  const range = chunk.map((c) => "U+" + c.codePointAt(0).toString(16)).join(",");
  faces.push(
    `@font-face{font-family:'Jua';font-style:normal;font-weight:400;font-display:block;` +
      `src:url(data:font/woff2;base64,${buf.toString("base64")}) format('woff2');` +
      `unicode-range:${range};}`
  );
  console.log(`  청크 ${faces.length}: ${chunk.length}자 / ${(buf.length / 1024).toFixed(1)}KB`);
}

const coverage = chars.join("").replace(/[\\`$]/g, "\\$&");

const block =
  `${BEGIN}\n` +
  `/* 자동 생성 영역. 손으로 고치지 마세요.\n` +
  `   재생성:  node build/font.mjs ${target}\n` +
  `   Jua — SIL Open Font License 1.1, (c) Woowa Brothers. 임베드 허용 폰트입니다. */\n` +
  faces.join("\n") +
  `\n${END}`;

const script =
  `<script id="fontCoverage">window.__FONT_COVERAGE__=\`${coverage}\`;<\/script>`;

let out;
if (html.includes(BEGIN)) {
  out = html
    .replace(new RegExp(escapeRe(BEGIN) + "[\\s\\S]*?" + escapeRe(END)), block)
    .replace(/<script id="fontCoverage">[\s\S]*?<\/script>/, script);
} else {
  out = html.replace(
    "</head>",
    `<style id="font">\n${block}\n</style>\n${script}\n</head>`
  );
}

writeFileSync(file, out);
console.log(
  `\n완료 — woff2 ${(bytes / 1024).toFixed(1)}KB, ` +
    `base64 약 ${(Math.ceil(bytes / 3) * 4 / 1024).toFixed(0)}KB 를 ${target} 에 넣었습니다.`
);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function get(url, as) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return as === "buffer" ? Buffer.from(await r.arrayBuffer()) : await r.text();
}
