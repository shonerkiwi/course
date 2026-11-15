'use strict';
/* ---------- réglages ---------- */
const Q = new URLSearchParams(location.search);
const SPEED = Q.has('demo') ? (+Q.get('demo') || 60) : 1;           // ?demo=60 : séance accélérée (test)
const OFFSET = Q.get('now') ? new Date(Q.get('now')).getTime() - Date.now() : 0; // ?now=2026-11-16T08:20 (test)
const TEST = Q.has('demo') || Q.has('now');
const KEY = 'course-v2' + (TEST ? '-test' : '');
if (Q.has('reset')) localStorage.removeItem(KEY);

const DOW = [1, 3, 6];            // lundi, mercredi, samedi
const HOUR = 8, MIN = 30;         // 8h30
const P = { ok: 100, time: 50, streak: 10, streakCap: 10, late: 60, walk: 40, miss: 150, quest: 150,
            weighMon: 30, weigh: 15, weighMiss: 40, kg: 50, form: 100 };
const PACE = { walk: 5.5 / 3.6, run: 8 / 3.6 };   // m/s, pour estimer les distances
const MET = { walk: 4.3, run: 8.3 };               // dépense : MET × kg × heures
const KCAL_KG = 7700;                              // kcal pour 1 kg de graisse
// IMC des hommes adultes en France (étude Esteban, Santé publique France : 54 % au-dessus de 25, 17 % au-dessus de 30)
const BMI_MED = 25.4, BMI_SIG = 0.173;

/* rang Discipline : 7 paliers × 4 divisions de 150 LP, puis Master+ */
const TIERS = [['Fer', '#9a8f8a'], ['Bronze', '#c9825b'], ['Argent', '#c3ccd6'], ['Or', '#e8b64c'], ['Platine', '#4fd1c5'], ['Émeraude', '#3ddc97'], ['Diamant', '#7aa8ff']];
const APEX = [['Master', 4200, '#c77dff'], ['Grand Maître', 5000, '#ff5d73'], ['Challenger', 6000, '#ffd76a']];
const DIVLP = 150, ROM = ['IV', 'III', 'II', 'I'];
/* rang Forme : part des hommes en France plus lourds que toi (à taille égale) */
const FQ = [0, 15, 25, 35, 50, 58, 65, 75];

const ACH = [
  ['first', '👟', 'Première sortie', s => s.done >= 1],
  ['s3', '🔥', '3 séances d’affilée', s => s.best >= 3],
  ['week', '📅', 'Semaine complète (3 courses + 2 marches)', s => Object.keys(s.quests).length >= 1],
  ['time5', '⏰', '5 départs à l’heure', s => s.log.filter(e => e.onTime).length >= 5],
  ['km50', '🛣️', '50 km parcourus', s => tot(s).km >= 50],
  ['kcal', '🍔', '7 700 kcal brûlées (1 kg de gras)', s => tot(s).kcal >= KCAL_KG],
  ['kg5', '⚖️', '5 kg perdus', s => lost(s) >= 5],
  ['avg', '📊', 'Plus léger que la moyenne des hommes en France', s => formRank(curKg(s), s.h).q >= 50],
  ['u80', '🎯', 'Sous les 80 kg', s => curKg(s) < 80],
  ['run30', '🏆', '30 minutes de course d’affilée', s => s.prog >= 24],
  ['s10', '🌋', '10 séances d’affilée', s => s.best >= 10],
  ['u75', '💎', 'Sous les 75 kg', s => curKg(s) < 75],
];

/* ---------- dates et formats ---------- */
const now = () => new Date(Date.now() + OFFSET);
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const today = () => ymd(now());
const monday = s => addDays(s, -((parse(s).getDay() + 6) % 7));
const frDate = (s, o) => parse(s).toLocaleDateString('fr-FR', o || { weekday: 'long', day: 'numeric', month: 'long' });
const fmt = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + pad(s % 60); };
const dur = s => s % 60 ? s + ' s' : s / 60 + ' min';
const dec = (k, n = 1) => k.toFixed(n).replace('.', ',');
const big = n => Math.round(n).toLocaleString('fr-FR');
const $ = s => document.querySelector(s);

/* ---------- état ---------- */
let S = null;
try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
const save = () => localStorage.setItem(KEY, JSON.stringify(S));
function create(kg, h) {
  const n = now(); let d = today();
  const early = n.getHours() * 60 + n.getMinutes() < 9 * 60 + 30;
  if (!(DOW.includes(n.getDay()) && early)) d = addDays(d, 1);
  while (!DOW.includes(parse(d).getDay())) d = addDays(d, 1);
  S = { v: 2, created: today(), start: d, h, points: 0, streak: 0, best: 0, jokers: 1, prog: 0, done: 0,
        log: [], weights: [{ d: today(), kg }], kgBest: Math.floor(kg), formBest: formRank(kg, h).step, ach: {}, quests: {}, feels: [], run: null };
  save();
}
const isSched = s => s >= S.start && DOW.includes(parse(s).getDay());
const rec = s => S.log.find(e => (e.for || e.d) === s && ['ok', 'late', 'miss', 'joker'].includes(e.k));
const pending = () => { const y = addDays(today(), -1); return isSched(y) && !rec(y) ? y : null; };
const mode = () => isSched(today()) && !rec(today()) ? 'due' : pending() ? 'late' : 'rest';
function nextRdv() { let d = today(); if (rec(d) || !isSched(d)) d = addDays(d, 1); while (!isSched(d)) d = addDays(d, 1); return d; }
const curKg = s => s.weights[s.weights.length - 1].kg;
const lost = s => s.weights[0].kg - curKg(s);
const weighedThisWeek = () => { const m = monday(today()); return S.weights.some(w => w.d >= m); };
const tot = s => s.log.reduce((a, e) => { a.km += e.km || 0; a.kcal += e.kcal || 0; a.min += e.min || 0; if (e.k === 'walk') a.walks++; return a; }, { km: 0, kcal: 0, min: 0, walks: 0 });
function addPts(n) { S.points = Math.max(0, S.points + n); }

