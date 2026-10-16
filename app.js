'use strict';

// ============================================================
//  NutriJour : journal alimentaire (PWA, données locales)
// ============================================================

const KEY = 'nutrijour.v1';

const MEALS = [
  ['breakfast', 'Petit-déjeuner'],
  ['lunch', 'Déjeuner'],
  ['dinner', 'Dîner'],
  ['snacks', 'Collations'],
];

const ACTIVITY = [
  [1.2, 'Sédentaire (peu ou pas de sport)'],
  [1.375, 'Légèrement actif (1 à 3 séances / semaine)'],
  [1.55, 'Actif (3 à 5 séances / semaine)'],
  [1.725, 'Très actif (6 à 7 séances / semaine)'],
  [1.9, 'Extrêmement actif (travail physique + sport)'],
];

// écart quotidien en kcal (≈ 7 700 kcal par kg)
const GOALS = [
  [-550, 'Perdre 0,5 kg par semaine'],
  [-275, 'Perdre 0,25 kg par semaine'],
  [0, 'Maintenir mon poids'],
  [275, 'Prendre 0,25 kg par semaine'],
  [550, 'Prendre 0,5 kg par semaine'],
];

// valeurs MET (Compendium of Physical Activities) : kcal = MET × kg × heures
const EXERCISES = [
  ['walk', 'Marche (4-5 km/h)', 3.5],
  ['brisk', 'Marche rapide (6 km/h)', 5],
  ['run8', 'Course à pied (8 km/h)', 8.3],
  ['run10', 'Course à pied (10 km/h)', 9.8],
  ['bike', 'Vélo (modéré)', 6.8],
  ['swim', 'Natation', 7],
  ['strength', 'Musculation', 5],
  ['hiit', 'HIIT / circuit training', 8],
  ['yoga', 'Yoga / étirements', 2.5],
  ['dance', 'Danse', 5],
  ['football', 'Football', 7],
  ['house', 'Ménage / jardinage', 3.3],
  ['custom', 'Autre (je saisis les calories)', 0],
];

const OFF_FIELDS = 'code,product_name,product_name_fr,generic_name_fr,brands,nutriments,serving_quantity';

const DEFAULT_PROFILE = { carbsPct: 50, proteinPct: 20, fatPct: 30, water: 2000, eatBack: true, activity: 1.375, goal: 0 };

// ---------- utilitaires ----------
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round = (n, d = 0) => { const p = 10 ** d; return Math.round(n * p) / p; };
const fmt = (n, d = 0) => round(n, d).toLocaleString('fr-FR');
const num = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const mealLabel = id => (MEALS.find(m => m[0] === id) || MEALS[0])[1];

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- état ----------
function emptyState() { return { profile: null, days: {}, weights: [], recents: [], savedMeals: [] }; }

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...emptyState(), ...JSON.parse(raw) } : emptyState();
  } catch {
    return emptyState();
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { toast("Impossible d'enregistrer : stockage plein ou bloqué."); }
}

let state = load();
let current = ymd(new Date());
let view = 'journal';

const EMPTY_DAY = Object.freeze({ foods: [], exercises: [], water: 0 });
const dayRead = (key = current) => state.days[key] || EMPTY_DAY;
const dayWrite = (key = current) => (state.days[key] ??= { foods: [], exercises: [], water: 0 });

function latestWeight() {
  const w = [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).pop();
  return w?.kg ?? state.profile?.weight ?? 70;
}

// ---------- calculs ----------
function targets(p = state.profile) {
  if (!p) return null;
  // Mifflin-St Jeor
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
  const tdee = bmr * p.activity;
  const floor = p.sex === 'm' ? 1500 : 1200;
  const raw = tdee + Number(p.goal);
  const kcal = Math.round(Math.max(raw, floor) / 10) * 10;
  return {
    bmr, tdee, kcal, floored: raw < floor,
    c: kcal * p.carbsPct / 100 / 4,
    p: kcal * p.proteinPct / 100 / 4,
    f: kcal * p.fatPct / 100 / 9,
    water: p.water,
  };
}

const nutr = (per100, grams) => {
  const k = grams / 100;
  return { kcal: per100.kcal * k, c: per100.c * k, p: per100.p * k, f: per100.f * k };
};

function totals(foods) {
  return foods.reduce((t, e) => {
    const n = nutr(e.per100, e.grams);
    t.kcal += n.kcal; t.c += n.c; t.p += n.p; t.f += n.f;
    return t;
  }, { kcal: 0, c: 0, p: 0, f: 0 });
}

function dayBalance(key) {
  const d = dayRead(key);
  const t = targets();
  const eaten = totals(d.foods).kcal;
  const burned = d.exercises.reduce((s, e) => s + e.kcal, 0);
  const counted = state.profile?.eatBack === false ? 0 : burned;
  const goal = (t?.kcal ?? 2000) + counted;
  return { eaten, burned, counted, base: t?.kcal ?? 2000, goal, remaining: goal - eaten };
}

// série : jours consécutifs avec au moins un aliment noté (aujourd'hui vide ne casse pas la série)
const MILESTONES = [3, 5, 7, 10, 14, 21, 30, 50, 75, 100, 150, 200, 365];

function streak() {
  const today = ymd(new Date());
  let k = state.days[today]?.foods.length ? today : addDays(today, -1);
  let n = 0;
  while (state.days[k]?.foods.length) { n++; k = addDays(k, -1); }
  return n;
}

// à appeler après un ajout, avec la série mesurée avant l'ajout
function celebrate(before) {
  const after = streak();
  if (after <= before || !MILESTONES.includes(after)) return;
  const next = MILESTONES.find(m => m > after);
  setTimeout(() => toast(`🔥 ${after} jours de saisie d'affilée !${next ? ` Prochain palier : ${next} jours.` : ''}`), 1400);
}

