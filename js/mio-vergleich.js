/*
 * mio-vergleich.js – Oberfläche „MIO ↔ MIO“: zwei MIO-Inhalte (Profil oder logisches Modell)
 * auswählen und Element für Element nebeneinander vergleichen.
 * Teilbarer Link: #vergleich/<mioA>/<mioB>/<Ressourcentyp>[/<profilA>/<profilB>]
 */
(function (global) {
  'use strict';

  const KAT = { 'nur-a': 'Nur in A', 'nur-b': 'Nur in B', unterschiedlich: 'Unterschiedlich', gleich: 'Gleich' };
  const KAT_REIHE = ['unterschiedlich', 'nur-a', 'nur-b', 'gleich'];
  const TYP_NAMEN = {
    Condition: 'Diagnose', AllergyIntolerance: 'Allergie/Unverträglichkeit', Procedure: 'Prozedur', Device: 'Gerät',
    DeviceUseStatement: 'Gerätenutzung', Immunization: 'Impfung', Patient: 'Patient:in', Practitioner: 'Behandelnde Person',
    PractitionerRole: 'Rolle der behandelnden Person', Organization: 'Organisation', Observation: 'Beobachtung/Messwert',
    Medication: 'Arzneimittel', MedicationStatement: 'Medikationseintrag', MedicationKnowledge: 'Arzneimittelinformation',
    Encounter: 'Kontakt/Fall', ServiceRequest: 'Auftrag/Überweisung', Composition: 'Dokument', Bundle: 'Bündel',
    Consent: 'Einwilligung/Erklärung', Flag: 'Warnhinweis', BodyStructure: 'Körperstruktur', RelatedPerson: 'Kontaktperson',
  };

  const $ = sel => document.querySelector(sel);
  const st = {
    mios: [],
    vsNamen: {},
    geladen: new Map(), // id → { mio, index?, modell?, mapping?, vsTitel }
    a: null,
    b: null,
    ergebnis: null,
    filter: new Set(['unterschiedlich', 'nur-a', 'nur-b']),
    suche: '',
    initialisiert: false,
  };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const typLabel = t => (TYP_NAMEN[t] ? `${TYP_NAMEN[t]} (${t})` : t);
  const ordner = p => p.slice(0, p.lastIndexOf('/') + 1);
  const mioName = id => (st.mios.find(m => m.id === id) || {}).name || id;

  function fehler(text) {
    const f = $('#mv-fehler');
    if (!text) { f.hidden = true; return; }
    f.innerHTML = `${icon('kritisch')}<p><strong>Das hat nicht geklappt.</strong> ${esc(text)}</p>`;
    f.hidden = false;
  }

  // ------------------------------------------------------------ Daten

  async function ladeMio(id) {
    if (st.geladen.has(id)) return st.geladen.get(id);
    const mio = st.mios.find(m => m.id === id);
    if (!mio) throw new Error(`MIO „${id}“ ist nicht im Katalog (config/mios.json).`);
    const d = { mio, vsTitel: { ...st.vsNamen } };
    if (mio.art === 'modell') {
      [d.modell, d.mapping] = await Promise.all([Specs.ladeJson(mio.modell), Specs.ladeJson(mio.mapping)]);
      d.gruppen = ProfilVergleich.modellGruppen(d.modell, d.mapping);
      d.typen = ProfilVergleich.modellTypen(d.modell, d.mapping);
    } else {
      d.index = await Specs.ladeJson(mio.profilIndex);
      if (mio.valueSetTitel) Object.assign(d.vsTitel, await Specs.ladeJson(mio.valueSetTitel).catch(() => ({})));
      d.typen = [...new Set(d.index.profile.map(p => p.type))];
    }
    st.geladen.set(id, d);
    return d;
  }

  async function seite(d, typ, profilId) {
    if (d.mio.art === 'modell') {
      const s = ProfilVergleich.seiteAusModell(d.modell, d.mapping, typ, profilId || undefined);
      return { seite: s, sdId: null, wahl: s && s.gruppe };
    }
    const eintrag = d.index.profile.find(p => p.id === profilId && p.type === typ) || d.index.profile.find(p => p.type === typ);
    // Dateien im EU-Index sind relativ zum Projektordner angegeben („eu/…“), wie in specs.js
    const sd = await Specs.ladeJson(ordner(d.mio.profilIndex) + eintrag.datei.replace(/^eu\//, ''));
    const profil = CompareLogik.normalisiereProfil(sd, d.mio.igUrl);
    return { seite: ProfilVergleich.seiteAusProfil(profil, d.vsTitel), sdId: sd.id, wahl: sd.id };
  }

  // ------------------------------------------------------------ Auswahl

  function renderKarten() {
    for (const s of ['a', 'b']) {
      $('#mv-karten-' + s).innerHTML = st.mios.map(m => `
        <label class="mv-karte">
          <input type="radio" name="mv-${s}" value="${esc(m.id)}"${st[s] === m.id ? ' checked' : ''}>
          <span>
            <span class="mv-karte-name">${esc(m.name)}</span>
            <span class="mv-karte-info">${m.version && !/^</.test(m.version) ? 'Version ' + esc(m.version) + ' · ' : ''}Stand ${esc(m.stand || '–')}${m.herkunft && m.herkunft.repo ? ' · ' + esc(m.herkunft.repo) : ''}</span>
            <span class="mv-karte-art">${m.art === 'modell' ? 'Logisches Modell (ART-DECOR)' : m.kategorie === 'eu' ? 'EU-Spezifikation · FHIR-Profile' : 'FHIR-Profile'}</span>
            <span class="mv-karte-gesperrt">bereits als ${s === 'a' ? 'B' : 'A'} gewählt</span>
          </span>
        </label>`).join('');
      $('#mv-karten-' + s).querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => {
        st[s] = inp.value;
        sperreGegenseite();
        aktualisiereInhalt();
      }));
    }
    sperreGegenseite();
  }

  /** Ein MIO, das auf einer Seite gewählt ist, kann auf der anderen nicht gewählt werden. */
  function sperreGegenseite() {
    for (const s of ['a', 'b']) {
      const andere = st[s === 'a' ? 'b' : 'a'];
      $('#mv-karten-' + s).querySelectorAll('input').forEach(inp => {
        const gesperrt = inp.value === andere;
        inp.disabled = gesperrt;
        inp.closest('.mv-karte').classList.toggle('gesperrt', gesperrt);
      });
    }
  }

  async function aktualisiereInhalt(vorgabe) {
    fehler('');
    const typSel = $('#mv-typ');
    const start = $('#mv-start');
    if (!st.a || !st.b) {
      typSel.disabled = true;
      start.disabled = true;
      return;
    }
    if (st.a === st.b) {
      typSel.disabled = true;
      start.disabled = true;
      typSel.innerHTML = '<option>Bitte zwei verschiedene MIOs wählen</option>';
      return;
    }
    try {
      const [da, db] = await Promise.all([ladeMio(st.a), ladeMio(st.b)]);
      const gemeinsam = da.typen.filter(t => db.typen.includes(t)).sort((x, y) => typLabel(x).localeCompare(typLabel(y), 'de'));
      if (!gemeinsam.length) {
        typSel.innerHTML = '<option>Keine gemeinsamen Inhalte</option>';
        typSel.disabled = true;
        start.disabled = true;
        return;
      }
      const vorher = (vorgabe && vorgabe.typ) || typSel.value;
      // Hinweis, wenn ein logisches Modell für diesen Typ noch keine FHIR-Mappings hat
      const ohneMapping = t => [da, db].some(d => d.gruppen && !d.gruppen.some(g => g.typ === t && g.gemappt > 0));
      typSel.innerHTML = gemeinsam.map(t =>
        `<option value="${esc(t)}">${esc(typLabel(t))}${ohneMapping(t) ? ' – nur Strukturübersicht (ohne FHIR-Mapping)' : ''}</option>`).join('');
      typSel.value = gemeinsam.includes(vorher) ? vorher : (gemeinsam.includes('Condition') ? 'Condition' : gemeinsam[0]);
      typSel.disabled = false;
      start.disabled = false;
      aktualisiereProfile(vorgabe);
    } catch (e) {
      fehler(e.message);
    }
  }

  function aktualisiereProfile(vorgabe) {
    const typ = $('#mv-typ').value;
    for (const s of ['a', 'b']) {
      const d = st.geladen.get(st[s]);
      const feld = $(`#mv-profil-${s}-feld`);
      const sel = $(`#mv-profil-${s}`);
      const label = feld.querySelector('.feld-label');
      if (!d) { feld.hidden = true; sel.innerHTML = ''; continue; }
      let optionen;
      if (d.mio.art === 'modell') {
        label.textContent = `Gruppe in ${s.toUpperCase()}`;
        optionen = d.gruppen.filter(g => g.typ === typ).map(g => ({
          wert: g.gruppe, text: `${g.gruppe} (${g.gemappt} von ${g.anzahl} Elementen mit FHIR-Mapping)`,
        }));
      } else {
        label.textContent = `Profil in ${s.toUpperCase()}`;
        optionen = d.index.profile.filter(p => p.type === typ).map(p => ({ wert: p.id, text: p.title || p.name }));
      }
      sel.innerHTML = optionen.map(o => `<option value="${esc(o.wert)}">${esc(o.text)}</option>`).join('');
      const wunsch = vorgabe && vorgabe['profil' + s.toUpperCase()];
      if (wunsch && optionen.some(o => o.wert === wunsch)) sel.value = wunsch;
      feld.hidden = optionen.length < 2;
    }
  }

  // ------------------------------------------------------------ Vergleich

  async function vergleiche(aktualisiereHash = true) {
    fehler('');
    const typ = $('#mv-typ').value;
    const btn = $('#mv-start');
    btn.disabled = true;
    try {
      const [da, db] = await Promise.all([ladeMio(st.a), ladeMio(st.b)]);
      const [sa, sb] = await Promise.all([seite(da, typ, $('#mv-profil-a').value), seite(db, typ, $('#mv-profil-b').value)]);
      if (!sa.seite || !sb.seite) throw new Error('Für diesen Inhalt fehlen Daten auf einer Seite.');
      const namen = { a: da.mio.name, b: db.mio.name };
      const r = ProfilVergleich.vergleicheSeiten(sa.seite, sb.seite, namen);
      st.ergebnis = { ...r, typ, A: sa.seite, B: sb.seite, sdA: sa.sdId, sdB: sb.sdId, namen, igA: da.mio.igUrl, igB: db.mio.igUrl };
      if (aktualisiereHash) {
        const teile = ['vergleich', st.a, st.b, typ];
        if (sa.wahl || sb.wahl) teile.push(sa.wahl || '-', sb.wahl || '-');
        history.replaceState(null, '', '#' + teile.map(encodeURIComponent).join('/'));
      }
      renderErgebnis();
      $('#mv-ergebnis').hidden = false;
      $('#mv-titel').focus && $('#mv-ergebnis').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      const s = $('#status');
      s.textContent = `Vergleich fertig: ${r.zaehler.unterschiedlich} unterschiedlich, ${r.zaehler['nur-a']} nur in A, ${r.zaehler['nur-b']} nur in B.`;
    } catch (e) {
      console.error(e);
      fehler(e.message);
    } finally {
      btn.disabled = false;
    }
  }

  function scoreHtml(r) {
    const wert = r.score === null ? 0 : r.score;
    const umfang = 2 * Math.PI * 48;
    const [von, bis] = r.score === null ? ['#999', '#999'] : r.score >= 80 ? ['#10b981', '#22c55e'] : r.score >= 50 ? ['#f59e0b', '#eab308'] : ['#ef4444', '#f97316'];
    return `
      <div class="ring" role="img" aria-label="Übereinstimmung ${r.score === null ? 'nicht berechenbar' : r.score + ' Prozent'}">
        <svg viewBox="0 0 112 112" aria-hidden="true">
          <defs><linearGradient id="mv-ring-verlauf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${von}"/><stop offset="1" stop-color="${bis}"/></linearGradient></defs>
          <circle class="ring-bg" cx="56" cy="56" r="48" fill="none" stroke-width="11"/>
          <circle class="ring-fg" cx="56" cy="56" r="48" fill="none" stroke-width="11" style="stroke:url(#mv-ring-verlauf)"
            stroke-dasharray="${umfang.toFixed(1)}" stroke-dashoffset="${umfang.toFixed(1)}" data-ziel="${(umfang * (1 - wert / 100)).toFixed(1)}"/>
        </svg>
        <span class="ring-wert" aria-hidden="true">${r.score === null ? '–' : `${r.score}<small>%</small>`}</span>
      </div>
      <div class="score-text"><strong>Übereinstimmung</strong>
        <span>${r.gemeinsam} von ${r.gesamt} relevanten Elementen gibt es in beiden; davon sind ${r.score === null ? '–' : r.score + ' %'} gleich festgelegt.</span></div>`;
  }

  function renderErgebnis() {
    const r = st.ergebnis;
    $('#mv-titel').textContent = `${typLabel(r.typ)}: ${r.namen.a} ↔ ${r.namen.b}`;
    $('#mv-meta').innerHTML = `<span class="seiten-marke" data-seite="a">A</span> ${esc(r.A.titel)} &nbsp; <span class="seiten-marke" data-seite="b">B</span> ${esc(r.B.titel)}`;
    $('#mv-score').innerHTML = scoreHtml(r);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const fg = $('#mv-score .ring-fg');
      if (fg) fg.style.strokeDashoffset = fg.dataset.ziel;
    }));
    const sub = {
      unterschiedlich: 'in beiden, aber anders festgelegt',
      'nur-a': `nur in ${r.namen.a}`,
      'nur-b': `nur in ${r.namen.b}`,
      gleich: 'in beiden gleich festgelegt',
    };
    $('#mv-kennzahlen').innerHTML = KAT_REIHE.map(k => `
      <div class="kennzahl glass" data-kat="${k}">
        <span class="kennzahl-kopf">${icon(k === 'unterschiedlich' ? 'abweichend' : k === 'gleich' ? 'ok' : k)} ${KAT[k]}</span>
        <span class="kennzahl-zahl">${r.zaehler[k]}</span>
        <span class="kennzahl-sub">${esc(sub[k])}</span>
      </div>`).join('');
    $('#mv-chips').innerHTML = KAT_REIHE.map(k => `
      <button type="button" class="chip" data-kat="${k}" aria-pressed="${st.filter.has(k)}">
        ${icon(k === 'unterschiedlich' ? 'abweichend' : k === 'gleich' ? 'ok' : k)}<span class="chip-text">${KAT[k]}</span><span class="anzahl">${r.zaehler[k]}</span>
      </button>`).join('');
    $('#mv-chips').querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
      const k = c.dataset.kat;
      if (st.filter.has(k)) st.filter.delete(k); else st.filter.add(k);
      c.setAttribute('aria-pressed', String(st.filter.has(k)));
      renderTabelle();
    }));
    renderTabelle();

    // Logisches Modell ohne FHIR-Mapping: deutlicher Hinweis, Strukturübersicht aufklappen
    const ohne = [['A', r.A], ['B', r.B]].filter(([, s]) => s.art === 'modell' && s.ohneMapping);
    const hinweis = $('#mv-hinweis');
    hinweis.hidden = !ohne.length;
    if (ohne.length) {
      hinweis.innerHTML = `${icon('info')}<p><strong>Nur Strukturübersicht:</strong> ${ohne.map(([seite, s]) =>
        `Für „${esc(s.gruppe)}“ (Seite ${seite}) enthält das logische Modell noch keine FHIR-Mappings.`).join(' ')}
        Die Elemente lassen sich deshalb nicht Zeile für Zeile zuordnen. Sie stehen unten mit Kardinalität, EHDS-Bezug und ValueSet.
        Sobald im ART-DECOR-Modell FHIR-Mappings ergänzt sind, erscheint hier automatisch der vollständige Vergleich.</p>`;
    }

    const nz = $('#mv-nicht-zuordenbar');
    const liste = [...r.nichtZuordenbar.a.map(e => ({ ...e, seite: 'A' })), ...r.nichtZuordenbar.b.map(e => ({ ...e, seite: 'B' }))];
    nz.hidden = !liste.length;
    nz.open = ohne.length > 0;
    if (liste.length) {
      nz.querySelector('summary').textContent = `${liste.length} Elemente des logischen Modells ohne FHIR-Mapping (nicht zuordenbar)`;
      nz.querySelector('ul').innerHTML = liste.map(e => `
        <li><strong>${esc(e.pfad)}</strong> <span class="mv-leer">(${esc(e.min === null || e.min === undefined ? '?' : e.min)}..${esc(e.max)})</span>
          ${e.ehds ? `<span class="mv-wert">EHDS: ${esc(e.ehds)}</span>` : ''}
          ${e.valueSet ? `<span class="mv-wert">ValueSet: ${esc(e.valueSet)}</span>` : ''}</li>`).join('');
    }
  }

  function igLink(ig, sdId, elementId) {
    if (!ig || !sdId) return '';
    const basis = ig.endsWith('/') ? ig : ig + '/';
    return `${basis}StructureDefinition-${sdId}-definitions.html#${encodeURIComponent(elementId)}`;
  }

  function zelle(e, z, seite) {
    if (!e) return `<span class="nb-einzug" style="--tiefe:${z.tiefe}"><span class="nb-name">${esc(z.name)}</span><span class="mv-leer">— nicht vorhanden —</span></span>`;
    const anders = new Set(z.unterschiede.map(u => u.aspekt));
    const wert = (aspekt, label, text) => {
      if (!text && text !== 0) return '';
      const inhalt = anders.has(aspekt) ? `<mark>${esc(text)}</mark>` : esc(text);
      return `<span class="mv-wert">${label}: <b>${inhalt}</b></span>`;
    };
    const r = st.ergebnis;
    const link = seite === 'a' ? igLink(r.igA, r.sdA, e.elementId) : igLink(r.igB, r.sdB, e.elementId);
    return `<span class="nb-einzug" style="--tiefe:${z.tiefe}">
      <span class="nb-name">${esc(e.name)}${e.mioName ? ` <small>(${esc(e.mioName)})</small>` : ''}</span>
      ${wert('kardinalitaet', 'Kardinalität', `${e.min === null || e.min === undefined ? '?' : e.min}..${e.max}`)}
      ${wert('datentyp', 'Typ', e.typen)}
      ${wert('binding', 'ValueSet', e.binding ? e.binding.text : '')}
      ${wert('fixed', 'Fester Wert', e.fixed)}
      ${wert('pattern', 'Muster', e.pattern)}
      ${e.mustSupport || anders.has('mustsupport') ? wert('mustsupport', 'Must Support / Obligation', e.mustSupport ? 'ja' : 'nein') : ''}
      ${link ? `<a class="mv-wert" href="${esc(link)}" target="_blank" rel="noopener">Im IG ansehen<span class="sr-only"> (öffnet neues Fenster)</span></a>` : ''}
    </span>`;
  }

  function gefiltert() {
    const q = st.suche.trim().toLowerCase();
    return st.ergebnis.zeilen.filter(z => st.filter.has(z.kategorie)
      && (!q || [z.pfad, z.name, z.mioName, z.erklaerung, z.a && z.a.kurz, z.b && z.b.kurz].some(v => v && String(v).toLowerCase().includes(q))));
  }

  function renderTabelle() {
    const r = st.ergebnis;
    const zeilen = gefiltert();
    $('#mv-treffer').textContent = `${zeilen.length} von ${r.zeilen.length} Elementen angezeigt`;
    const kopf = `
      <div class="nb-zeile nb-kopf" role="row">
        <span class="nb-zelle" role="columnheader">Status</span>
        <span class="nb-zelle" role="columnheader">A: ${esc(r.namen.a)}</span>
        <span class="nb-zelle" role="columnheader">B: ${esc(r.namen.b)}</span>
      </div>`;
    if (!zeilen.length) {
      $('#mv-tabelle').innerHTML = kopf + '<p class="leer">Keine Elemente für diese Filter.</p>';
      return;
    }
    $('#mv-tabelle').innerHTML = kopf + zeilen.map(z => `
      <div class="nb-zeile" role="row" data-kat="${z.kategorie}">
        <span class="nb-zelle nb-status" role="cell" data-label="Status">
          <span>${icon(z.kategorie === 'unterschiedlich' ? 'abweichend' : z.kategorie === 'gleich' ? 'ok' : z.kategorie)} ${KAT[z.kategorie]}
          <span class="mv-erkl">${esc(z.erklaerung)}</span></span>
        </span>
        <span class="nb-zelle nb-ist" role="cell" data-label="A: ${esc(r.namen.a)}">${zelle(z.a, z, 'a')}</span>
        <span class="nb-zelle nb-soll" role="cell" data-label="B: ${esc(r.namen.b)}">${zelle(z.b, z, 'b')}</span>
      </div>`).join('');
  }

  // ------------------------------------------------------------ Export

  function zellText(e) {
    if (!e) return ['', '', '', ''];
    return [`${e.min === null || e.min === undefined ? '?' : e.min}..${e.max}`, e.typen || '', e.binding ? e.binding.text : '', [e.fixed, e.pattern].filter(Boolean).join(' ')];
  }

  function exportiereCsv() {
    const r = st.ergebnis;
    const kopf = ['Kategorie', 'Element', 'FHIR-Pfad', 'MIO-Bezeichnung',
      'A Kardinalität', 'A Typ', 'A ValueSet', 'A Wert/Muster', 'B Kardinalität', 'B Typ', 'B ValueSet', 'B Wert/Muster', 'Unterschiede', 'Erklärung'];
    const zeilen = gefiltert().map(z => [KAT[z.kategorie], z.name, z.pfad, z.mioName || '', ...zellText(z.a), ...zellText(z.b),
      z.unterschiede.map(u => `${u.label}: ${u.a} ↔ ${u.b}`).join(' | '), z.erklaerung]);
    Export.tabelleAlsCsv(kopf, zeilen, `mio-vergleich-${st.a}-${st.b}-${r.typ}`);
  }

  function exportiereJson() {
    const r = st.ergebnis;
    Export.objektAlsJson({
      erstellt: new Date().toISOString(),
      werkzeug: 'MIO ↔ EU Spec Compare – MIO ↔ MIO',
      a: { mio: st.a, name: r.namen.a, inhalt: r.A.titel }, b: { mio: st.b, name: r.namen.b, inhalt: r.B.titel },
      ressourcentyp: r.typ, uebereinstimmung: r.score, gemeinsam: r.gemeinsam, relevant: r.gesamt, zaehler: r.zaehler,
      zeilen: gefiltert().map(z => ({ kategorie: z.kategorie, element: z.name, pfad: z.pfad, mioName: z.mioName, a: z.a, b: z.b, unterschiede: z.unterschiede, erklaerung: z.erklaerung })),
      nichtZuordenbar: r.nichtZuordenbar,
    }, `mio-vergleich-${st.a}-${st.b}-${r.typ}`);
  }

  // ------------------------------------------------------------ Start / Routing

  async function init() {
    if (st.initialisiert) return;
    st.initialisiert = true;
    try {
      const [katalog, namen] = await Promise.all([Specs.ladeJson('config/mios.json'), Specs.ladeJson('config/valueset-namen.json').catch(() => ({}))]);
      st.mios = katalog.mios || [];
      st.vsNamen = namen.valueSets || {};
    } catch (e) {
      fehler('Der MIO-Katalog konnte nicht geladen werden (' + e.message + ').');
      return;
    }
    renderKarten();
    $('#mv-typ').addEventListener('change', () => aktualisiereProfile());
    $('#mv-start').addEventListener('click', () => vergleiche());
    $('#mv-suche').addEventListener('input', e => { st.suche = e.target.value; renderTabelle(); });
    $('#mv-csv').addEventListener('click', exportiereCsv);
    $('#mv-json').addEventListener('click', exportiereJson);
    $('#mv-drucken').addEventListener('click', () => window.print());
    $('#mv-link').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        $('#status').textContent = 'Link kopiert';
        const t = document.createElement('div');
        t.className = 'toast sichtbar';
        t.textContent = 'Link kopiert: öffnet genau diesen Vergleich';
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2200);
      } catch (e) {
        window.prompt('Link zum Kopieren:', location.href);
      }
    });
  }

  /** Wird von app.js beim Wechsel auf #vergleich… aufgerufen. */
  async function oeffne(teile, fokus) {
    await init();
    const [a, b, typ, profilA, profilB] = teile.map(t => decodeURIComponent(t));
    if (a && b && st.mios.some(m => m.id === a) && st.mios.some(m => m.id === b)) {
      const gleicherVergleich = st.ergebnis && st.a === a && st.b === b && st.ergebnis.typ === typ;
      st.a = a;
      st.b = b;
      renderKarten();
      await aktualisiereInhalt({ typ, profilA, profilB });
      if (typ && !gleicherVergleich && !$('#mv-typ').disabled) await vergleiche(false);
    } else if (a || b) {
      fehler('Der Link verweist auf ein unbekanntes MIO.');
    }
    if (fokus) $('#h-mio').focus({ preventScroll: true });
  }

  global.MioVergleichUI = { oeffne, mioName };
})(window);