/* ---------- rangs ---------- */
function rank(p) {
  if (p >= APEX[0][1]) { let i = 0; APEX.forEach((a, k) => { if (p >= a[1]) i = k; }); const a = APEX[i], n = APEX[i + 1];
    return { name: a[0], tier: a[0], div: '★', color: a[2], step: 28 + i, lp: p - a[1], max: n ? n[1] - a[1] : null, next: n ? n[0] : null }; }
  const st = Math.floor(p / DIVLP), t = Math.floor(st / 4), nx = st + 1;
  return { name: TIERS[t][0] + ' ' + ROM[st % 4], tier: TIERS[t][0], div: ROM[st % 4], color: TIERS[t][1], step: st, lp: p - st * DIVLP, max: DIVLP,
    next: nx >= 28 ? 'Master' : TIERS[Math.floor(nx / 4)][0] + ' ' + ROM[nx % 4] };
}
const phi = z => { const t = 1 / (1 + .2316419 * Math.abs(z)), d = .3989423 * Math.exp(-z * z / 2);
  const p = d * t * (.3193815 + t * (-.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
const pctLighter = (kg, h) => (1 - phi((Math.log(kg / (h / 100) ** 2) - Math.log(BMI_MED)) / BMI_SIG)) * 100;   // % d'hommes plus lourds que toi
function kgAt(q, h) { let lo = 30, hi = 250; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (pctLighter(m, h) > q) lo = m; else hi = m; } return lo; }
function formRank(kg, h) {
  const q = pctLighter(kg, h); let t = 0; FQ.forEach((v, k) => { if (q >= v) t = k; });
  if (t >= 7) return { name: 'Master', tier: 'Master', div: '★', color: APEX[0][2], step: 28, q, nextKg: null, next: null };
  const a = FQ[t], b = FQ[t + 1], d = Math.min(3, Math.floor((q - a) / (b - a) * 4)), st = t * 4 + d, nq = a + (b - a) * (d + 1) / 4;
  return { name: TIERS[t][0] + ' ' + ROM[d], tier: TIERS[t][0], div: ROM[d], color: TIERS[t][1], step: st, q, nextKg: kgAt(nq, h),
    next: st + 1 >= 28 ? 'Master' : TIERS[Math.floor((st + 1) / 4)][0] + ' ' + ROM[(st + 1) % 4] };
}
function emblem(r, cls = 'emblem') {
  const c = r.color, id = 'g' + Math.random().toString(36).slice(2, 7);
  return `<svg class="${cls}" viewBox="0 0 92 104"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity=".4"/></linearGradient></defs>
  <path d="M46 3l39 15v34c0 24-16 41-39 49C23 93 7 76 7 52V18z" fill="url(#${id})" stroke="${c}" stroke-width="3"/>
  <path d="M46 14l29 11v27c0 18-12 31-29 38-17-7-29-20-29-38V25z" fill="#12140f" opacity=".6"/>
  <text x="46" y="${r.div === '★' ? 64 : 61}" text-anchor="middle" font-size="${r.div.length > 2 ? 26 : 32}" font-weight="900" fill="#fff" font-family="system-ui">${r.div}</text></svg>`;
}

/* ---------- sanctions : séances et pesées manquées ---------- */
function settle() {
  const t = today(), out = [];
  for (let d = S.start; d < t; d = addDays(d, 1)) {
    if (!isSched(d) || rec(d) || addDays(d, 1) === t) continue;
    S.log.push({ d, k: 'miss', pts: -P.miss }); addPts(-P.miss); S.streak = 0;
    out.push(['Séance du ' + frDate(d, { weekday: 'long', day: 'numeric', month: 'short' }) + ' manquée', -P.miss]);
    const misses = S.log.filter(e => ['ok', 'late', 'miss'].includes(e.k)).slice(-2);
    if (misses.length === 2 && misses.every(e => e.k === 'miss') && S.prog > 0) { S.prog--; out.push(['Deux absences : tu recules d’une séance', 0]); }
  }
  for (let m = addDays(monday(S.created), 7); m < monday(t); m = addDays(m, 7)) {
    const end = addDays(m, 6);
    if (S.weights.some(w => w.d >= m && w.d <= end) || S.log.some(e => e.k === 'wmiss' && e.d === end)) continue;
    S.log.push({ d: end, k: 'wmiss', pts: -P.weighMiss }); addPts(-P.weighMiss);
    out.push(['Pesée de la semaine du ' + frDate(m, { day: 'numeric', month: 'short' }) + ' oubliée', -P.weighMiss]);
  }
  save(); return out;
}

/* ---------- séances ---------- */
function finalize(ph, o) {
  let total = 0, dist = 0; ph.forEach(p => { total += p.d; dist += p.d * PACE[p.t]; });
  let half = 0, acc = 0; for (const p of ph) { const d = p.d * PACE[p.t]; if (acc + d >= dist / 2) { half += (dist / 2 - acc) / PACE[p.t]; break; } acc += d; half += p.d; }
  return Object.assign({ ph, total, dist, half, kcal: kg => ph.reduce((a, p) => a + MET[p.t] * kg * p.d / 3600, 0) }, o);
}
function build(i) {
  const w = Math.floor(i / 3) + 1, s = i % 3; let reps, run, walk, title;
  if (i >= 23) { const k = Math.max(0, w - 9); run = (i === 23 || s === 0 ? 30 : s === 1 ? Math.min(45, 30 + 5 * Math.floor(k / 4)) : Math.min(55, 35 + 5 * Math.floor(k / 2))) * 60; reps = 1; walk = 0;
    title = (s === 2 && i > 23 ? 'Sortie longue : ' : '') + dur(run) + ' de course d’affilée'; }
  else { if (w <= 2) [reps, run, walk] = [8, 60, 120]; else if (w <= 4) [reps, run, walk] = [6, 120, 120]; else if (w <= 6) [reps, run, walk] = [5, 240, 60];
    else if (w === 7) [reps, run, walk] = [2, 600, 60]; else [reps, run, walk] = [3, 600, 60];
    title = `${reps} × ${dur(run)} de course`; }
  const ph = [{ t: 'walk', d: 300, l: 'Échauffement' }];
  for (let r = 0; r < reps; r++) { ph.push({ t: 'run', d: run, l: 'Cours', n: r + 1, of: reps }); if (r < reps - 1) ph.push({ t: 'walk', d: walk, l: 'Marche' }); }
  ph.push({ t: 'walk', d: 600, l: 'Marche active' });
  return finalize(ph, { week: w, num: s + 1, title, name: `Niveau ${w} · séance ${s + 1}`, sub: (reps > 1 ? `${dur(walk)} de marche entre chaque, ` : '') + '10 min de marche active pour finir' });
}
const buildWalk = () => finalize([{ t: 'walk', d: 2400, l: 'Marche active' }], { title: '40 min de marche active', name: 'Marche active', sub: 'Pas rapide, d’une traite. Zéro choc, et ça brûle.', walkOnly: true });
const info = s => `${Math.round(s.total / 60)} min · ≈ ${dec(s.dist / 1000)} km · ≈ ${big(s.kcal(curKg(S)))} kcal`;

/* projection du poids sur n semaines si tout est respecté */
function project(weeks, walks, dietKcal) {
  let kg = curKg(S), i = S.prog; const out = [kg], wk = buildWalk();
  for (let w = 0; w < weeks; w++) { let k = walks * wk.kcal(kg) + dietKcal * 7; for (let j = 0; j < 3; j++) k += build(i++).kcal(kg); kg -= k / KCAL_KG; out.push(kg); }
  return out;
}

/* ---------- petits effets ---------- */
function countUp(el, from, to, ms = 900) {
  if (!el) return; const t0 = performance.now();
  (function f(t) { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(from + (to - from) * e); if (k < 1) requestAnimationFrame(f); })(t0);
}
function confetti() {
  const c = $('#fx'), x = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
  const cols = ['#c4f82a', '#9b6bff', '#ff8a3d', '#fff', '#c4f82a'];
  const ps = Array.from({ length: 150 }, () => ({ x: innerWidth / 2, y: innerHeight * .35, vx: (Math.random() - .5) * 16,
    vy: -Math.random() * 15 - 3, s: 5 + Math.random() * 7, r: Math.random() * 6, c: cols[Math.random() * cols.length | 0] }));
  const t0 = performance.now();
  (function f(t) {
    x.clearRect(0, 0, c.width, c.height);
    ps.forEach(p => { p.vy += .32; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += .2;
      x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * .6); x.restore(); });
    if (t - t0 < 3200) requestAnimationFrame(f); else x.clearRect(0, 0, c.width, c.height);
  })(t0);
}
let AC = null;
function beep(freq = 880, ms = 160, when = 0) {
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime + when;
    o.frequency.value = freq; o.type = 'triangle'; g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(.6, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + ms / 1000);
    o.connect(g).connect(AC.destination); o.start(t); o.stop(t + ms / 1000 + .05); } catch (e) {}
}
function say(txt) { try { const u = new SpeechSynthesisUtterance(txt); u.lang = 'fr-FR'; u.volume = 1; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {} }
const buzz = p => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };
/* vibrations fortes, à reconnaître dans la poche, répétées une fois */
const VIB = { run: [900, 250, 900, 250, 900], walk: [2500], half: [250, 150, 250, 150, 250, 150, 250, 150, 250, 150, 250, 150, 250], end: [1500, 300, 1500] };
function signal(k) { buzz(VIB[k]); setTimeout(() => { if (R || k === 'end') buzz(VIB[k]); }, VIB[k].reduce((a, b) => a + b, 0) + 1800); }

