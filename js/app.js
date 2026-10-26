/*
 * app.js – Oberfläche: Stepper, Projektwahl, Upload, Dashboard, Nebeneinander-Ansicht.
 * Die Vergleichslogik steckt in compare.js, das Laden der Daten in specs.js.
 */
(function () {
  'use strict';

  const KAT = Export.KATEGORIE;
  const SCHWERE = Export.SCHWERE;
  const KAT_REIHENFOLGE = ['fehlt', 'abweichend', 'nur-mio', 'ok'];
  const SCHWERE_REIHENFOLGE = ['kritisch', 'warnung', 'info'];
  const MAX_DATEI = 20 * 1024 * 1024;

  const $ = sel => document.querySelector(sel);
  const state = {
    projekte: [],
    projekt: null,
    daten: null,
    ergebnis: null,
    dateiname: '',
    schritt: 1,
    filter: { kat: new Set(['fehlt', 'abweichend', 'nur-mio']), schwere: '', ressource: '', suche: '' },
  };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const icon = (name, extra) => `<svg aria-hidden="true"${extra ? ' ' + extra : ''}><use href="#i-${name}"/></svg>`;

  function melde(text) {
    const s = $('#status');
    s.textContent = '';
    setTimeout(() => { s.textContent = text; }, 30);
  }

  let toastTimer;
  function toast(text) {
    let t = $('.toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'toast';
      t.setAttribute('aria-hidden', 'true');
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.classList.add('sichtbar');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('sichtbar'), 2200);
    melde(text);
  }

  // ------------------------------------------------------------ Farbschema

  const THEMEN = ['auto', 'light', 'dark'];
  const THEMA_TEXT = { auto: 'Auto', light: 'Hell', dark: 'Dunkel' };
  const THEMA_ICON = { auto: 'auto', light: 'sun', dark: 'moon' };

  function setzeThema(thema) {
    if (thema === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', thema);
    const btn = $('#theme-toggle');
    btn.innerHTML = `${icon(THEMA_ICON[thema])}<span class="theme-label">${THEMA_TEXT[thema]}</span>`;
    btn.setAttribute('aria-label', `Farbschema: ${THEMA_TEXT[thema]} (umschalten)`);
    btn.dataset.thema = thema;
  }

  function initThema() {
    let gespeichert = 'auto';
    try { gespeichert = localStorage.getItem('thema') || 'auto'; } catch (e) { /* Speicher nicht verfügbar */ }
    setzeThema(THEMEN.includes(gespeichert) ? gespeichert : 'auto');
    $('#theme-toggle').addEventListener('click', () => {
      const naechstes = THEMEN[(THEMEN.indexOf($('#theme-toggle').dataset.thema) + 1) % THEMEN.length];
      setzeThema(naechstes);
      try { localStorage.setItem('thema', naechstes); } catch (e) { /* ignorieren */ }
    });
  }

  // ------------------------------------------------------------ Stepper

  function zeigeSchritt(n, fokus = true) {
    state.schritt = n;
    for (let i = 1; i <= 3; i++) $('#schritt-' + i).hidden = i !== n;
    document.querySelectorAll('.step').forEach(btn => {
      const s = Number(btn.dataset.step);
      const verfuegbar = s === 1 || (s === 2 && state.projekt) || (s === 3 && state.ergebnis);
      btn.disabled = !verfuegbar;
      btn.classList.toggle('erledigt', s < n);
      if (s === n) btn.setAttribute('aria-current', 'step');
      else btn.removeAttribute('aria-current');
    });
    if (fokus) {
      const h = $('#h-schritt-' + n);
      if (h) h.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }

  // ------------------------------------------------------------ Schritt 1: Projekte

  function renderProjekte() {
    const liste = $('#projekt-liste');
    liste.removeAttribute('aria-busy');
    if (!state.projekte.length) {
      liste.innerHTML = '<p class="leer">Es sind noch keine Projekte konfiguriert (config/projects.json).</p>';
      return;
    }
    liste.innerHTML = state.projekte.map(p => `
      <button type="button" class="projekt-karte glass" data-projekt="${esc(p.id)}">
        <h2>${esc(p.anzeigename)}</h2>
        ${p.beschreibung ? `<p>${esc(p.beschreibung)}</p>` : ''}
        <div class="spec-paar">
          <span class="spec"><span class="spec-art">MIO</span><span class="spec-name">${esc(p.mio.name)}</span>
            <span class="spec-version">${esc(p.mio.stand || p.mio.version || '')}</span></span>
          <span class="spec-pfeil" aria-hidden="true">${icon('arrows')}</span>
          <span class="spec"><span class="spec-art">EU-Spezifikation</span><span class="spec-name">${esc(p.eu.name)}</span>
            <span class="spec-version">Stand ${esc(p.eu.version || '')}</span></span>
        </div>
        <span class="karte-fuss"><span>Projekt öffnen →</span><span class="anker">#${esc(p.id)}</span></span>
      </button>`).join('');
    liste.querySelectorAll('[data-projekt]').forEach(b =>
      b.addEventListener('click', () => { location.hash = b.dataset.projekt; }));
  }

  // ------------------------------------------------------------ Schritt 2: Upload

  async function waehleProjekt(id) {
    const p = state.projekte.find(x => x.id === id);
    if (!p) {
      zeigeSchritt(1);
      if (id) toast(`Projekt „${id}“ wurde nicht gefunden.`);
      return;
    }
    if (state.projekt && state.projekt.id === id && state.daten) {
      zeigeSchritt(state.ergebnis ? 3 : 2);
      return;
    }
    state.projekt = p;
    state.daten = null;
    state.ergebnis = null;
    versteckeFehler();
    $('#eigene-profile').innerHTML = '';
    $('#projekt-info').innerHTML = `
      <div><strong>${esc(p.anzeigename)}</strong>
        <p>EU: ${esc(p.eu.name)} · Stand ${esc(p.eu.version)}${p.eu.igUrl ? ` · <a href="${esc(p.eu.igUrl)}" target="_blank" rel="noopener">IG öffnen ${icon('external')}</a>` : ''}</p></div>
      <button type="button" class="btn btn-ghost" id="projekt-wechseln">${icon('back')} Anderes Projekt</button>`;
    $('#projekt-wechseln').addEventListener('click', () => { history.pushState(null, '', location.pathname + location.search); zeigeSchritt(1); });
    $('#beispiel-buttons').innerHTML = (p.beispiele || []).map((b, i) =>
      `<button type="button" class="btn btn-secondary" data-beispiel="${i}">${icon('file')} ${esc(b.titel)} laden</button>`).join('')
      || '<span class="beispiele-label">Für dieses Projekt sind keine Beispieldateien hinterlegt.</span>';
    $('#beispiel-buttons').querySelectorAll('[data-beispiel]').forEach(btn =>
      btn.addEventListener('click', () => ladeBeispiel(p.beispiele[Number(btn.dataset.beispiel)])));
    zeigeSchritt(2);
    try {
      state.daten = await Specs.ladeProjekt(p);
      melde(`Projekt ${p.anzeigename} geladen.`);
    } catch (e) {
      zeigeFehler('Die Spezifikationen dieses Projekts konnten nicht geladen werden. ' + e.message);
    }
  }

  function zeigeFehler(text) {
    const f = $('#fehler');
    f.innerHTML = `${icon('kritisch')}<p><strong>Das hat nicht geklappt.</strong> ${esc(text)}</p>`;
    f.hidden = false;
  }
  function versteckeFehler() { $('#fehler').hidden = true; }

  async function verarbeite(text, name) {
    versteckeFehler();
    const dz = $('#dropzone');
    dz.classList.add('laedt');
    melde('Datei wird verglichen …');
    try {
      if (!state.daten) state.daten = await Specs.ladeProjekt(state.projekt);
      const ergebnis = await Specs.analysiere(text, state.daten);
      state.ergebnis = ergebnis;
      state.dateiname = name;
      state.filter.ressource = '';
      state.filter.suche = '';
      $('#suche').value = '';
      renderErgebnis();
      zeigeSchritt(3);
      melde(`Vergleich fertig: Konformität ${ergebnis.score === null ? 'nicht berechenbar' : ergebnis.score + ' Prozent'}, ` +
        `${ergebnis.zaehler.fehlt} fehlend, ${ergebnis.zaehler.abweichend} abweichend, ${ergebnis.zaehler['nur-mio']} nur im MIO.`);
    } catch (e) {
      console.error(e);
      zeigeFehler(e instanceof FhirXml.FhirFehler ? e.message : 'Unerwarteter Fehler beim Vergleich: ' + e.message);
      melde('Fehler: ' + e.message);
    } finally {
      dz.classList.remove('laedt');
    }
  }

  function leseDatei(datei) {
    if (!datei) return;
    if (datei.size > MAX_DATEI) {
      zeigeFehler(`Die Datei ist zu groß (${(datei.size / 1048576).toFixed(1)} MB). Maximal 20 MB.`);
      return;
    }
    const r = new FileReader();
    r.onload = () => verarbeite(String(r.result), datei.name);
    r.onerror = () => zeigeFehler('Die Datei konnte nicht gelesen werden.');
    r.readAsText(datei);
  }

  async function ladeBeispiel(b) {
    try {
      const res = await fetch(b.datei, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await verarbeite(await res.text(), b.datei.split('/').pop());
    } catch (e) {
      zeigeFehler('Die Beispieldatei konnte nicht geladen werden (' + e.message + ').');
    }
  }

  function initUpload() {
    const dz = $('#dropzone');
    const input = $('#datei-input');
    input.addEventListener('change', () => { leseDatei(input.files[0]); input.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('aktiv'); }));
    ['dragleave', 'dragend'].forEach(ev => dz.addEventListener(ev, e => {
      if (!dz.contains(e.relatedTarget)) dz.classList.remove('aktiv');
    }));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('aktiv');
      leseDatei(e.dataTransfer.files[0]);
    });
    // Versehentliches Öffnen der Datei im Tab verhindern
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => e.preventDefault());

    $('#profil-input').addEventListener('change', async e => {
      versteckeFehler();
      const liste = $('#eigene-profile');
      for (const datei of e.target.files) {
        try {
          const titel = Specs.fuegeEigeneProfileHinzu(state.daten, await datei.text());
          titel.forEach(t => { const li = document.createElement('li'); li.textContent = `${t} (${datei.name})`; liste.appendChild(li); });
          toast(`${titel.length} Profil(e) übernommen`);
        } catch (err) {
          zeigeFehler(`${datei.name}: ${err.message}`);
        }
      }
      e.target.value = '';
    });
  }

  // ------------------------------------------------------------ Schritt 3: Ergebnis

  function scoreRing(score) {
    const r = 48;
    const umfang = 2 * Math.PI * r;
    const wert = score === null ? 0 : score;
    const stufe = score === null ? '–' : score >= 90 ? 'hoch' : score >= 70 ? 'mittel' : 'niedrig';
    const [von, bis] = score === null ? ['#999', '#999'] : score >= 90 ? ['#10b981', '#22c55e'] : score >= 70 ? ['#f59e0b', '#eab308'] : ['#ef4444', '#f97316'];
    return `
      <div class="ring" role="img" aria-label="Konformität ${score === null ? 'nicht berechenbar' : score + ' Prozent'}">
        <svg viewBox="0 0 112 112" aria-hidden="true">
          <defs><linearGradient id="ring-verlauf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${von}"/><stop offset="1" stop-color="${bis}"/></linearGradient></defs>
          <circle class="ring-bg" cx="56" cy="56" r="${r}" fill="none" stroke-width="11"/>
          <circle class="ring-fg" cx="56" cy="56" r="${r}" fill="none" stroke-width="11"
            stroke-dasharray="${umfang.toFixed(1)}" stroke-dashoffset="${umfang.toFixed(1)}" data-ziel="${(umfang * (1 - wert / 100)).toFixed(1)}"/>
        </svg>
        <span class="ring-wert" aria-hidden="true">${score === null ? '–' : `${score}<small>%</small>`}</span>
      </div>
      <div class="score-text"><strong>Konformität ${stufe}</strong>
        <span>Anteil übereinstimmender Elemente; kritische Befunde zählen doppelt. „Nur im MIO“ senkt den Wert nicht.</span></div>`;
  }

  function kennzahlen(z) {
    const sub = {
      fehlt: 'in der EU gefordert, im MIO nicht vorhanden',
      abweichend: 'Kardinalität, Datentyp, Muster oder Codesystem',
      'nur-mio': 'in der EU nicht vorgesehen',
      ok: 'entsprechen der EU-Spezifikation',
    };
    return KAT_REIHENFOLGE.map(k => `
      <div class="kennzahl glass" data-kat="${k}">
        <span class="kennzahl-kopf">${icon(k)} ${KAT[k]}</span>
        <span class="kennzahl-zahl">${z[k]}</span>
        <span class="kennzahl-sub">${sub[k]}</span>
      </div>`).join('');
  }

  function renderChips() {
    const z = state.ergebnis.zaehler;
    $('#chips').innerHTML = KAT_REIHENFOLGE.map(k => `
      <button type="button" class="chip" data-kat="${k}" aria-pressed="${state.filter.kat.has(k)}">
        ${icon(k)}<span class="chip-text">${KAT[k]}</span><span class="anzahl">${z[k]}</span>
      </button>`).join('');
    $('#chips').querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
      const k = c.dataset.kat;
      if (state.filter.kat.has(k)) state.filter.kat.delete(k); else state.filter.kat.add(k);
      c.setAttribute('aria-pressed', String(state.filter.kat.has(k)));
      renderBefunde();
    }));
  }

  function renderErgebnis() {
    const e = state.ergebnis;
    const p = state.projekt;
    $('#ergebnis-meta').textContent =
      `${state.dateiname} · ${e.anzahlRessourcen} Ressource${e.anzahlRessourcen === 1 ? '' : 'n'} · verglichen mit ${p.eu.name} (Stand ${p.eu.version})`;
    $('#score').innerHTML = scoreRing(e.score);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const fg = $('#score .ring-fg');
      if (fg) fg.style.strokeDashoffset = fg.dataset.ziel;
    }));
    $('#kennzahlen').innerHTML = kennzahlen(e.zaehler);
    renderChips();

    const optionen = e.ressourcen.map((r, i) => `<option value="${i}">${esc(r.label)}</option>`).join('');
    $('#filter-ressource').innerHTML = '<option value="">Alle</option>' + optionen;
    $('#filter-ressource').value = '';
    $('#nb-ressource').innerHTML = optionen;
    const ersteMitProfil = e.ressourcen.findIndex(r => r.profil && r.typ !== 'Bundle');
    $('#nb-ressource').value = String(ersteMitProfil >= 0 ? ersteMitProfil : 0);
    renderBefunde();
    renderNebeneinander();
  }

  function gefilterteBefunde() {
    const f = state.filter;
    const q = f.suche.trim().toLowerCase();
    const res = f.ressource === '' ? null : state.ergebnis.ressourcen[Number(f.ressource)];
    return state.ergebnis.befunde.filter(b =>
      f.kat.has(b.kategorie)
      && (!f.schwere || (b.kategorie !== 'ok' && b.schwere === f.schwere))
      && (!res || res.befunde.includes(b))
      && (!q || [b.pfad, b.element, b.mioName, b.erklaerung, b.ist, b.soll, b.ressource]
        .some(v => v && String(v).toLowerCase().includes(q))));
  }

  function rang(b) {
    return KAT_REIHENFOLGE.indexOf(b.kategorie) * 10 + SCHWERE_REIHENFOLGE.indexOf(b.schwere);
  }

  function befundHtml(b) {
    const istSoll = (b.ist !== null && b.ist !== '' ? `<div><dt>Ist:</dt><dd>${esc(b.ist)}</dd></div>` : '')
      + (b.soll ? `<div><dt>Soll:</dt><dd>${esc(b.soll)}</dd></div>` : '');
    return `
      <li class="befund" data-kat="${b.kategorie}" data-schwere="${b.schwere}">
        <span class="befund-icon">${icon(b.kategorie)}</span>
        <div class="befund-kopf">
          <span class="badge" data-kat="${b.kategorie}">${KAT[b.kategorie]}</span>
          ${b.kategorie !== 'ok' ? `<span class="badge schwere" data-schwere="${b.schwere}">${icon(b.schwere)} ${SCHWERE[b.schwere]}</span>` : ''}
          <span class="befund-element">${esc(b.element)}</span>
          ${b.mioName ? `<span class="befund-mio">MIO: ${esc(b.mioName)}</span>` : ''}
        </div>
        <span class="befund-pfad">${esc(b.pfad)}</span>
        <p class="befund-text">${esc(b.erklaerung)}</p>
        ${istSoll ? `<dl class="ist-soll">${istSoll}</dl>` : ''}
        ${b.igLink ? `<a class="ig-link" href="${esc(b.igLink)}" target="_blank" rel="noopener">Im IG ansehen ${icon('external')}<span class="sr-only"> (öffnet neues Fenster)</span></a>` : ''}
      </li>`;
  }

  function renderBefunde() {
    const liste = gefilterteBefunde();
    const alle = state.ergebnis.befunde.length;
    $('#treffer-info').textContent = `${liste.length} von ${alle} Befunden angezeigt`;
    const ziel = $('#befund-liste');
    if (!liste.length) {
      ziel.innerHTML = '<p class="leer glass">Keine Befunde für diese Filter. Aktivieren Sie weitere Kategorien oder leeren Sie die Suche.</p>';
      return;
    }
    const menge = new Set(liste);
    ziel.innerHTML = state.ergebnis.ressourcen.map((r, idx) => {
      const eigene = r.befunde.filter(b => menge.has(b)).sort((a, b) => rang(a) - rang(b));
      if (!eigene.length) return '';
      const zaehler = KAT_REIHENFOLGE.map(k => {
        const n = eigene.filter(b => b.kategorie === k).length;
        return n ? `<span class="mini" data-kat="${k}">${icon(k)} ${n} ${KAT[k]}</span>` : '';
      }).join('');
      const offen = eigene.some(b => b.kategorie !== 'ok') ? ' open' : '';
      return `
        <details class="ressource-karte glass"${offen} style="animation-delay:${Math.min(idx, 10) * 40}ms">
          <summary>
            <span class="rk-titel">${esc(r.label)}</span>
            <span class="rk-profil">${r.profilTitel ? `EU-Profil: ${esc(r.profilTitel)} <span class="sr-only">(Wahl über ${esc(r.grund)})</span>` : 'kein EU-Profil'}</span>
            <span class="rk-zaehler">${zaehler}</span>
          </summary>
          <ul class="befunde">${eigene.map(befundHtml).join('')}</ul>
        </details>`;
    }).join('');
  }

  // ------------------------------------------------------------ Nebeneinander

  function zeilenKategorie(z) {
    for (const k of KAT_REIHENFOLGE) if (z.befunde.some(b => b.kategorie === k)) return k;
    return 'ok';
  }

  function renderNebeneinander() {
    const r = state.ergebnis.ressourcen[Number($('#nb-ressource').value) || 0];
    const nurUnterschiede = $('#nb-nur-unterschiede').checked;
    $('#nb-profil').textContent = r && r.profilTitel ? `EU-Profil: ${r.profilTitel} (Wahl über ${r.grund})` : 'Für diese Ressource gibt es kein EU-Profil.';
    const kopf = `
      <div class="nb-zeile nb-kopf" role="row">
        <span class="nb-zelle" role="columnheader">Status</span>
        <span class="nb-zelle" role="columnheader">MIO-Datei (Ist)</span>
        <span class="nb-zelle" role="columnheader">EU-Profil (Soll)</span>
      </div>`;
    const zeilen = (r ? r.zeilen : [])
      .map(z => ({ z, k: zeilenKategorie(z) }))
      .filter(({ k }) => !nurUnterschiede || k !== 'ok');
    if (!zeilen.length) {
      $('#nb-tabelle').innerHTML = kopf + '<p class="leer">Keine Zeilen für diese Auswahl.</p>';
      return;
    }
    $('#nb-tabelle').innerHTML = kopf + zeilen.map(({ z, k }) => {
      const tiefe = `style="--tiefe:${z.tiefe}"`;
      const ist = k === 'fehlt'
        ? `<span class="nb-einzug" ${tiefe}><span class="nb-name">${esc(z.name)}</span><span class="nb-wert">— fehlt —</span></span>`
        : `<span class="nb-einzug" ${tiefe}><span class="nb-name">${esc(z.name)}${z.mioName ? ` <small>(${esc(z.mioName)})</small>` : ''}</span><span class="nb-wert">${esc(z.ist)}</span></span>`;
      const soll = z.elementId === null || (k === 'nur-mio' && z.befunde.every(b => b.kategorie === 'nur-mio'))
        ? `<span class="nb-einzug" ${tiefe}><span class="nb-name">${esc(z.name)}</span><span class="nb-wert">— nicht vorgesehen —</span></span>`
        : `<span class="nb-einzug" ${tiefe}><span class="nb-name">${esc(z.name)}</span><span class="nb-wert">${esc(z.soll)}</span></span>`;
      const titel = z.befunde.filter(b => b.kategorie !== 'ok').map(b => b.erklaerung).join(' ');
      return `
        <div class="nb-zeile" role="row" data-kat="${k}"${titel ? ` title="${esc(titel)}"` : ''}>
          <span class="nb-zelle nb-status" role="cell" data-label="Status">${icon(k)} ${KAT[k]}</span>
          <span class="nb-zelle nb-ist" role="cell" data-label="MIO-Datei (Ist)">${ist}</span>
          <span class="nb-zelle nb-soll" role="cell" data-label="EU-Profil (Soll)">${soll}</span>
        </div>`;
    }).join('');
  }

  // ------------------------------------------------------------ Werkzeuge & Tabs

  function initErgebnisWerkzeuge() {
    $('#suche').addEventListener('input', e => { state.filter.suche = e.target.value; renderBefunde(); });
    $('#filter-schwere').addEventListener('change', e => { state.filter.schwere = e.target.value; renderBefunde(); });
    $('#filter-ressource').addEventListener('change', e => { state.filter.ressource = e.target.value; renderBefunde(); });
    $('#nb-ressource').addEventListener('change', renderNebeneinander);
    $('#nb-nur-unterschiede').addEventListener('change', renderNebeneinander);

    const meta = () => ({
      projekt: state.projekt.id,
      projektName: state.projekt.anzeigename,
      euSpezifikation: `${state.projekt.eu.name} (Stand ${state.projekt.eu.version})`,
      datei: state.dateiname,
      filter: { kategorien: [...state.filter.kat], schwere: state.filter.schwere || 'alle', suche: state.filter.suche },
    });
    $('#export-csv').addEventListener('click', () => { Export.alsCsv(gefilterteBefunde(), state.projekt.id); toast('CSV wird heruntergeladen'); });
    $('#export-json').addEventListener('click', () => { Export.alsJson(state.ergebnis, meta(), gefilterteBefunde(), state.projekt.id); toast('JSON wird heruntergeladen'); });
    $('#drucken').addEventListener('click', () => window.print());
    window.addEventListener('beforeprint', () => document.querySelectorAll('.ressource-karte').forEach(d => { d.dataset.warOffen = d.open; d.open = true; }));
    window.addEventListener('afterprint', () => document.querySelectorAll('.ressource-karte').forEach(d => { d.open = d.dataset.warOffen === 'true'; }));

    $('#link-kopieren').addEventListener('click', async () => {
      const link = location.origin + location.pathname + '#' + state.projekt.id;
      try {
        await navigator.clipboard.writeText(link);
        toast('Link kopiert: öffnet direkt dieses Projekt');
      } catch (e) {
        window.prompt('Link zum Kopieren:', link);
      }
    });
    $('#neue-datei').addEventListener('click', () => { versteckeFehler(); zeigeSchritt(2); });

    const tabs = [$('#tab-dashboard'), $('#tab-nebeneinander')];
    function aktiviere(tab) {
      tabs.forEach(t => {
        const an = t === tab;
        t.setAttribute('aria-selected', String(an));
        t.tabIndex = an ? 0 : -1;
        $('#' + t.getAttribute('aria-controls')).hidden = !an;
      });
      tab.focus();
    }
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => aktiviere(t));
      t.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          aktiviere(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]);
        }
      });
    });

    document.querySelectorAll('.step').forEach(btn => btn.addEventListener('click', () => {
      const s = Number(btn.dataset.step);
      if (btn.disabled) return;
      if (s === 1) { history.pushState(null, '', location.pathname + location.search); zeigeSchritt(1); }
      else zeigeSchritt(s);
    }));
  }

  // ------------------------------------------------------------ Routing & Start

  function setzeModus(modus) {
    const vorher = document.body.dataset.modus;
    document.body.dataset.modus = modus;
    $('#modus-datei').toggleAttribute('aria-current', modus === 'datei');
    $('#modus-mio').toggleAttribute('aria-current', modus === 'mio');
    if (modus === 'datei') $('#modus-datei').setAttribute('aria-current', 'page');
    else $('#modus-mio').setAttribute('aria-current', 'page');
    $('#mio-vergleich').hidden = modus !== 'mio';
    return vorher !== modus;
  }

  function route() {
    const hash = location.hash.replace(/^#/, '');
    const teile = hash.split('/');
    if (teile[0] === 'vergleich') {
      const gewechselt = setzeModus('mio');
      MioVergleichUI.oeffne(teile.slice(1), gewechselt);
      return;
    }
    setzeModus('datei');
    const id = decodeURIComponent(hash);
    if (id) waehleProjekt(id);
    else zeigeSchritt(1, false);
  }

  async function start() {
    initThema();
    initUpload();
    initErgebnisWerkzeuge();
    zeigeSchritt(1, false);
    try {
      state.projekte = await Specs.ladeProjekte();
    } catch (e) {
      $('#projekt-liste').innerHTML = `<p class="leer">Die Projektliste konnte nicht geladen werden (${esc(e.message)}).
        Hinweis: Die Seite muss über einen Webserver geöffnet werden, nicht direkt als Datei.</p>`;
      return;
    }
    renderProjekte();
    window.addEventListener('hashchange', route);
    route();
  }

  start();
})();