// « si chaque jour ressemblait à celui-ci » : poids estimé dans 5 semaines
function projection(key) {
  const t = targets();
  if (!t) return null;
  const b = dayBalance(key);
  const spent = t.tdee + b.counted;
  const now = latestWeight();
  return {
    eaten: b.eaten, spent, now,
    kg: now + (b.eaten - spent) * 35 / 7700,
    floor: state.profile.sex === 'm' ? 1500 : 1200,
  };
}

// ============================================================
//  Rendu
// ============================================================
function dateLabel(key) {
  const today = ymd(new Date());
  if (key === today) return "Aujourd'hui";
  if (key === addDays(today, -1)) return 'Hier';
  if (key === addDays(today, 1)) return 'Demain';
  return parseYmd(key).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function render() {
  $$('.view').forEach(v => { v.hidden = v.id !== `view-${view}`; });
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#datenav').hidden = view !== 'journal';
  const title = $('#view-title');
  title.hidden = view === 'journal';
  title.textContent = view === 'progress' ? 'Progrès' : 'Profil';
  if (view === 'journal') renderJournal();
  if (view === 'progress') renderProgress();
  if (view === 'profile') renderProfile();
}

function macroRow(cls, label, val, goal) {
  const pct = goal ? Math.min(100, val / goal * 100) : 0;
  return `<div class="macro ${cls}"><span>${label}</span><div class="bar"><i style="width:${pct}%"></i></div>
    <span>${fmt(val)}${goal ? ` / ${fmt(goal)}` : ''} g</span></div>`;
}

function renderJournal() {
  $('#date-label').textContent = dateLabel(current);
  const d = dayRead(current);
  const t = targets();
  const tot = totals(d.foods);
  const b = dayBalance(current);

  // résumé
  const R = 52, C = 2 * Math.PI * R;
  const pct = b.goal > 0 ? Math.min(1, b.eaten / b.goal) : 0;
  const over = b.remaining < 0;
  $('#summary').innerHTML = `
    <div class="ring ${over ? 'over' : ''}">
      <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">
        <circle class="ring-track" cx="60" cy="60" r="${R}" fill="none" stroke-width="11"/>
        <circle class="ring-value" cx="60" cy="60" r="${R}" fill="none" stroke-width="11" stroke-linecap="round"
          stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/>
      </svg>
      <div class="ring-center"><b>${fmt(Math.abs(b.remaining))}</b><span>${over ? 'kcal en trop' : 'kcal restantes'}</span></div>
    </div>
    <div>
      <div class="equation">
        <div><b>${fmt(b.base)}</b>Objectif</div>
        <div><b>− ${fmt(b.eaten)}</b>Aliments</div>
        <div><b>+ ${fmt(b.counted)}</b>Exercice</div>
      </div>
      <div class="macros">
        ${macroRow('macro-c', 'Glucides', tot.c, t?.c)}
        ${macroRow('macro-p', 'Protéines', tot.p, t?.p)}
        ${macroRow('macro-f', 'Lipides', tot.f, t?.f)}
      </div>
    </div>
    ${t ? '' : `<p class="hint setup">Objectif par défaut de 2 000 kcal. <button class="link-btn" data-action="tab" data-view="profile">Calculer mon objectif</button></p>`}
    ${(n => n ? `<p class="streak">🔥 Série : <b>${n} jour${n > 1 ? 's' : ''}</b> de saisie d'affilée</p>` : '')(streak())}`;

  // repas
  $('#meals').innerHTML = MEALS.map(([id, label]) => {
    const items = d.foods.filter(e => e.meal === id);
    const kcal = totals(items).kcal;
    return `<div class="card meal">
      <div class="meal-head"><h2>${label}</h2><span class="meal-kcal">${fmt(kcal)} kcal
        <button class="icon-btn" data-action="meal-menu" data-meal="${id}" aria-label="Options : ${label}">⋯</button></span></div>
      <ul class="list">${items.map(e => `<li>
        <button class="entry" data-action="edit-entry" data-id="${e.id}">
          <span class="name">${esc(e.name)}<span class="sub">${e.quick ? 'Ajout rapide' : `${e.brand ? esc(e.brand) + ' · ' : ''}${fmt(e.grams)} g`}</span></span>
          <span class="kcal">${fmt(nutr(e.per100, e.grams).kcal)}</span>
        </button></li>`).join('')}</ul>
      <button class="link-btn" data-action="add-food" data-meal="${id}">+ Ajouter un aliment</button>
    </div>`;
  }).join('');

  // exercice
  const burned = d.exercises.reduce((s, e) => s + e.kcal, 0);
  $('#exercise-card').innerHTML = `
    <div class="meal-head"><h2>Exercice</h2><span>${fmt(burned)} kcal</span></div>
    <ul class="list">${d.exercises.map(e => `<li><div class="entry">
      <span class="name">${esc(e.name)}<span class="sub">${fmt(e.minutes)} min</span></span>
      <span class="actions"><span class="kcal">${fmt(e.kcal)}</span>
        <button class="icon-btn" data-action="del-exercise" data-id="${e.id}" aria-label="Supprimer ${esc(e.name)}">✕</button></span>
    </div></li>`).join('')}</ul>
    <button class="link-btn" data-action="add-exercise">+ Ajouter un exercice</button>
    ${state.profile?.eatBack === false && burned ? '<p class="hint">Les calories d\'exercice ne sont pas ajoutées à ton objectif (réglage du profil).</p>' : ''}`;

  // eau
  const goalW = t?.water ?? 2000;
  const glasses = Math.max(8, Math.ceil(goalW / 250));
  const full = Math.floor(d.water / 250);
  $('#water-card').innerHTML = `
    <div class="meal-head"><h2>Eau</h2><span>${fmt(d.water)} / ${fmt(goalW)} ml</span></div>
    <div class="glasses" aria-hidden="true">${Array.from({ length: Math.max(glasses, full) }, (_, i) => `<span class="${i < full ? 'full' : ''}">💧</span>`).join('')}</div>
    <div class="water-row water">
      <button class="btn" data-action="water" data-ml="-250" ${d.water <= 0 ? 'disabled' : ''} aria-label="Retirer 250 ml">−</button>
      <div class="bar"><i style="width:${Math.min(100, d.water / goalW * 100)}%"></i></div>
      <button class="btn" data-action="water" data-ml="250">+ 250 ml</button>
      <button class="btn" data-action="water" data-ml="500">+ 500 ml</button>
    </div>`;

  // fin de journée
  const cc = $('#complete-card');
  cc.hidden = !d.foods.length;
  cc.innerHTML = d.completed
    ? `<div class="meal-head"><h2>✓ Journée terminée</h2><button class="link-btn" data-action="complete-show">Voir la projection</button></div>`
    : `<button class="btn primary wide" data-action="complete-day">Terminer ma journée</button>
       <p class="hint">Fais le point : où t'amènerait une journée comme celle-ci, répétée pendant 5 semaines ?</p>`;
}

function showCompletion() {
  const p = projection(current);
  const when = current === ymd(new Date()) ? "aujourd'hui" : 'cette journée';
  let html;
  if (!p) {
    html = `<p>Renseigne ton profil pour obtenir une projection de poids.</p>
      <button class="btn wide" data-action="tab" data-view="profile">Remplir mon profil</button>`;
  } else if (p.eaten < p.floor) {
    html = `<p>Tu as noté <b>${fmt(p.eaten)} kcal</b>, moins que le minimum conseillé de ${fmt(p.floor)} kcal.</p>
      <p class="hint">Si tu n'as pas tout noté, ajoute les aliments manquants. Manger aussi peu de façon régulière
      n'est pas recommandé sans suivi médical : pas de projection pour cette journée.</p>`;
  } else {
    const diff = p.kg - p.now;
    html = `<p>Si chaque jour ressemblait à ${when}, dans 5 semaines tu pèserais environ</p>
      <p class="big">${fmt(p.kg, 1)} kg</p>
      <p class="hint">Soit ${diff > 0 ? '+' : ''}${fmt(diff, 1)} kg par rapport à ton poids actuel (${fmt(p.now, 1)} kg).
      Calcul : ${fmt(p.eaten)} kcal mangées − ${fmt(p.spent)} kcal dépensées (métabolisme, activité${p.spent > targets().tdee + 0.5 ? ', exercice' : ''})
      = ${p.eaten - p.spent > 0 ? '+' : ''}${fmt(p.eaten - p.spent)} kcal par jour, avec 7 700 kcal ≈ 1 kg. C'est une estimation : le poids réel varie.</p>`;
  }
  $('#complete-body').innerHTML = html;
  $('#sheet-complete').showModal();
}

// ---------- progrès ----------
function lineChart(points) {
  if (points.length < 2) return '<p class="hint">Ajoute au moins deux pesées pour voir la courbe.</p>';
  const W = 320, H = 150, L = 34, B = 20, T = 10, Rr = 8;
  const xs = points.map(p => parseYmd(p.date).getTime());
  const ys = points.map(p => p.kg);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y1 - y0 < 2) { y0 -= 1; y1 += 1; }
  const sx = x => L + (x - x0) / (x1 - x0 || 1) * (W - L - Rr);
  const sy = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(p.kg).toFixed(1)}`).join('');
  const ticks = [y0, (y0 + y1) / 2, y1];
  const short = s => parseYmd(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution du poids">
    ${ticks.map(v => `<line class="axis" x1="${L}" x2="${W - Rr}" y1="${sy(v)}" y2="${sy(v)}"/><text class="lbl" x="${L - 4}" y="${sy(v) + 3}" text-anchor="end">${fmt(v, 1)}</text>`).join('')}
    <path class="line" d="${path}"/>
    ${points.map((p, i) => `<circle class="dot" cx="${sx(xs[i])}" cy="${sy(p.kg)}" r="3.5"><title>${short(p.date)} : ${fmt(p.kg, 1)} kg</title></circle>`).join('')}
    <text class="lbl" x="${L}" y="${H - 4}">${short(points[0].date)}</text>
    <text class="lbl" x="${W - Rr}" y="${H - 4}" text-anchor="end">${short(points.at(-1).date)}</text>
  </svg>`;
}