/* ---------- fenêtres ---------- */
function modal(html, cls = '') {
  const m = $('#modal'); m.innerHTML = `<div class="box ${cls}">${html}</div>`; m.hidden = false;
  return new Promise(res => m.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
    const v = [...m.querySelectorAll('input')].map(i => i.value); m.hidden = true; res([b.dataset.r, ...v]); }));
}
const lines = arr => '<div class="lines">' + arr.map(([l, p], i) =>
  `<div style="animation-delay:${.25 + i * .22}s"><span>${l}</span><b class="${p < 0 ? 'minus' : ''}">${p > 0 ? '+' : ''}${p || ''}</b></div>`).join('') + '</div>';
function newAch() { const got = []; ACH.forEach(([id, ic, name, test]) => { if (!S.ach[id] && test(S)) { S.ach[id] = today(); got.push(ic + ' ' + name); } }); save(); return got; }
async function result(title, ico, arr, before, extra = '') {
  const gain = S.points - before, a = rank(before), b = rank(S.points), ach = newAch();
  if (gain > 0) { confetti(); beep(660, 140); beep(880, 140, .15); beep(1320, 300, .3); }
  const p = modal(`<div class="ico">${ico}</div><h3>${title}</h3>${extra}${lines(arr)}
    <div class="total ${gain < 0 ? 'minus' : ''}">${gain > 0 ? '+' : ''}<span id="tt">0</span><small> LP</small></div>
    ${b.step > a.step ? `<div class="rankup" style="--rank:${b.color}">${emblem(b, 'mini')} Promotion : ${b.name}</div>` : b.step < a.step ? `<div class="rankup down">Rétrogradé en ${b.name}</div>` : ''}
    ${ach.map(x => `<div class="rankup" style="--rank:var(--gold)">Succès : ${x}</div>`).join('')}
    <button class="btn run" data-r="ok">Continuer</button>`, gain < 0 ? 'shake' : '');
  setTimeout(() => countUp($('#tt'), 0, Math.abs(gain), 1100), 300 + arr.length * 220);
  await p; render();
}
const numInput = (v, step = '0.1') => `<input type="number" inputmode="decimal" step="${step}" value="${v}" class="num">`;

/* ---------- accueil ---------- */
let shown = 0, tab = 'home';
function home() {
  const r = rank(S.points), m = mode(), ses = build(S.prog), n = now(), kg = curKg(S), f = formRank(kg, S.h), T = tot(S);
  const mins = n.getHours() * 60 + n.getMinutes(), onTime = mins >= 8 * 60 && mins <= 9 * 60 + 30;
  const sb = P.streak * Math.min(S.streak + 1, P.streakCap), walked = S.log.some(e => e.d === today());
  let main;
  if (m === 'due') main = `<div class="card due"><h2>Séance du jour · ${ses.name}</h2>
    <div class="big">${mins < 8 * 60 ? 'Rendez-vous à 8h30' : onTime ? 'C’est l’heure. Dehors.' : 'Tu es en retard, mais ça compte encore'}</div>
    <p>${ses.title}<br>${info(ses)}</p>
    <div class="gain"><span class="chip">+${P.ok} séance</span><span class="chip ${mins > 9 * 60 + 30 ? 'off' : ''}">+${P.time} à l’heure</span><span class="chip">+${sb} série</span></div>
    <button class="btn pulse" id="go">C’est parti</button>
    ${S.jokers ? '<button class="btn ghost" id="jk">Utiliser un joker (malade, blessé…)</button>' : ''}</div>`;
  else if (m === 'late') main = `<div class="card late"><h2>Rattrapage · dernière chance</h2>
    <div class="big">Tu as sauté la séance d’hier</div>
    <p>Fais-la aujourd’hui : +${P.late} LP et ta série est sauvée. Sinon, −${P.miss} LP à minuit.<br>${ses.title} · ${info(ses)}</p>
    <button class="btn pulse" id="go">Je rattrape maintenant</button>
    ${S.jokers ? '<button class="btn ghost" id="jk">Utiliser un joker</button>' : ''}</div>`;
  else { const d = nextRdv(), wk = buildWalk(); main = `<div class="card"><h2>Prochain rendez-vous</h2>
    <div class="big" style="text-transform:capitalize">${frDate(d)} · 8h30</div>
    <p>Dans <span class="count" id="cd"></span> · ${ses.title}</p></div>
    ${walked ? '' : `<div class="card walkc"><h2>Jour sans course · bonus</h2><div class="big">Marche active</div><p>${info(wk)}<br>En plus de tes trajets à pied du boulot : eux, ton corps les compte déjà.</p>
    <button class="btn" id="free">Marcher 40 min (+${P.walk} LP)</button></div>`}`; }
  const q = questState();
  $('#view').innerHTML = `
  <div class="hero" style="--rank:${r.color}">${emblem(r)}<div style="flex:1;min-width:0">
    <div class="rk">Rang discipline</div><div class="rn">${r.name}</div>
    <div class="bar"><i id="rb"></i></div><div class="nx"><b><span id="pts">${shown}</span>${r.max ? ' / ' + r.max : ''} LP</b>${r.next ? ' · ensuite ' + r.next : ''}</div></div></div>
  <div class="stats"><div class="stat fire"><b>${S.streak ? '<span class="flame">🔥</span> ' : ''}${S.streak}</b><span>Série</span></div>
    <div class="stat"><b>${dec(T.km)}</b><span>km</span></div><div class="stat"><b>${big(T.kcal)}</b><span>kcal</span></div><div class="stat jok"><b>${S.jokers}</b><span>Jokers</span></div></div>
  ${main}
  <div class="card quest"><h2>Quête de la semaine · +${P.quest} LP</h2>
    <div class="qrow">${[0, 1, 2].map(i => `<i class="${i < q.runs ? 'on' : ''}">🏃</i>`).join('')}${[0, 1].map(i => `<i class="${i < q.walks ? 'on w' : ''}">🚶</i>`).join('')}</div>
    <p>${q.done ? 'Quête réussie cette semaine.' : '3 courses et 2 marches actives de 40 min, en plus de tes trajets du boulot.'}</p></div>
  <div class="card form" style="--rank:${f.color}"><h2>Rang forme · poids</h2>
    <div class="frow">${emblem(f, 'emblem sm')}<div><div class="big">${dec(kg)} kg <small style="color:${f.color}">${f.name}</small></div>
    <p>Plus léger que <b style="color:#fff">${Math.round(f.q)} %</b> des hommes en France${f.nextKg ? ` · ${f.next} à ${dec(f.nextKg)} kg` : ''}</p></div></div>
    <div class="bar"><i id="wb"></i></div>
    ${weighedThisWeek() ? '' : `<button class="btn sec" id="wg">Pesée de la semaine (+${n.getDay() === 1 ? P.weighMon : P.weigh} LP)</button>`}</div>
  <div class="card"><h2>Succès · ${Object.keys(S.ach).length} / ${ACH.length}</h2><div class="ach">${ACH.map(a => `<div class="${S.ach[a[0]] ? 'got' : ''}" data-n="${a[2]}">${a[1]}</div>`).join('')}</div><div class="achl" id="achl">Touche un succès pour voir comment l’obtenir.</div></div>`;
  const fp = f.nextKg ? Math.max(4, Math.min(100, (f.q - stepQ(f.step)) / (stepQ(f.step + 1) - stepQ(f.step)) * 100)) : 100;
  requestAnimationFrame(() => { $('#rb').style.width = (r.max ? r.lp / r.max * 100 : 100) + '%'; $('#wb').style.width = fp + '%'; });
  countUp($('#pts'), Math.min(shown, r.lp), r.lp); shown = r.lp;
  document.querySelectorAll('.ach div').forEach(d => d.onclick = () => $('#achl').textContent = d.dataset.n + (d.classList.contains('got') ? ' · obtenu' : ' · à débloquer'));
  if ($('#go')) $('#go').onclick = () => startRun(m);
  if ($('#free')) $('#free').onclick = () => startRun('walk');
  if ($('#jk')) $('#jk').onclick = joker;
  if ($('#wg')) $('#wg').onclick = weigh;
  tickCd();
}
const stepQ = st => { if (st >= 28) return FQ[7]; const t = Math.floor(st / 4), d = st % 4; return FQ[t] + (FQ[t + 1] - FQ[t]) * d / 4; };
function questState() { const m = monday(today()), e = addDays(m, 6), w = S.log.filter(x => x.d >= m && x.d <= e);
  return { runs: w.filter(x => x.k === 'ok' || x.k === 'late').length, walks: w.filter(x => x.k === 'walk').length, done: !!S.quests[m], m }; }
