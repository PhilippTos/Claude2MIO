/*
 * export.js – CSV- und JSON-Download der Befunde. Alles entsteht lokal im Browser (Blob).
 */
(function (global) {
  'use strict';

  const KATEGORIE = { fehlt: 'Fehlt', 'nur-mio': 'Nur im MIO', abweichend: 'Abweichend', ok: 'Übereinstimmend' };
  const SCHWERE = { kritisch: 'Kritisch', warnung: 'Warnung', info: 'Info' };

  function herunterladen(inhalt, dateiname, typ) {
    const blob = new Blob([inhalt], { type: typ });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = dateiname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvFeld(wert) {
    const s = wert === null || wert === undefined ? '' : String(wert);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function dateiBasis(projektId) {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `vergleich-${projektId}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  /** CSV mit Semikolon und BOM, damit Excel (deutsche Einstellungen) Umlaute und Spalten korrekt erkennt. */
  function alsCsv(befunde, projektId) {
    const kopf = ['Kategorie', 'Schwere', 'Ressource', 'Element', 'FHIR-Pfad', 'MIO-Bezeichnung', 'Ist', 'Soll', 'Erklärung', 'EU-Profil', 'IG-Link'];
    const zeilen = befunde.map(b => [
      KATEGORIE[b.kategorie], b.kategorie === 'ok' ? '' : SCHWERE[b.schwere], b.ressource, b.element, b.pfad,
      b.mioName, b.ist, b.soll, b.erklaerung, b.profil, b.igLink,
    ].map(csvFeld).join(';'));
    herunterladen('﻿' + [kopf.join(';'), ...zeilen].join('\r\n'), dateiBasis(projektId) + '.csv', 'text/csv;charset=utf-8');
  }

  function alsJson(ergebnis, meta, befunde, projektId) {
    const daten = {
      erstellt: new Date().toISOString(),
      werkzeug: 'MIO ↔ EU Spec Compare',
      hinweis: 'Ersetzt keine offizielle Validierung (z. B. HL7 FHIR Validator).',
      ...meta,
      score: ergebnis.score,
      zaehler: ergebnis.zaehler,
      ressourcen: ergebnis.ressourcen.map(r => ({ label: r.label, typ: r.typ, fullUrl: r.fullUrl, profil: r.profil, profilWahl: r.grund })),
      befunde,
    };
    herunterladen(JSON.stringify(daten, null, 2), dateiBasis(projektId) + '.json', 'application/json');
  }

  global.Export = { alsCsv, alsJson, KATEGORIE, SCHWERE };
})(window);