function kcalChart() {
  const W = 320, H = 150, B = 22, T = 14, L = 6;
  const days = Array.from({ length: 7 }, (_, i) => addDays(ymd(new Date()), i - 6));
  const data = days.map(k => ({ k, ...dayBalance(k) }));
  const max = Math.max(...data.map(d => Math.max(d.eaten, d.goal)), 1) * 1.1;
  const bw = (W - L * 2) / 7;
  const sy = v => T + (1 - v / max) * (H - T - B);
  const goal = data[data.length - 1].base;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Calories consommées sur 7 jours">
    ${data.map((d, i) => {
      const x = L + i * bw + bw * .18, w = bw * .64, y = sy(d.eaten);
      const lab = parseYmd(d.k).toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');
      return `<rect class="barc ${d.eaten > d.goal ? 'over' : ''}" x="${x}" y="${y}" width="${w}" height="${Math.max(0, H - B - y)}" rx="4"><title>${lab} : ${fmt(d.eaten)} kcal</title></rect>
        <text class="lbl" x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${lab}</text>
        ${d.eaten ? `<text class="lbl" x="${x + w / 2}" y="${y - 3}" text-anchor="middle">${fmt(d.eaten)}</text>` : ''}`;
    }).join('')}
    <line class="goal" x1="${L}" x2="${W - L}" y1="${sy(goal)}" y2="${sy(goal)}"/>
  </svg><p class="hint">Pointillés : objectif de base (${fmt(goal)} kcal). Rouge : objectif dépassé.</p>`;
}

function renderProgress() {
  const form = $('#weight-form');
  if (!form.date.value) form.date.value = ymd(new Date());
  if (!form.kg.value) form.kg.placeholder = `${fmt(latestWeight(), 1)} kg`;
  const pts = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  $('#weight-chart').innerHTML = lineChart(pts);
  $('#weight-list').innerHTML = pts.slice().reverse().slice(0, 10).map((w, i, arr) => {
    const prev = arr[i + 1];
    const diff = prev ? w.kg - prev.kg : null;
    return `<li><div class="entry">
      <span class="name">${fmt(w.kg, 1)} kg<span class="sub">${parseYmd(w.date).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}${diff != null ? ` · ${diff > 0 ? '+' : ''}${fmt(diff, 1)} kg` : ''}</span></span>
      <button class="icon-btn" data-action="del-weight" data-date="${w.date}" aria-label="Supprimer cette pesée">✕</button>
    </div></li>`;
  }).join('');
  $('#kcal-chart').innerHTML = kcalChart();
}

// ---------- profil ----------
function fillProfileForm() {
  const f = $('#profile-form');
  const p = { ...DEFAULT_PROFILE, ...state.profile };
  if (p.sex) f.querySelector(`[name=sex][value=${p.sex}]`).checked = true;
  for (const k of ['age', 'height', 'carbsPct', 'proteinPct', 'fatPct', 'water']) f[k].value = p[k] ?? '';
  f.weight.value = state.profile ? latestWeight() : '';
  f.activity.value = String(p.activity);
  f.goal.value = String(p.goal);
  f.eatBack.checked = p.eatBack !== false;
}

function readProfileForm() {
  const f = $('#profile-form');
  const fd = new FormData(f);
  return {
    sex: fd.get('sex'),
    age: num(fd.get('age')), height: num(fd.get('height')), weight: num(fd.get('weight')),
    activity: num(fd.get('activity')), goal: num(fd.get('goal')),
    carbsPct: num(fd.get('carbsPct')), proteinPct: num(fd.get('proteinPct')), fatPct: num(fd.get('fatPct')),
    water: num(fd.get('water')), eatBack: f.eatBack.checked,
  };
}

function updateComputed() {
  const p = readProfileForm();
  const sum = (p.carbsPct || 0) + (p.proteinPct || 0) + (p.fatPct || 0);
  const ms = $('#macro-sum');
  ms.textContent = `Total : ${sum} %${sum !== 100 ? ' (doit faire 100 %)' : ''}`;
  ms.style.color = sum === 100 ? '' : 'var(--danger)';
  const ok = p.sex && p.age && p.height && p.weight;
  if (!ok) { $('#computed').innerHTML = 'Remplis sexe, âge, taille et poids pour voir ton objectif.'; return; }
  const t = targets(p);
  $('#computed').innerHTML = `
    Métabolisme de base : ${fmt(t.bmr)} kcal · Dépense estimée : ${fmt(t.tdee)} kcal<br>
    Objectif quotidien : <strong>${fmt(t.kcal)} kcal</strong>
    (glucides ${fmt(t.c)} g · protéines ${fmt(t.p)} g · lipides ${fmt(t.f)} g)
    ${t.floored ? `<br><span style="color:var(--danger)">Objectif relevé au minimum conseillé de ${fmt(t.kcal)} kcal : descendre plus bas n'est pas recommandé sans suivi médical.</span>` : ''}`;
}

function renderProfile() {
  $('#onboarding').hidden = !!state.profile;
  fillProfileForm();
  updateComputed();
}

// ============================================================
//  Ajout d'aliments
// ============================================================
let addMeal = 'breakfast';
let results = [];
let detail = null; // { food, entryId }

function openAdd(meal) {
  addMeal = meal;
  $('#add-title').textContent = `Ajouter : ${mealLabel(meal)}`;
  switchAddTab('search');
  $('#search-form').q.value = '';
  showRecents();
  $('#sheet-add').showModal();
}

function switchAddTab(tab) {
  $$('#sheet-add .tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('#sheet-add .add-pane').forEach(p => { p.hidden = p.dataset.pane !== tab; });
  if (tab !== 'barcode') stopScan();
  if (tab === 'saved') renderSaved();
  if (tab === 'barcode') {
    const can = 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia && window.isSecureContext;
    $('#scan-btn').hidden = !can;
    $('#scan-status').textContent = can ? '' :
      "Le scan par caméra n'est pas disponible sur ce navigateur (il fonctionne avec Chrome sur Android). Tape le code à la place.";
  }
}

function resultItem(food, action, i) {
  return `<li><button class="entry" data-action="${action}" data-idx="${i}">
    <span class="name">${esc(food.name)}<span class="sub">${food.brand || food.grp ? esc(food.brand || food.grp) + ' · ' : ''}${fmt(food.per100.kcal)} kcal / 100 g</span></span>
    <span class="kcal">›</span></button></li>`;
}

function showRecents() {
  $('#search-status').textContent = state.recents.length ? 'Récemment ajoutés'
    : 'Aliments génériques (table Ciqual). Pour un produit de marque, utilise le code-barres.';
  loadCiqual().catch(() => {}); // précharge pendant que l'utilisateur tape
  $('#search-results').innerHTML = state.recents.map((f, i) => resultItem(f, 'pick-recent', i)).join('');
}

function fromOff(p) {
  if (!p) return null;
  const n = p.nutriments || {};
  let kcal = num(n['energy-kcal_100g']);
  if (kcal == null && num(n.energy_100g) != null) kcal = n.energy_100g / 4.184;
  const name = (p.product_name_fr || p.product_name || p.generic_name_fr || '').trim();
  if (kcal == null || !name) return null;
  return {
    name,
    brand: (p.brands || '').split(',')[0].trim(),
    code: p.code || null,
    serving: num(p.serving_quantity),
    per100: { kcal, c: num(n.carbohydrates_100g) ?? 0, p: num(n.proteins_100g) ?? 0, f: num(n.fat_100g) ?? 0 },
  };
}

// --- recherche texte : table Ciqual (Anses) embarquée ---
// La recherche JSON d'Open Food Facts n'est plus accessible depuis un navigateur
// (503 sur /cgi/search.pl, pas de CORS sur search.openfoodfacts.org).
const STOP = new Set(['d', 'de', 'du', 'des', 'la', 'le', 'les', 'l', 'au', 'aux', 'et', 'a', 'en', 'un', 'une']);
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
let ciqual = null;

async function loadCiqual() {
  if (ciqual) return ciqual;
  const r = await fetch('ciqual.json');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  ciqual = j.foods.map(([name, grp, kcal, c, p, f]) => {
    const n = norm(name);
    return { name, grp, words: n.split(' '), first: norm(name.split(',')[0]), per100: { kcal, c, p, f } };
  });
  return ciqual;
}

function searchLocal(q) {
  const qn = norm(q);
  // « flocons » trouve « flocon », « pommes » trouve « pomme »
  const raw = qn.split(' ').filter(t => t && !STOP.has(t));
  const toks = raw.map(t => (t.length > 3 ? t.replace(/[sx]$/, '') : t));
  if (!toks.length) return [];
  const scored = [];
  for (const f of ciqual) {
    let hits = 0, exact = 0, typed = 0;
    toks.forEach((t, i) => {
      const w = f.words.find(w => w.startsWith(t));
      if (!w) return;
      hits++;
      if (w === t || w === t + 's' || w === t + 'x') exact++;
      if (f.words.includes(raw[i])) typed++;               // « pates » préfère « Pâtes » à « Pâté »
    });
    if (!hits) continue;
    let score = exact * 10 + typed * 15 - f.name.length * 0.3;
    if (f.first === toks.join(' ')) score += 80;          // « Pomme, crue » pour « pomme »
    else if (f.words[0].startsWith(toks[0])) score += 40;  // commence par le premier mot
    scored.push({ score, hits, f });
  }
  // on garde les aliments qui contiennent le plus de mots de la recherche
  const best = Math.max(0, ...scored.map(s => s.hits));
  return scored.filter(s => s.hits === best).sort((a, b) => b.score - a.score).slice(0, 40)
    .map(({ f }) => ({ name: f.name, brand: '', grp: f.grp, code: null, per100: f.per100 }));
}

async function lookupBarcode(code) {
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return j.status === 1 ? fromOff(j.product) : null;
}

async function handleBarcode(code) {
  $('#scan-status').textContent = `Code ${code} : recherche…`;
  try {
    const food = await lookupBarcode(code);
    if (!food) {
      $('#scan-status').textContent = `Produit ${code} introuvable ou sans valeurs nutritionnelles. Essaie la saisie manuelle.`;
      return;
    }
    $('#scan-status').textContent = '';
    openFood(food);
  } catch {
    $('#scan-status').textContent = "Open Food Facts ne répond pas. Vérifie ta connexion et réessaie.";
  }
}

// --- scanner ---
let scanStream = null, scanTimer = null;

async function startScan() {
  const status = $('#scan-status');
  try {
    const formats = await BarcodeDetector.getSupportedFormats();
    const wanted = ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter(f => formats.includes(f));
    const detector = new BarcodeDetector({ formats: wanted.length ? wanted : formats });
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = $('#scan-video');
    video.srcObject = scanStream;
    await video.play();
    $('#scan-box').hidden = false;
    $('#scan-btn').hidden = true;
    status.textContent = 'Place le code-barres dans le cadre.';
    const tick = async () => {
      if (!scanStream) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) {
          const code = codes[0].rawValue;
          stopScan();
          navigator.vibrate?.(60);
          handleBarcode(code);
          return;
        }
      } catch { /* image pas encore prête */ }
      scanTimer = setTimeout(tick, 200);
    };
    tick();
  } catch (e) {
    stopScan();
    status.textContent = e?.name === 'NotAllowedError'
      ? "Accès à la caméra refusé. Autorise-le dans les réglages du navigateur, ou tape le code."
      : "Impossible d'ouvrir la caméra. Tape le code à la place.";
  }
}

function stopScan() {
  clearTimeout(scanTimer);
  scanStream?.getTracks().forEach(t => t.stop());
  scanStream = null;
  const box = $('#scan-box');
  if (box) box.hidden = true;
  const btn = $('#scan-btn');
  if (btn && 'BarcodeDetector' in window) btn.hidden = false;
}

// --- feuille détail ---
function openFood(food, entry = null) {
  detail = { food, entryId: entry?.id ?? null };
  const f = $('#food-form');
  $('#food-title').textContent = food.name;
  $('#food-brand').textContent = [food.brand || food.grp, `${fmt(food.per100.kcal)} kcal / 100 g`].filter(Boolean).join(' · ');
  f.grams.value = entry?.grams ?? food.lastGrams ?? food.serving ?? 100;
  f.meal.value = entry?.meal ?? addMeal;
  const chips = [[100, '100 g']];
  if (food.serving && food.serving !== 100) chips.unshift([food.serving, `1 portion (${fmt(food.serving)} g)`]);
  for (const g of [30, 50, 150, 200, 250]) chips.push([g, `${g} g`]);
  $('#food-chips').innerHTML = chips.map(([g, l]) => `<button type="button" data-action="qty" data-g="${g}">${l}</button>`).join('');
  $('#food-delete').hidden = !entry;
  $('#food-submit').textContent = entry ? 'Enregistrer' : 'Ajouter';
  updateFoodMacros();
  $('#sheet-food').showModal();
}

function updateFoodMacros() {
  if (!detail) return;
  const g = num($('#food-form').grams.value) || 0;
  const n = nutr(detail.food.per100, g);
  $('#food-macros').innerHTML = `
    <div><b>${fmt(n.kcal)}</b>kcal</div>
    <div class="c"><b>${fmt(n.c, 1)}</b>glucides (g)</div>
    <div class="p"><b>${fmt(n.p, 1)}</b>protéines (g)</div>
    <div class="f"><b>${fmt(n.f, 1)}</b>lipides (g)</div>`;
}

function rememberRecent(food, grams) {
  const keyOf = x => x.code || `${x.name}|${x.brand}`.toLowerCase();
  const k = keyOf(food);
  const { lastGrams, ...clean } = food;
  state.recents = [{ ...clean, lastGrams: grams }, ...state.recents.filter(r => keyOf(r) !== k)].slice(0, 30);
}

function submitFood(e) {
  e.preventDefault();
  const f = e.target;
  const grams = num(f.grams.value);
  if (!grams || grams <= 0) return;
  const meal = f.meal.value;
  const d = dayWrite();
  const { food, entryId } = detail;
  if (entryId) {
    const entry = d.foods.find(x => x.id === entryId);
    if (entry) Object.assign(entry, { grams, meal });
    toast('Entrée modifiée');
  } else {
    const before = streak();
    d.foods.push({ id: uid(), meal, name: food.name, brand: food.brand || '', code: food.code || null, grams, per100: food.per100 });
    toast(`${food.name} ajouté à : ${mealLabel(meal)}`);
    celebrate(before);
  }
  rememberRecent(food, grams);
  save();
  $('#sheet-food').close();
  $('#sheet-add').close();
  renderJournal();
}

// ============================================================
//  Ajout rapide : des calories sans aliment
// ============================================================
let quickId = null;

function openQuick(meal, entry = null) {
  quickId = entry?.id ?? null;
  const f = $('#quick-form');
  f.reset();
  f.meal.value = entry?.meal ?? meal;
  if (entry) {
    f.name.value = entry.name === 'Ajout rapide' ? '' : entry.name;
    f.kcal.value = round(entry.per100.kcal, 1);
    for (const k of ['c', 'p', 'f']) f[k].value = entry.per100[k] ? round(entry.per100[k], 1) : '';
  }
  $('#quick-title').textContent = entry ? 'Modifier l\'ajout rapide' : 'Ajout rapide';
  $('#quick-submit').textContent = entry ? 'Enregistrer' : 'Ajouter';
  $('#quick-delete').hidden = !entry;
  $('#sheet-quick').showModal();
}

function submitQuick(e) {
  e.preventDefault();
  const f = e.target;
  const kcal = num(f.kcal.value);
  if (!kcal || kcal <= 0) return;
  // stocké comme un aliment de 100 g : les calculs du journal restent les mêmes
  const per100 = { kcal, c: num(f.c.value) ?? 0, p: num(f.p.value) ?? 0, f: num(f.f.value) ?? 0 };
  const name = f.name.value.trim() || 'Ajout rapide';
  const meal = f.meal.value;
  const d = dayWrite();
  const entry = quickId && d.foods.find(x => x.id === quickId);
  if (entry) {
    Object.assign(entry, { name, meal, per100 });
    toast('Entrée modifiée');
  } else {
    const before = streak();
    d.foods.push({ id: uid(), meal, name, brand: '', code: null, grams: 100, per100, quick: true });
    toast(`${fmt(kcal)} kcal ajoutées à : ${mealLabel(meal)}`);
    celebrate(before);
  }
  save();
  $('#sheet-quick').close();
  $('#sheet-add').close();
  renderJournal();
}

// ============================================================
//  Repas : copier, enregistrer, vider
// ============================================================
let mealCtx = { meal: 'breakfast', mode: 'from' };

const mealItems = (key, meal) => dayRead(key).foods.filter(e => e.meal === meal);
const itemsSummary = items => `${items.length} aliment${items.length > 1 ? 's' : ''} · ${fmt(totals(items).kcal)} kcal`;

function openMealMenu(meal) {
  mealCtx = { meal, mode: 'from' };
  const items = mealItems(current, meal);
  $('#meal-title').textContent = mealLabel(meal);
  $('#meal-sub').textContent = `${dateLabel(current)} · ${items.length ? itemsSummary(items) : 'vide'}`;
  $$('#sheet-meal [data-needs-items]').forEach(b => { b.disabled = !items.length; });
  showMealPane('menu');
  $('#sheet-meal').showModal();
}

function showMealPane(pane) {
  const f = $('#copy-form');
  if (pane === 'from' || pane === 'to') {
    mealCtx.mode = pane;
    f.date.value = addDays(current, pane === 'from' ? -1 : 1);
    f.meal.value = mealCtx.meal;
    $('#copy-date-label').textContent = pane === 'from' ? 'Copier depuis le' : 'Copier vers le';
    $('#copy-meal-label').textContent = pane === 'from' ? 'Repas source' : 'Dans le repas';
    updateCopyPreview();
    pane = 'copy';
  }
  if (pane === 'save') {
    const sf = $('#save-meal-form');
    sf.reset();
    $('#save-preview').textContent = itemsSummary(mealItems(current, mealCtx.meal));
  }
  $$('#sheet-meal .meal-pane').forEach(p => { p.hidden = p.dataset.pane !== pane; });
  if (pane === 'save') $('#save-meal-form').name.focus();
}

function updateCopyPreview() {
  const f = $('#copy-form');
  const date = f.date.value;
  let text = '', ok = !!date;
  if (date && mealCtx.mode === 'from') {
    const src = mealItems(date, f.meal.value);
    ok = src.length > 0;
    text = ok ? `${itemsSummary(src)} à ajouter à : ${mealLabel(mealCtx.meal)} (${dateLabel(current).toLowerCase()}).`
      : `Rien à copier : ${mealLabel(f.meal.value).toLowerCase()} vide ce jour-là.`;
  } else if (date) {
    text = `${itemsSummary(mealItems(current, mealCtx.meal))} à ajouter à : ${mealLabel(f.meal.value)} (${dateLabel(date).toLowerCase()}).`;
  }
  $('#copy-preview').textContent = text;
  $('#copy-submit').disabled = !ok;
}

function copyEntries(fromKey, fromMeal, toKey, toMeal) {
  const src = mealItems(fromKey, fromMeal);
  dayWrite(toKey).foods.push(...src.map(e => ({ ...e, id: uid(), meal: toMeal, per100: { ...e.per100 } })));
  return src.length;
}

function submitCopy(e) {
  e.preventDefault();
  const f = e.target;
  if (!f.date.value) return;
  const before = streak();
  const n = mealCtx.mode === 'from'
    ? copyEntries(f.date.value, f.meal.value, current, mealCtx.meal)
    : copyEntries(current, mealCtx.meal, f.date.value, f.meal.value);
  if (!n) return;
  save();
  $('#sheet-meal').close();
  toast(`${n} aliment${n > 1 ? 's' : ''} copié${n > 1 ? 's' : ''}`);
  celebrate(before);
  renderJournal();
}

function submitSaveMeal(e) {
  e.preventDefault();
  const name = e.target.name.value.trim();
  const items = mealItems(current, mealCtx.meal);
  if (!name || !items.length) return;
  state.savedMeals = [
    { id: uid(), name, items: items.map(({ id, meal, ...rest }) => ({ ...rest, per100: { ...rest.per100 } })) },
    ...state.savedMeals,
  ];
  save();
  $('#sheet-meal').close();
  toast(`Repas « ${name} » enregistré : retrouve-le dans Ajouter › Mes repas`);
}

function renderSaved() {
  const list = state.savedMeals;
  $('#saved-status').textContent = list.length
    ? 'Touche un repas pour ajouter tous ses aliments.'
    : "Aucun repas enregistré. Dans le journal, ouvre le menu ⋯ d'un repas puis « Enregistrer comme repas ».";
  $('#saved-results').innerHTML = list.map((m, i) => `<li><div class="entry">
    <button class="entry-main" data-action="pick-saved" data-idx="${i}">
      <span class="name">${esc(m.name)}<span class="sub">${itemsSummary(m.items)}</span></span>
    </button>
    <button class="icon-btn" data-action="del-saved" data-idx="${i}" aria-label="Supprimer ${esc(m.name)}">✕</button>
  </div></li>`).join('');
}

// ============================================================
//  Exercice
// ============================================================
function exerciseEstimate() {
  const f = $('#exercise-form');
  const ex = EXERCISES.find(x => x[0] === f.type.value);
  const custom = ex[0] === 'custom';
  $('#exercise-name-wrap').hidden = !custom;
  f.name.required = custom;
  if (custom) { $('#exercise-hint').textContent = ''; return; }
  const kg = latestWeight();
  const min = num(f.minutes.value) || 0;
  f.kcal.value = Math.round(ex[2] * kg * min / 60);
  $('#exercise-hint').textContent = `Estimation pour ${fmt(kg, 1)} kg (MET ${fmt(ex[2], 1)}). Tu peux corriger la valeur.`;
}

function openExercise() {
  const f = $('#exercise-form');
  f.reset();
  exerciseEstimate();
  $('#sheet-exercise').showModal();
}

function submitExercise(e) {
  e.preventDefault();
  const f = e.target;
  const ex = EXERCISES.find(x => x[0] === f.type.value);
  const name = ex[0] === 'custom' ? f.name.value.trim() : ex[1];
  dayWrite().exercises.push({ id: uid(), name, minutes: num(f.minutes.value), kcal: num(f.kcal.value) || 0 });
  save();
  $('#sheet-exercise').close();
  toast('Exercice ajouté');
  renderJournal();
}

// ============================================================
//  Actions
// ============================================================
const actions = {
  'prev-day': () => { current = addDays(current, -1); renderJournal(); },
  'next-day': () => { current = addDays(current, 1); renderJournal(); },
  'today': () => { current = ymd(new Date()); renderJournal(); },
  'tab': el => { $$('dialog[open]').forEach(d => d.close()); view = el.dataset.view; render(); window.scrollTo(0, 0); },
  'add-food': el => openAdd(el.dataset.meal),
  'add-tab': el => switchAddTab(el.dataset.tab),
  'pick-result': el => openFood(results[+el.dataset.idx]),
  'pick-recent': el => openFood(state.recents[+el.dataset.idx]),
  'scan-start': () => startScan(),
  'qty': el => { $('#food-form').grams.value = el.dataset.g; updateFoodMacros(); },
  'edit-entry': el => {
    const entry = dayRead().foods.find(x => x.id === el.dataset.id);
    if (entry?.quick) openQuick(entry.meal, entry);
    else if (entry) openFood({ name: entry.name, brand: entry.brand, code: entry.code, per100: entry.per100 }, entry);
  },
  'quick-open': () => openQuick(addMeal),
  'delete-quick': () => {
    const d = dayWrite();
    d.foods = d.foods.filter(x => x.id !== quickId);
    save();
    $('#sheet-quick').close();
    toast('Entrée supprimée');
    renderJournal();
  },
  'meal-menu': el => openMealMenu(el.dataset.meal),
  'meal-pane': el => showMealPane(el.dataset.pane),
  'meal-quick': () => { $('#sheet-meal').close(); openQuick(mealCtx.meal); },
  'meal-clear': () => {
    const label = mealLabel(mealCtx.meal);
    if (!confirm(`Supprimer tous les aliments de : ${label} (${dateLabel(current).toLowerCase()}) ?`)) return;
    const d = dayWrite();
    d.foods = d.foods.filter(x => x.meal !== mealCtx.meal);
    save();
    $('#sheet-meal').close();
    toast(`${label} vidé`);
    renderJournal();
  },
  'pick-saved': el => {
    const m = state.savedMeals[+el.dataset.idx];
    if (!m) return;
    const before = streak();
    dayWrite().foods.push(...m.items.map(x => ({ ...x, id: uid(), meal: addMeal, per100: { ...x.per100 } })));
    save();
    $('#sheet-add').close();
    toast(`${m.name} ajouté à : ${mealLabel(addMeal)}`);
    celebrate(before);
    renderJournal();
  },
  'del-saved': el => {
    const m = state.savedMeals[+el.dataset.idx];
    if (!m || !confirm(`Supprimer le repas enregistré « ${m.name} » ?`)) return;
    state.savedMeals = state.savedMeals.filter(x => x !== m);
    save();
    renderSaved();
  },
  'complete-day': () => {
    dayWrite().completed = true;
    save();
    renderJournal();
    showCompletion();
  },
  'complete-show': () => showCompletion(),
  'delete-entry': () => {
    const d = dayWrite();
    d.foods = d.foods.filter(x => x.id !== detail.entryId);
    save();
    $('#sheet-food').close();
    toast('Entrée supprimée');
    renderJournal();
  },
  'add-exercise': () => openExercise(),
  'del-exercise': el => {
    const d = dayWrite();
    d.exercises = d.exercises.filter(x => x.id !== el.dataset.id);
    save();
    renderJournal();
  },
  'water': el => {
    const d = dayWrite();
    d.water = Math.max(0, d.water + Number(el.dataset.ml));
    save();
    renderJournal();
  },
  'del-weight': el => {
    state.weights = state.weights.filter(w => w.date !== el.dataset.date);
    syncProfileWeight();
    save();
    renderProgress();
  },
  'close': el => el.closest('dialog').close(),
  'export': () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nutrijour-${ymd(new Date())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  'import': () => $('#import-file').click(),
  'reset': () => {
    if (!confirm('Effacer toutes les données (journal, poids, profil) ? Cette action est définitive.')) return;
    state = emptyState();
    save();
    view = 'profile';
    render();
  },
};

function syncProfileWeight() {
  if (state.profile && state.weights.length) state.profile.weight = latestWeight();
}

// ============================================================
//  Initialisation
// ============================================================
function init() {
  $('#activity-select').innerHTML = ACTIVITY.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  $('#goal-select').innerHTML = GOALS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  const mealOptions = MEALS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  for (const id of ['#food-meal', '#quick-meal', '#copy-meal']) $(id).innerHTML = mealOptions;
  $('#exercise-select').innerHTML = EXERCISES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (el && actions[el.dataset.action]) actions[el.dataset.action](el, e);
  });

  // fermer une feuille en cliquant sur le fond
  $$('dialog').forEach(d => d.addEventListener('click', e => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) d.close();
  }));
  $('#sheet-add').addEventListener('close', stopScan);

  // recherche locale : instantanée, donc lancée pendant la frappe
  let searchTimer;
  const runSearch = async () => {
    const q = $('#search-form').q.value.trim();
    if (q.length < 2) { showRecents(); return; }
    const status = $('#search-status');
    try {
      await loadCiqual();
    } catch {
      status.textContent = 'Impossible de charger la table des aliments. Recharge la page.';
      return;
    }
    results = searchLocal(q);
    status.textContent = results.length
      ? `${results.length === 40 ? '40 premiers' : results.length} résultat(s) pour « ${q} »`
      : `Aucun aliment générique pour « ${q} ». Pour un produit de marque, utilise le code-barres, sinon la saisie manuelle.`;
    $('#search-results').innerHTML = results.map((f, i) => resultItem(f, 'pick-result', i)).join('');
  };
  $('#search-form').addEventListener('submit', e => { e.preventDefault(); clearTimeout(searchTimer); runSearch(); });
  $('#search-form').q.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 150); });

  $('#barcode-form').addEventListener('submit', e => {
    e.preventDefault();
    const code = e.target.code.value.replace(/\D/g, '');
    if (code.length >= 6) handleBarcode(code);
  });

  $('#manual-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    openFood({
      name: f.name.value.trim(), brand: '', code: null,
      per100: { kcal: num(f.kcal.value) || 0, c: num(f.c.value) || 0, p: num(f.p.value) || 0, f: num(f.f.value) || 0 },
    });
    f.reset();
  });

  $('#food-form').addEventListener('submit', submitFood);
  $('#food-form').grams.addEventListener('input', updateFoodMacros);
  $('#sheet-food').addEventListener('close', () => { detail = null; });

  $('#quick-form').addEventListener('submit', submitQuick);
  $('#copy-form').addEventListener('submit', submitCopy);
  $('#copy-form').addEventListener('input', updateCopyPreview);
  $('#save-meal-form').addEventListener('submit', submitSaveMeal);

  $('#exercise-form').addEventListener('submit', submitExercise);
  $('#exercise-form').addEventListener('input', e => { if (e.target.name !== 'kcal' && e.target.name !== 'name') exerciseEstimate(); });

  $('#weight-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const kg = num(f.kg.value), date = f.date.value;
    if (!kg || !date) return;
    state.weights = [...state.weights.filter(w => w.date !== date), { date, kg }];
    syncProfileWeight();
    save();
    f.kg.value = '';
    toast('Pesée enregistrée');
    renderProgress();
  });

  const pf = $('#profile-form');
  pf.addEventListener('input', updateComputed);
  pf.addEventListener('submit', e => {
    e.preventDefault();
    const p = readProfileForm();
    if (p.carbsPct + p.proteinPct + p.fatPct !== 100) { toast('La répartition des macros doit faire 100 %.'); return; }
    const first = !state.profile;
    state.profile = p;
    const today = ymd(new Date());
    if (Math.abs(p.weight - (state.weights.length ? latestWeight() : 0)) > 0.01) {
      state.weights = [...state.weights.filter(w => w.date !== today), { date: today, kg: p.weight }];
    }
    save();
    toast(`Objectif : ${fmt(targets().kcal)} kcal par jour`);
    if (first) { view = 'journal'; render(); } else renderProfile();
  });

  $('#import-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (typeof data !== 'object' || !data || !('days' in data)) throw new Error('format');
      state = { ...emptyState(), ...data };
      save();
      toast('Données importées');
      render();
    } catch {
      toast("Ce fichier n'est pas une sauvegarde NutriJour valide.");
    }
  });

  if (!state.profile) view = 'profile';
  render();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