function tickCd() {
  const el = $('#cd'); if (!el) return;
  const t = parse(nextRdv()); t.setHours(HOUR, MIN, 0, 0);
  let s = Math.max(0, (t - now()) / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), mi = Math.floor(s % 3600 / 60);
  el.textContent = d ? `${d} j ${h} h` : h ? `${h} h ${pad(mi)}` : `${mi} min`;
}
setInterval(tickCd, 20000);
async function joker() {
  const [r] = await modal(`<div class="ico">🃏</div><h3>Utiliser un joker ?</h3><p>La séance est excusée : pas de LP, pas de sanction, ta série est conservée. Il t’en reste ${S.jokers}. Tu en regagnes un toutes les 4 séances.</p>
    <button class="btn run" data-r="y">Oui, j’ai une vraie raison</button><button class="btn sec" data-r="n">Non, j’y vais</button>`);
  if (r !== 'y') return;
  S.log.push({ d: today(), for: mode() === 'late' ? pending() : today(), k: 'joker', pts: 0 }); S.jokers--; save(); render();
}
async function weigh() {
  const [r, v] = await modal(`<div class="ico">⚖️</div><h3>Pesée</h3><p>Le matin, à jeun, toujours dans les mêmes conditions.</p>${numInput(curKg(S))}
    <button class="btn run" data-r="y">Valider</button><button class="btn sec" data-r="n">Annuler</button>`);
  const kg = parseFloat(String(v).replace(',', '.')); if (r !== 'y' || !(kg > 40 && kg < 200)) return;
  const before = S.points, first = !weighedThisWeek(), arr = [], f0 = formRank(curKg(S), S.h);
  S.weights = S.weights.filter(w => w.d !== today() || S.weights.length === 1 && w.d === S.created); S.weights.push({ d: today(), kg });
  if (first) { const p = now().getDay() === 1 ? P.weighMon : P.weigh; addPts(p); arr.push([now().getDay() === 1 ? 'Pesée du lundi' : 'Pesée de la semaine', p]); S.log.push({ d: today(), k: 'weigh', pts: p }); }
  const fl = Math.ceil(kg); if (fl < S.kgBest) { const n = S.kgBest - fl; addPts(n * P.kg); arr.push([`${n} kg de moins, nouveau record`, n * P.kg]); S.kgBest = fl; }
  const f1 = formRank(kg, S.h); let extra = '';
  if (f1.step > S.formBest) { const n = f1.step - S.formBest; addPts(n * P.form); arr.push([`Rang forme : ${f1.name}`, n * P.form]); S.formBest = f1.step;
    extra = `<div class="rankup" style="--rank:${f1.color};animation-delay:.2s">${emblem(f1, 'mini')} Forme : ${f0.name} → ${f1.name}</div>`; }
  save(); if (!arr.length) arr.push(['Poids mis à jour', 0]);
  result(dec(kg) + ' kg', '⚖️', arr, before, extra + `<p>Plus léger que ${Math.round(f1.q)} % des hommes en France</p>`);
}

/* ---------- séance ---------- */
let R = null, raf = 0, wl = null, lockT = 0;
const elapsed = () => ((R.pausedAt || Date.now()) - R.start - R.paused) / 1000 * SPEED;
async function wake() { try { wl = await navigator.wakeLock.request('screen'); } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (R && document.visibilityState === 'visible') wake(); });
function armLock() { clearTimeout(lockT); lockT = setTimeout(() => { if (R && !R.pausedAt && $('#modal').hidden) $('#lock').hidden = false; }, 7000); }
function startRun(kind, resume) {
  const n = now(), mins = n.getHours() * 60 + n.getMinutes();
  R = resume || { kind, start: Date.now(), paused: 0, pausedAt: null, onTime: kind === 'due' && mins >= 8 * 60 && mins <= 9 * 60 + 30, for: kind === 'late' ? pending() : today(), day: today() };
  R.ses = R.kind === 'walk' ? buildWalk() : build(S.prog); R.idx = -1; R.half = resume ? elapsed() > R.ses.half : false; R.sec = -1; R.gps = 0; R.last = null;
  S.run = { kind: R.kind, start: R.start, paused: R.paused, pausedAt: R.pausedAt, onTime: R.onTime, for: R.for, day: R.day }; save();
  beep(880, 120); buzz(200); wake();
  if (navigator.geolocation && SPEED === 1) R.gw = navigator.geolocation.watchPosition(p => { if (!R || p.coords.accuracy > 30) return;
    const ll = L.latLng(p.coords.latitude, p.coords.longitude); if (R.last) { const d = R.last.distanceTo(ll); if (d < 4) return; if (d < 150 && !R.pausedAt) R.gps += d; } R.last = ll; }, () => {}, { enableHighAccuracy: true, maximumAge: 2000 });
  const el = $('#run'); el.hidden = false;
  el.innerHTML = `<div class="top"><b>${R.ses.name}</b><div class="tbar"><i id="tb"></i><u style="left:${R.ses.half / R.ses.total * 100}%"></u></div>
    <div class="tot"><span id="te">0:00</span><span id="km">demi-tour au repère</span><span>${fmt(R.ses.total)}</span></div></div>
    <div class="ring" id="ring"><svg viewBox="0 0 100 100"><circle class="tk" cx="50" cy="50" r="47.5"/><circle class="bg" cx="50" cy="50" r="39"/><circle class="fg" id="fg" cx="50" cy="50" r="39" stroke-dasharray="245.04" stroke-dashoffset="0"/></svg>
      <div class="in"><div class="ph" id="ph"></div><div class="tm" id="tm"></div><div class="rep" id="rp"></div></div></div>
    <div class="nxt" id="nx"></div>
    <div class="ctl"><button id="stop">Arrêter</button><button id="pk">Mode poche</button><button class="main" id="pause">Pause</button></div>
    <div id="lock" hidden><div id="lk"></div><div class="hold"><i id="hb"></i></div><p>Écran verrouillé pour la poche.<br>Maintiens appuyé pour déverrouiller.</p></div>`;
  $('#pause').onclick = () => { if (R.pausedAt) { R.paused += Date.now() - R.pausedAt; R.pausedAt = null; } else R.pausedAt = Date.now();
    $('#pause').textContent = R.pausedAt ? 'Reprendre' : 'Pause'; S.run.paused = R.paused; S.run.pausedAt = R.pausedAt; save(); armLock(); };
  $('#stop').onclick = stopRun; $('#pk').onclick = () => { $('#lock').hidden = false; };
  el.onpointerdown = e => { if (e.target.closest('#lock')) return; armLock(); };
  const lk = $('#lock'); let ht = 0;
  lk.onpointerdown = () => { $('#hb').style.transition = 'width 1.2s linear'; $('#hb').style.width = '100%'; ht = setTimeout(() => { lk.hidden = true; buzz(80); armLock(); }, 1200); };
  lk.onpointerup = lk.onpointercancel = lk.onpointerleave = () => { clearTimeout(ht); $('#hb').style.transition = 'none'; $('#hb').style.width = '0'; };
  armLock(); cancelAnimationFrame(raf); loop();
}
function loop() {
  if (!R) return; raf = requestAnimationFrame(loop);
  const e = elapsed(), ses = R.ses;
  if (e >= ses.total) return finish(1);
  let acc = 0, i = 0; while (e >= acc + ses.ph[i].d) acc += ses.ph[i++].d;
  const ph = ses.ph[i], left = ph.d - (e - acc);
  if (i !== R.idx) { R.idx = i; $('#run').className = ph.t;
    $('#ph').textContent = ph.t === 'run' ? 'Cours' : ph.l; $('#ph').style.fontSize = ph.l.length > 8 ? '21px' : ''; $('#rp').textContent = ph.n && ph.of > 1 ? `course ${ph.n} / ${ph.of}` : '';
    const nx = ses.ph[i + 1]; $('#nx').textContent = nx ? `Ensuite : ${nx.t === 'run' ? 'course' : nx.l.toLowerCase()} ${dur(nx.d)}` : 'Dernière ligne droite, tu rentres';
    $('#ring').classList.remove('flash'); void $('#ring').offsetWidth; $('#ring').classList.add('flash');
    if (ph.t === 'run') { beep(880, 150); beep(1320, 260, .18); signal('run'); say('Cours'); }
    else { beep(660, 380); if (i > 0) signal('walk'); say(i === 0 ? ph.l + ', marche' : ph.l); } }
  const sec = Math.ceil(left); if (sec !== R.sec) { R.sec = sec; if (sec <= 3 && sec > 0 && SPEED === 1) beep(520, 80);
    $('#lk').innerHTML = `<b>${ph.t === 'run' ? 'COURS' : 'MARCHE'}</b> ${fmt(left)}`; if (R.gps > 50) $('#km').textContent = dec(R.gps / 1000, 2) + ' km'; }
  if (!R.half && e >= ses.half) { R.half = true; beep(990, 200); beep(990, 200, .3); signal('half'); say('Demi-tour');
    const b = document.createElement('div'); b.className = 'banner'; b.textContent = '↩ Demi-tour'; $('#run').appendChild(b); setTimeout(() => b.remove(), 3600); }
  $('#tm').textContent = fmt(left); $('#te').textContent = fmt(e);
  $('#fg').setAttribute('stroke-dashoffset', (245.04 * (1 - left / ph.d)).toFixed(1)); $('#tb').style.width = (e / ses.total * 100) + '%';
}
async function stopRun() {
  const k = elapsed() / R.ses.total; if (!R.pausedAt) $('#pause').click(); clearTimeout(lockT);
  const [r] = await modal(k >= .8 ? `<div class="ico">🏁</div><h3>Terminer ici ?</h3><p>Tu as fait plus de 80 % de la séance : elle est validée.</p><button class="btn run" data-r="y">Valider la séance</button><button class="btn sec" data-r="n">Continuer</button>`
    : `<div class="ico">🛑</div><h3>Abandonner ?</h3><p>Il faut au moins 80 % de la séance pour qu’elle compte. Là, tu n’auras aucun LP.</p><button class="btn sec" data-r="n">Je continue</button><button class="btn bad" data-r="y">J’abandonne</button>`);
  if (r !== 'y') { if (R.pausedAt) $('#pause').click(); return; }
  if (k >= .8) finish(k); else closeRun();
}
function endRun() { cancelAnimationFrame(raf); clearTimeout(lockT); if (R && R.gw != null) navigator.geolocation.clearWatch(R.gw); R = null; S.run = null; save(); $('#run').hidden = true; try { wl && wl.release(); } catch (e) {} }
function closeRun() { endRun(); render(); }
async function finish(frac) {
  const r = R, ses = r.ses, before = S.points, arr = [], kg = curKg(S), est = ses.dist * frac;
  const km = (r.gps > est * .6 && r.gps < est * 1.6 ? r.gps : est) / 1000, kcal = Math.round(ses.kcal(kg) * frac), min = Math.round(ses.total * frac / 60);
  endRun(); say('Séance terminée. Bravo.'); signal('end');
  if (r.kind === 'walk') { addPts(P.walk); arr.push(['Marche active', P.walk]); S.log.push({ d: r.day, k: 'walk', pts: P.walk, min, km, kcal }); }
  else {
    let pts = 0;
    if (r.kind === 'due') { pts += P.ok; arr.push(['Séance faite le bon jour', P.ok]); if (r.onTime) { pts += P.time; arr.push(['Départ à l’heure', P.time]); } }
    else { pts += P.late; arr.push(['Séance rattrapée', P.late]); }
    S.streak++; S.best = Math.max(S.best, S.streak);
    if (r.kind === 'due') { const b = P.streak * Math.min(S.streak, P.streakCap); pts += b; arr.push([`Série de ${S.streak}`, b]); }
    addPts(pts); S.done++;
    S.log.push({ d: r.day, for: r.for, k: r.kind === 'due' ? 'ok' : 'late', pts, onTime: r.onTime, min, km, kcal, lvl: S.prog });
    if (S.done % 4 === 0 && S.jokers < 2) { S.jokers++; arr.push(['Joker gagné 🃏', 0]); }
  }
  const q = questState(); if (!q.done && q.runs >= 3 && q.walks >= 2) { S.quests[q.m] = 1; addPts(P.quest); arr.push(['Quête de la semaine', P.quest]); }
  save(); tab = 'home'; setTab();
  const extra = `<div class="sum"><div><b>${dec(km)}</b>km</div><div><b>${kcal}</b>kcal</div><div><b>${min}</b>min</div></div>`;
  if (r.kind === 'walk') return result('Marche validée', '🚶', arr, before, extra);
  /* ressenti : ajuste la suite */
  const [f] = await modal(`<div class="ico">🎉</div><h3>Séance validée</h3>${extra}<p>C’était comment ? La prochaine séance s’adapte à ta réponse.</p>
    <div class="feel"><button data-r="easy"><svg viewBox="0 0 64 64"><rect x="6" y="8" width="52" height="50" rx="18" fill="rgba(0,0,0,.14)"/><circle cx="23" cy="28" r="6" fill="#fff"/><circle cx="41" cy="28" r="6" fill="#fff"/><circle cx="24" cy="29" r="2.6" fill="#12140f"/><circle cx="42" cy="29" r="2.6" fill="#12140f"/><path d="M20 41q12 12 24 0" fill="none" stroke="#12140f" stroke-width="4" stroke-linecap="round"/></svg>Facile</button><button data-r="ok"><svg viewBox="0 0 64 64"><rect x="6" y="8" width="52" height="50" rx="18" fill="rgba(0,0,0,.14)"/><circle cx="23" cy="28" r="6" fill="#fff"/><circle cx="41" cy="28" r="6" fill="#fff"/><circle cx="24" cy="29" r="2.6" fill="#12140f"/><circle cx="42" cy="29" r="2.6" fill="#12140f"/><path d="M22 44h20" fill="none" stroke="#12140f" stroke-width="4" stroke-linecap="round"/></svg>Correct</button><button data-r="hard"><svg viewBox="0 0 64 64"><rect x="6" y="8" width="52" height="50" rx="18" fill="rgba(0,0,0,.14)"/><path d="M17 27h12M35 27h12" stroke="#12140f" stroke-width="4" stroke-linecap="round"/><path d="M21 47q11-9 22 0" fill="none" stroke="#12140f" stroke-width="4" stroke-linecap="round"/></svg>Dur</button></div>`);
  S.feels.push(f); const l3 = S.feels.slice(-3), l2 = S.feels.slice(-2); let msg = '';
  if (f === 'hard' && l2.length === 2 && l2.every(x => x === 'hard')) { msg = 'Deux séances dures : tu refais la même, c’est normal et c’est comme ça qu’on progresse.'; S.feels.push('reset'); }
  else if (l3.length === 3 && l3.every(x => x === 'easy')) { S.prog += 2; msg = 'Trois séances faciles : tu sautes un cran.'; S.feels.push('reset'); }
  else S.prog++;
  save(); result('Bien joué', '🏅', arr, before, msg ? `<p>${msg}</p>` : '');
}

/* ---------- trajet ---------- */
let map = null, watch = null;
const CUM = ROUTE.reduce((a, p, i) => { a.push(i ? a[i - 1] + L.latLng(ROUTE[i - 1]).distanceTo(p) : 0); return a; }, []);
function cut(d) { const pts = []; for (let i = 0; i < ROUTE.length; i++) { if (CUM[i] <= d) pts.push(ROUTE[i]); else { const a = ROUTE[i - 1], b = ROUTE[i], k = (d - CUM[i - 1]) / (CUM[i] - CUM[i - 1]);
  pts.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); break; } } return pts; }
const at = d => cut(d).pop();
function gmaps(turn) { const c = p => p[0].toFixed(5) + ',' + p[1].toFixed(5), a = at(Math.min(850, turn * .6));
  return 'https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=' + c(ROUTE[0]) + '&destination=' + c(ROUTE[0]) + '&waypoints=' + [a, at(turn), a].map(c).join('%7C'); }
function mapView() {
  const walkDay = mode() === 'rest', ses = build(S.prog), wk = buildWalk(), turn = Math.min(ses.dist / 2, CUM[CUM.length - 1]);
  $('#view').innerHTML = `<div id="map"></div>
    <div class="card"><h2>${ses.name} · aller-retour</h2><div class="big">≈ ${dec(ses.dist / 1000)} km, retour chez toi compris</div>
    <p>Demi-tour à ${dec(turn / 1000)} km du départ, au bout de ${fmt(ses.half)}. L’appli vibre au moment de faire demi-tour, et la marche de fin te ramène jusqu’à ta porte.</p>
    <a class="btn run" href="${gmaps(turn)}" target="_blank" rel="noopener">Ouvrir dans Google Maps</a>
    <button class="btn sec" id="loc">Afficher ma position ici</button></div>
    <div class="card"><h2>Le chemin, étape par étape</h2><ol class="steps">
      <li><b>Départ</b> rue de l’Auberge de Jeunesse, au début de la Piste Maurice Garin.</li>
      <li><b>130 m</b> · traverse la route de Schirmeck. C’est la seule rue du parcours.</li>
      <li><b>300 m</b> · passerelle des Carolingiens (en bois), tu longes l’Ill.</li>
      <li><b>800 m</b> · la piste rejoint le canal de la Bruche. Suis le quai.</li>
      <li><b>1,1 km</b> · début de la Piste Charly Grosskost, le chemin de halage. Ensuite c’est tout droit le long du canal, sans voitures.</li>
      <li><b>Demi-tour</b> quand le téléphone vibre, et retour par le même chemin.</li></ol>
      <p>Marche active (jours sans course) : même chemin, demi-tour à ${dec(wk.dist / 2000)} km.</p></div>`;
  map = L.map('map', { zoomControl: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  L.polyline(ROUTE, { color: '#12140f', weight: 4, opacity: .55, dashArray: '2 8' }).addTo(map);
  const seg = cut(turn); L.polyline(seg, { color: '#12140f', weight: 11, opacity: 1 }).addTo(map);
  const line = L.polyline(seg, { color: '#c4f82a', weight: 6 }).addTo(map);
  const mk = (p, t, c = '') => L.marker(p, { icon: L.divIcon({ className: '', html: `<span class="mk ${c}">${t}</span>`, iconSize: [0, 0] }) }).addTo(map);
  mk(ROUTE[0], 'Départ et arrivée', 'start'); mk(seg[seg.length - 1], '↩ Demi-tour · ' + dec(turn / 1000) + ' km');
  map.fitBounds(line.getBounds(), { paddingTopLeft: [80, 50], paddingBottomRight: [80, 30] });
  $('#loc').onclick = () => { if (!navigator.geolocation) return; let me = null;
    watch = navigator.geolocation.watchPosition(p => { const ll = [p.coords.latitude, p.coords.longitude];
      if (!me) me = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18] }) }).addTo(map); else me.setLatLng(ll);
    }, () => { $('#loc').textContent = 'Position indisponible'; }, { enableHighAccuracy: true }); $('#loc').textContent = 'Position affichée en bleu'; };
}

/* ---------- programme ---------- */
function planView() {
  let h = '', d = S.start, i = 0, up = S.prog, wk = '', nextSet = false; const t = today();
  const ic = { ok: '✓', late: '↺', miss: '✕', joker: '🃏' }, lab = { ok: 'Faite', late: 'Rattrapée', miss: 'Manquée', joker: 'Joker' };
  const past = S.log.filter(e => ['ok', 'late', 'miss', 'joker'].includes(e.k)).length;
  while (i < past + 18) {
    if (isSched(d)) { const m = monday(d);
      if (m !== wk) { wk = m; h += `<div class="wk">Semaine du ${frDate(m, { day: 'numeric', month: 'long' })}</div>`; }
      const r = rec(d), name = frDate(d, { weekday: 'long', day: 'numeric', month: 'long' });
      if (r) h += `<div class="row ${r.k}"><div class="dot">${ic[r.k]}</div><div class="t"><b>${name}</b><span>${lab[r.k]}${r.onTime ? ' · à l’heure' : ''}${r.km ? ' · ' + dec(r.km) + ' km · ' + r.kcal + ' kcal' : ''}</span></div><div class="p ${r.pts < 0 ? 'minus' : 'plus'}">${r.pts > 0 ? '+' : ''}${r.pts || ''}</div></div>`;
      else { const s = build(up++), nx = !nextSet && d >= addDays(t, -1); if (nx) nextSet = true;
        h += `<div class="row ${nx ? 'next' : ''}"><div class="dot">${s.week}.${s.num}</div><div class="t"><b>${name} · 8h30</b><span>${s.title}<br>${Math.round(s.total / 60)} min · ≈ ${dec(s.dist / 1000)} km</span></div></div>`; }
      i++; }
    d = addDays(d, 1);
  }
  $('#view').innerHTML = `<div class="card"><h2>Ta progression</h2><div class="big">${S.prog < 24 ? 'Objectif : 30 min de course d’affilée' : 'Objectif : allonger la sortie du samedi'}</div>
    <p>Lundi, mercredi, samedi à 8h30. Les séances s’allongent toutes seules, et s’adaptent à ton ressenti : « dur » deux fois de suite, tu refais la même ; « facile » trois fois, tu sautes un cran. Après les 30 minutes, la sortie du samedi grandit jusqu’à 55 minutes.</p></div>` + h;
}

/* ---------- stats ---------- */
function chart() {
  const w = S.weights, W = 320, H = 190, weeks = 12, pA = project(weeks, 2, 0), pB = project(weeks, 2, 400), k0 = w[0].kg;
  const lo = Math.min(...w.map(x => x.kg), ...pB) - 1, hi = Math.max(...w.map(x => x.kg)) + 1;
  const t0 = parse(w[0].d).getTime(), tn = parse(today()).getTime(), t1 = tn + weeks * 7 * 864e5;
  const X = t => 34 + (t - t0) / (t1 - t0) * (W - 40), Y = k => 10 + (hi - k) / (hi - lo) * (H - 34);
  const goal = (k, c) => k > lo && k < hi ? `<line x1="34" x2="${W}" y1="${Y(k)}" y2="${Y(k)}" stroke="${c}" stroke-dasharray="2 6" stroke-width="1.5"/><text x="0" y="${Y(k) + 4}" fill="${c}" font-size="11" font-weight="800">${k} kg</text>` : '';
  const pl = (arr, c) => `<polyline points="${arr.map((k, i) => X(tn + i * 7 * 864e5).toFixed(1) + ',' + Y(k).toFixed(1)).join(' ')}" fill="none" stroke="${c}" stroke-width="2.5" stroke-dasharray="6 5" stroke-linecap="round"/>
    <text x="${W - 2}" y="${Y(arr[weeks]) - 7}" text-anchor="end" fill="${c}" font-size="12" font-weight="900">${dec(arr[weeks])}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;margin-top:12px">${goal(90, '#9aa19a')}${goal(85, '#9aa19a')}${goal(80, '#f3f5ef')}${goal(75, '#f3f5ef')}
    <text x="0" y="${Y(k0) + 4}" fill="#9aa19a" font-size="11" font-weight="800">${Math.round(k0)} kg</text>
    <line x1="${X(tn)}" x2="${X(tn)}" y1="6" y2="${H - 20}" stroke="#353a41" stroke-width="1.5"/><text x="${X(tn)}" y="${H - 6}" text-anchor="middle" fill="#9aa19a" font-size="10" font-weight="700">aujourd’hui</text>
    <text x="${W}" y="${H - 6}" text-anchor="end" fill="#9aa19a" font-size="10" font-weight="700">dans ${weeks} semaines</text>
    ${pl(pA, '#9b6bff')}${pl(pB, '#ff8a3d')}
    <polyline points="${w.map(x => X(parse(x.d).getTime()).toFixed(1) + ',' + Y(x.kg).toFixed(1)).join(' ')}" fill="none" stroke="#c4f82a" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    ${w.map(x => `<circle cx="${X(parse(x.d).getTime())}" cy="${Y(x.kg)}" r="4.5" fill="#c4f82a" stroke="#1f2226" stroke-width="2"/>`).join('')}</svg>
    <div class="leg"><span style="--c:#c4f82a">Tes pesées</span><span style="--c:#9b6bff">3 courses + 2 marches en plus</span><span style="--c:#ff8a3d">+ 400 kcal de moins par jour</span></div>`;
}
function weekBars() {
  const m0 = monday(today()), wk = []; for (let i = 7; i >= 0; i--) { const m = addDays(m0, -7 * i), e = addDays(m, 6);
    wk.push({ m, km: S.log.filter(x => x.d >= m && x.d <= e).reduce((a, x) => a + (x.km || 0), 0) }); }
  const mx = Math.max(6, ...wk.map(x => x.km));
  return `<div class="bars">${wk.map(x => `<div><span>${x.km ? dec(x.km) : ''}</span><i style="height:${Math.max(2, x.km / mx * 100)}%"></i><em>${frDate(x.m, { day: 'numeric', month: 'numeric' })}</em></div>`).join('')}</div>`;
}
function statsView() {
  const kg = curKg(S), T = tot(S), f = formRank(kg, S.h), pA = project(12, 2, 0), pB = project(12, 2, 400), wkKcal = (kg - project(1, 2, 0)[1]) * KCAL_KG;
  const kgTier = t => dec(kgAt(FQ[t], S.h));
  $('#view').innerHTML = `
  <div class="tiles"><div class="tile"><b>${dec(T.km)}</b><span>km parcourus</span></div><div class="tile"><b>${big(T.kcal)}</b><span>kcal brûlées</span></div>
    <div class="tile"><b>${Math.floor(T.min / 60)} h ${pad(T.min % 60)}</b><span>dehors</span></div><div class="tile"><b>${S.done}<small> + ${T.walks}</small></b><span>courses + marches</span></div></div>
  <div class="card"><h2>Kilomètres par semaine</h2>${weekBars()}<p>Tes calories brûlées valent ${big(T.kcal / KCAL_KG * 1000)} g de graisse.</p></div>
  <div class="card"><h2>Poids · prévision sur 12 semaines</h2><div class="big">${dec(kg)} kg <small style="color:var(--run)">${lost(S) > 0 ? '−' + dec(lost(S)) + ' kg' : ''}</small></div>
    ${chart()}
    <p>Si tu fais toutes tes séances et 2 marches actives par semaine (en plus de tes trajets à pied habituels, déjà comptés dans ton poids actuel) : <b style="color:#9b6bff">${dec(pA[12])} kg</b> dans 12 semaines (≈ ${big(wkKcal)} kcal brûlées par semaine).
    En mangeant en plus 400 kcal de moins par jour (un soda et un grignotage) : <b style="color:var(--gold)">${dec(pB[12])} kg</b>. Le sport seul ne suffit pas : c’est l’assiette qui fait les deux tiers du travail.</p>
    <button class="btn ${weighedThisWeek() ? 'sec' : 'run'}" id="wg">${weighedThisWeek() ? 'Corriger / ajouter une pesée' : 'Pesée de la semaine'}</button></div>
  <div class="card form" style="--rank:${f.color}"><h2>Rang forme</h2><div class="frow">${emblem(f, 'emblem sm')}<div><div class="big">${f.name}</div>
    <p>Plus léger que ${Math.round(f.q)} % des hommes en France de ta taille (${S.h} cm).</p></div></div>
    <div class="ranks">${TIERS.map((t, i) => `<div class="${t[0] === f.tier ? 'me' : ''}" style="color:${t[1]}"><span>${t[0]}</span><span>${i ? 'sous ' + kgTier(i) + ' kg · top ' + (100 - FQ[i]) + ' %' : 'départ'}</span></div>`).concat(`<div class="${f.tier === 'Master' ? 'me' : ''}" style="color:${APEX[0][2]}"><span>Master</span><span>sous ${kgTier(7)} kg · top 25 %</span></div>`).reverse().join('')}</div>
    <p>À partir de Platine, tu es plus léger que la moyenne des hommes en France. Le classement s’arrête à Master : descendre plus bas n’apporte rien.</p></div>
  <div class="card"><h2>Pesées</h2>${S.weights.slice().reverse().map((x, i, a) => { const pv = a[i + 1], df = pv ? x.kg - pv.kg : 0;
    return `<div class="rule"><span style="text-transform:capitalize">${frDate(x.d, { weekday: 'short', day: 'numeric', month: 'short' })}</span><b class="${df < 0 ? 'plus' : df > 0 ? 'minus' : ''}">${dec(x.kg)} kg${pv ? ' (' + (df > 0 ? '+' : df < 0 ? '−' : '') + dec(Math.abs(df)) + ')' : ''}</b></div>`; }).join('')}</div>`;
  $('#wg').onclick = weigh;
}

/* ---------- règles ---------- */
function rulesView() {
  const r = rank(S.points);
  $('#view').innerHTML = `<div class="card"><h2>Le contrat</h2><div class="big">Lundi, mercredi, samedi · 8h30</div>
    <p>L’appli ne peut pas te réveiller toute seule. Ajoute les rappels à ton agenda : il sonnera 20 minutes avant chaque séance.</p>
    <button class="btn run" id="ics">Ajouter les rappels à mon agenda</button></div>
  <div class="card"><h2>Pendant la séance</h2><p style="color:var(--txt)">Le téléphone vibre fort à chaque changement :</p>
    <div class="rule"><span>3 longues vibrations</span><b class="plus">COURS</b></div>
    <div class="rule"><span>1 très longue vibration</span><b style="color:var(--walk)">MARCHE</b></div>
    <div class="rule"><span>Rafale de petites vibrations</span><b>DEMI-TOUR</b></div>
    <p>L’écran doit rester allumé pour que ça vibre : l’appli passe toute seule en « mode poche » (écran noir verrouillé). Ne verrouille pas le téléphone avec le bouton.</p>
    <button class="btn sec" id="tv">Tester les vibrations</button></div>
  <div class="card"><h2>Ce que tu gagnes</h2>
    <div class="rule"><span>Séance faite le bon jour</span><b class="plus">+${P.ok}</b></div>
    <div class="rule"><span>Départ entre 8h00 et 9h30</span><b class="plus">+${P.time}</b></div>
    <div class="rule"><span>Série en cours (max ${P.streak * P.streakCap})</span><b class="plus">+${P.streak} × série</b></div>
    <div class="rule"><span>Séance rattrapée le lendemain</span><b class="plus">+${P.late}</b></div>
    <div class="rule"><span>Marche active un jour sans course</span><b class="plus">+${P.walk}</b></div>
    <div class="rule"><span>Quête : 3 courses + 2 marches dans la semaine</span><b class="plus">+${P.quest}</b></div>
    <div class="rule"><span>Pesée du lundi (un autre jour : +${P.weigh})</span><b class="plus">+${P.weighMon}</b></div>
    <div class="rule"><span>Chaque kilo perdu (nouveau record)</span><b class="plus">+${P.kg}</b></div>
    <div class="rule"><span>Chaque division gagnée au rang forme</span><b class="plus">+${P.form}</b></div></div>
  <div class="card"><h2>Ce que tu perds</h2>
    <div class="rule"><span>Séance sautée et pas rattrapée le lendemain</span><b class="minus">−${P.miss}</b></div>
    <div class="rule"><span>… et ta série retombe à zéro</span><b class="minus">série 0</b></div>
    <div class="rule"><span>Semaine sans pesée</span><b class="minus">−${P.weighMiss}</b></div>
    <div class="rule"><span>Reprendre du poids</span><b>0</b></div>
    <p>Un joker excuse une séance (malade, blessé, tempête). Tu en as ${S.jokers}, tu en regagnes un toutes les 4 séances, 2 au maximum.</p></div>
  <div class="card"><h2>Rang discipline</h2><p>Chaque division vaut ${DIVLP} LP, de IV à I, comme en classé. Perds des LP et tu redescends.</p><div class="ranks" style="margin-top:12px">
    ${APEX.slice().reverse().map(a => `<div class="${r.tier === a[0] ? 'me' : ''}" style="color:${a[2]}"><span>${a[0]}</span><span>${big(a[1])} LP</span></div>`).join('')}
    ${TIERS.map((t, i) => `<div class="${r.tier === t[0] ? 'me' : ''}" style="color:${t[1]}"><span>${t[0]} IV → I</span><span>${big(i * 4 * DIVLP)} LP</span></div>`).reverse().join('')}</div></div>
  <button class="btn ghost" id="rst" style="color:var(--mut)">Tout remettre à zéro</button>`;
  $('#ics').onclick = ics;
  $('#tv').onclick = async () => { for (const [k, t] of [['run', 'COURS'], ['walk', 'MARCHE'], ['half', 'DEMI-TOUR']]) { $('#tv').textContent = t; buzz(VIB[k]); await new Promise(r => setTimeout(r, VIB[k].reduce((a, b) => a + b, 0) + 1200)); } $('#tv').textContent = 'Tester les vibrations'; };
  $('#rst').onclick = async () => { const [x] = await modal(`<div class="ico">⚠️</div><h3>Tout effacer ?</h3><p>LP, séances et pesées seront perdus pour de bon.</p><button class="btn sec" data-r="n">Annuler</button><button class="btn bad" data-r="y">Tout effacer</button>`);
    if (x === 'y') { localStorage.removeItem(KEY); location.reload(); } };
}
function ics() {
  const d = S.start.replace(/-/g, ''), st = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z', mo = monday(addDays(S.start, 6)).replace(/-/g, '');
  const ev = (uid, start, end, rule, sum, mins) => ['BEGIN:VEVENT', 'UID:' + uid + '@course', 'DTSTAMP:' + st, 'DTSTART:' + start, 'DTEND:' + end, 'RRULE:' + rule, 'SUMMARY:' + sum,
    'BEGIN:VALARM', 'TRIGGER:-PT' + mins + 'M', 'ACTION:DISPLAY', 'DESCRIPTION:' + sum, 'END:VALARM', 'END:VEVENT'];
  const txt = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//course//FR',
    ...ev('run', d + 'T083000', d + 'T091500', 'FREQ=WEEKLY;BYDAY=MO,WE,SA', 'Course 8h30 (sinon −150 LP)', 20),
    ...ev('weigh', mo + 'T080000', mo + 'T080500', 'FREQ=WEEKLY;BYDAY=MO', 'Pesée du lundi', 0),
    'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/calendar' })); a.download = 'course-rappels.ics'; a.click();
}

/* ---------- navigation ---------- */
function setTab() { document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab)); }
function render() {
  if (watch !== null) { navigator.geolocation.clearWatch(watch); watch = null; }
  if (map) { map.remove(); map = null; }
  setTab(); scrollTo(0, 0);
  ({ home, map: mapView, plan: planView, stats: statsView, rules: rulesView })[tab]();
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });

/* ---------- démarrage ---------- */
async function boot() {
  if (!S) {
    const [, v, h] = await modal(`<div class="ico">🏃</div><h3>On signe le contrat</h3>
      <p>Trois séances par semaine, imposées : <b style="color:#fff">lundi, mercredi, samedi à 8h30</b>. Tu gagnes des LP en y allant, tu en perds en restant au lit.</p>
      <div class="two"><label>Poids (kg)${numInput(95)}</label><label>Taille (cm)${numInput(175, '1')}</label></div>
      <button class="btn run" data-r="y">Je signe</button>`);
    const kg = parseFloat(String(v).replace(',', '.')), hh = parseInt(h, 10); create(kg > 40 && kg < 200 ? kg : 95, hh > 130 && hh < 220 ? hh : 175);
  }
  const before = S.points, lostArr = settle(), lostPts = before - S.points, a = rank(before), b = rank(S.points);
  shown = b.lp; render();
  if (S.run && S.run.day === today()) { const ses = S.run.kind === 'walk' ? buildWalk() : build(S.prog), e = ((S.run.pausedAt || Date.now()) - S.run.start - S.run.paused) / 1000 * SPEED;
    if (e < ses.total) return startRun(S.run.kind, Object.assign({}, S.run)); }
  S.run = null; save();
  if (lostArr.length) { buzz([400, 150, 400]);
    await modal(`<div class="ico">💀</div><h3>Tu es resté au lit</h3>${lines(lostArr)}<div class="total minus">−${lostPts}<small> LP</small></div>
      ${lostPts < -lostArr.reduce((x, l) => x + l[1], 0) ? '<p>Tu n’avais pas plus à perdre.</p>' : ''}
      ${b.step < a.step ? `<div class="rankup down">Rétrogradé en ${b.name}</div>` : ''}<button class="btn bad" data-r="ok">Compris</button>`, 'shake');
    render(); }
}
boot();
if ('serviceWorker' in navigator && !TEST) navigator.serviceWorker.register('sw.js').catch(() => {});
