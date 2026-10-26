/*
 * profilvergleich.js – Vergleich zweier MIO-Inhalte (Profil ↔ Profil oder logisches Modell ↔ Profil).
 * Keine DOM-Abhängigkeit. Nutzt CompareLogik.normalisiereProfil für StructureDefinitions.
 *
 * Kategorien je Zeile: 'nur-a' | 'nur-b' | 'unterschiedlich' | 'gleich'
 * Ausrichtung über FHIR-Pfad; Slices über die Extension-URL bzw. ein festes Codesystem,
 * ersatzweise über den Slice-Namen.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- Hilfen

  function letztesSegment(pfad) {
    return pfad.slice(pfad.lastIndexOf('.') + 1);
  }

  function normName(s) {
    return String(s || '').toLowerCase().replace(/^(kbv_vs_|kbv-vs-)/, '').replace(/[^a-z0-9]/g, '');
  }

  function maxText(max) {
    if (max === Infinity || max === '*') return '*';
    if (max === null || max === undefined || max === '' || Number.isNaN(max)) return '?';
    return String(max);
  }

  /** Teilt eine Element-ID in Segmente, ohne Punkte in Slice-Namen zu zerschneiden. */
  function segmente(id) {
    return id.split('.');
  }

  // ---------------------------------------------------------------- Profil → Vergleichselemente

  function sliceSchluessel(profil, slice) {
    const name = slice.sliceName;
    if (/(^|\.)(extension|modifierExtension)$/.test(slice.path)) {
      const url = slice.typen[0] && slice.typen[0].profile[0];
      if (url) return 'url=' + url;
    }
    const system = profil.byId.get(slice.id + '.system');
    const fest = system && (system.fixed || system.pattern);
    if (fest && typeof fest.wert === 'string') return 'system=' + fest.wert;
    const muster = slice.pattern || slice.fixed;
    if (muster && muster.wert && typeof muster.wert === 'object') {
      const coding = Array.isArray(muster.wert.coding) ? muster.wert.coding[0] : muster.wert;
      if (coding && coding.system) return 'system=' + coding.system + (coding.code ? '|' + coding.code : '');
    }
    return 'name=' + name;
  }

  /**
   * Erzeugt für jedes Element zwei Schlüssel:
   *  kanonisch – Slices über URL/System, nameSchluessel – Slices über Slice-Namen.
   */
  function schluesselFuerProfil(profil) {
    const kanon = new Map();
    const name = new Map();
    for (const el of profil.elemente) {
      const segs = segmente(el.id);
      const k = [];
      const n = [];
      let prefix = '';
      for (const seg of segs) {
        prefix = prefix ? prefix + '.' + seg : seg;
        const i = seg.indexOf(':');
        if (i < 0) { k.push(seg); n.push(seg); continue; }
        const basis = seg.slice(0, i);
        const slice = profil.byId.get(prefix);
        k.push(basis + ':' + (slice ? sliceSchluessel(profil, slice) : 'name=' + seg.slice(i + 1)));
        n.push(basis + ':name=' + seg.slice(i + 1).toLowerCase());
      }
      kanon.set(el.id, k.join('.'));
      name.set(el.id, n.join('.'));
    }
    return { kanon, name };
  }

  function bindingText(binding, titel) {
    if (!binding) return '';
    const url = binding.valueSet;
    const t = (titel && titel[url]) || url.split('/').pop();
    return `${t} (${binding.strength})`;
  }

  function wertText(fp) {
    if (!fp) return '';
    return typeof fp.wert === 'object' ? JSON.stringify(fp.wert) : String(fp.wert);
  }

  function istRelevant(el) {
    return el.min >= 1 || el.mustSupport || !!el.sliceName || !!el.fixed || !!el.pattern
      || (el.obligations && el.obligations.length > 0);
  }

  function istRauschen(el) {
    const seg = letztesSegment(el.path);
    if (seg === 'id') return true;
    if (seg === 'url' && /\.(extension|modifierExtension)\.url$/.test(el.path)) return true;
    return false;
  }

  /** Normalisiertes Profil → Liste von Vergleichselementen. */
  function seiteAusProfil(profil, valueSetTitel) {
    const { kanon, name } = schluesselFuerProfil(profil);
    const elemente = [];
    profil.elemente.forEach((el, i) => {
      if (i === 0 || istRauschen(el)) return;
      elemente.push({
        schluessel: kanon.get(el.id),
        nameSchluessel: name.get(el.id),
        elementId: el.id,
        pfad: el.path,
        name: el.sliceName ? `${letztesSegment(el.path)}:${el.sliceName}` : letztesSegment(el.path),
        min: el.min,
        max: maxText(el.max),
        typen: el.typen.map(t => t.code + (t.profile[0] ? '(' + t.profile[0].split('/').pop() + ')' : '')).sort().join(' | '),
        binding: el.binding && el.binding.strength !== 'example'
          ? { ...el.binding, text: bindingText(el.binding, valueSetTitel) } : null,
        fixed: wertText(el.fixed),
        pattern: wertText(el.pattern),
        // EU-Profile kennzeichnen über Obligations (z. B. SHALL:populate-if-known) statt mustSupport – gleichwertig behandeln
        mustSupport: el.mustSupport || (el.obligations || []).some(o => /populate/.test(o.code) && !/consumer/i.test(o.actor || '')),
        kurz: el.short,
        relevant: istRelevant(el),
        art: 'profil',
      });
    });
    return {
      art: 'profil',
      titel: profil.title,
      url: profil.url,
      version: profil.version,
      typ: profil.type,
      elemente,
      nichtZuordenbar: [],
    };
  }

  // ---------------------------------------------------------------- Logisches Modell → Vergleichselemente

  function elementeDerGruppe(modell, gruppe) {
    return modell.elemente.filter(e => e.bereich === 'Profile' && e.pfad.split(' / ').includes(gruppe));
  }

  /**
   * Inhaltsgruppen eines logischen Modells, die laut mapping.json einem FHIR-Ressourcentyp entsprechen
   * und mindestens ein Element enthalten – auch ohne FHIR-Mapping.
   */
  function modellGruppen(modell, mapping) {
    const gruppen = [];
    for (const z of (mapping && mapping.zuordnungen) || []) {
      if (!z.ressource || !z.mioGruppe) continue;
      const els = elementeDerGruppe(modell, z.mioGruppe);
      if (els.length <= 1) continue; // nur der Gruppenknoten selbst, keine Inhalte
      const profilName = z.mioProfil ? z.mioProfil.split(' ')[0] : null;
      const gemappt = profilName ? els.filter(e => (e.fhirMapping || []).some(m => m.split('.')[0] === profilName && m.includes('.'))).length : 0;
      gruppen.push({ gruppe: z.mioGruppe, typ: z.ressource, profilName, anzahl: els.length - 1, gemappt });
    }
    return gruppen;
  }

  /**
   * Übersetzt die Elemente einer MIO-Gruppe (z. B. „Diagnose“) aus model.json über die FHIR-Mappings.
   * Elemente ohne FHIR-Mapping landen mit ihrem EHDS-Bezug in „nichtZuordenbar“ – es wird nichts geraten.
   * @param modell   model.json
   * @param mapping  mapping.json (Zuordnung Gruppe → Ressourcentyp/MIO-Profil)
   * @param typ      FHIR-Ressourcentyp, z. B. 'Condition'
   * @param gruppe   optional: bestimmte Gruppe, wenn mehrere Gruppen auf denselben Typ zeigen
   */
  function seiteAusModell(modell, mapping, typ, gruppe) {
    const g = modellGruppen(modell, mapping).find(x => x.typ === typ && (!gruppe || x.gruppe === gruppe));
    if (!g) return null;
    const profilName = g.profilName;
    gruppe = g.gruppe;
    const inGruppe = elementeDerGruppe(modell, gruppe);
    const elemente = [];
    const nachSchluessel = new Map();
    const nichtZuordenbar = [];
    for (const e of inGruppe) {
      const pfade = profilName ? (e.fhirMapping || []).filter(m => m.split('.')[0] === profilName) : [];
      if (!pfade.length) {
        const teilPfad = e.pfad.split(' / ').slice(e.pfad.split(' / ').indexOf(gruppe) + 1).join(' / ');
        if (teilPfad && (e.art === 'item' || !(e.fhirMapping || []).length)) {
          nichtZuordenbar.push({
            name: e.name, pfad: teilPfad, min: e.min, max: maxText(e.max),
            ehds: (e.ehdsMapping || []).join(', '), valueSet: e.valueSet ? (e.valueSet.anzeigename || e.valueSet.name) : '',
          });
        }
        continue;
      }
      for (const m of pfade) {
        const teile = m.split('.').slice(1);
        if (!teile.length) continue; // Wurzel (Ressource selbst)
        const n = [typ];
        const pfad = [typ];
        for (const t of teile) {
          const i = t.indexOf(':');
          pfad.push(i < 0 ? t : t.slice(0, i));
          n.push(i < 0 ? t : t.slice(0, i) + ':name=' + t.slice(i + 1).toLowerCase());
        }
        const letzt = teile[teile.length - 1];
        const vorhanden = nachSchluessel.get(n.join('.'));
        if (vorhanden) {
          // Mehrere Konzepte auf denselben FHIR-Pfad: Namen zusammenführen, Angaben des Einzelelements bevorzugen
          vorhanden.mioName += ' / ' + e.name;
          vorhanden.kurz = vorhanden.mioName;
          if (e.art === 'item' && vorhanden.istGruppe) {
            Object.assign(vorhanden, { min: e.min, max: maxText(e.max), istGruppe: false });
          }
          if (!vorhanden.binding && e.valueSet) {
            vorhanden.binding = { valueSet: e.valueSet.name, strength: e.valueSet.staerke || '', text: `${e.valueSet.anzeigename || e.valueSet.name}${e.valueSet.staerke ? ' (' + e.valueSet.staerke + ')' : ''}` };
          }
          continue;
        }
        const neu = {
          schluessel: n.join('.'),
          nameSchluessel: n.join('.'),
          elementId: m.replace(profilName, typ),
          pfad: pfad.join('.'),
          name: letzt.includes(':') ? letzt.replace(/^[^:]*:/, letztesSegment(pfad.join('.')) + ':') : letzt,
          min: e.min,
          max: maxText(e.max),
          typen: e.datentyp ? e.datentyp + ' (logisch)' : '',
          binding: e.valueSet ? { valueSet: e.valueSet.name, strength: e.valueSet.staerke || '', text: `${e.valueSet.anzeigename || e.valueSet.name}${e.valueSet.staerke ? ' (' + e.valueSet.staerke + ')' : ''}` } : null,
          fixed: '',
          pattern: '',
          mustSupport: false,
          kurz: e.name,
          mioName: e.name,
          relevant: true,
          art: 'modell',
          istGruppe: e.art === 'group',
        };
        nachSchluessel.set(neu.schluessel, neu);
        elemente.push(neu);
      }
    }
    return {
      art: 'modell',
      gruppe,
      ohneMapping: elemente.length === 0,
      titel: `${gruppe} (${profilName || 'ohne FHIR-Profil'}, logisches Modell)`,
      url: null,
      version: '',
      typ,
      elemente,
      nichtZuordenbar,
    };
  }

  /** Ressourcentypen, für die ein logisches Modell Inhalte hat (mit oder ohne FHIR-Mapping). */
  function modellTypen(modell, mapping) {
    return [...new Set(modellGruppen(modell, mapping).map(g => g.typ))];
  }

  // ---------------------------------------------------------------- Vergleich

  function vergleicheZellen(a, b) {
    const u = [];
    const modell = a.art === 'modell' || b.art === 'modell';
    const card = x => `${x.min === null || x.min === undefined ? '?' : x.min}..${x.max}`;
    if (card(a) !== card(b)) u.push({ aspekt: 'kardinalitaet', label: 'Kardinalität', a: card(a), b: card(b) });
    if (!modell && a.typen !== b.typen) u.push({ aspekt: 'datentyp', label: 'Datentyp', a: a.typen, b: b.typen });
    // Bei Extensions steckt das Binding in der Extension-Definition – im Modellvergleich nicht vergleichbar
    const extOhneBinding = x => x.art === 'profil' && !x.binding && /Extension\(/.test(x.typen);
    const bindingVergleichbar = !(modell && (extOhneBinding(a) || extOhneBinding(b)));
    if (bindingVergleichbar && (a.binding || b.binding)) {
      const gleich = modell
        ? !!(a.binding && b.binding) && normName(a.binding.valueSet.split('/').pop()) === normName(b.binding.valueSet.split('/').pop())
          || !!(a.binding && b.binding) && normName(a.binding.text.replace(/\s*\(.*\)$/, '')) === normName(b.binding.text.replace(/\s*\(.*\)$/, ''))
        : !!(a.binding && b.binding) && a.binding.valueSet === b.binding.valueSet && a.binding.strength === b.binding.strength;
      if (!gleich) {
        u.push({
          aspekt: 'binding', label: modell ? 'ValueSet (Abgleich über Namen)' : 'ValueSet/Binding',
          a: a.binding ? a.binding.text : '—', b: b.binding ? b.binding.text : '—',
        });
      }
    }
    if (!modell) {
      if (a.fixed !== b.fixed) u.push({ aspekt: 'fixed', label: 'Fester Wert', a: a.fixed || '—', b: b.fixed || '—' });
      if (a.pattern !== b.pattern) u.push({ aspekt: 'pattern', label: 'Muster', a: a.pattern || '—', b: b.pattern || '—' });
      if (a.mustSupport !== b.mustSupport) u.push({ aspekt: 'mustsupport', label: 'Must Support / Obligation', a: a.mustSupport ? 'ja' : 'nein', b: b.mustSupport ? 'ja' : 'nein' });
    }
    return u;
  }

  function vorfahrVorhanden(pfad, pfade) {
    let p = pfad;
    while (p.includes('.')) {
      p = p.slice(0, p.lastIndexOf('.'));
      if (pfade.has(p)) return true;
    }
    return false;
  }

  /**
   * Vergleicht zwei Seiten (aus seiteAusProfil / seiteAusModell).
   * @returns {{ zeilen, score, zaehler, nichtZuordenbar: {a, b} }}
   */
  function vergleicheSeiten(A, B, namen) {
    namen = namen || { a: 'A', b: 'B' };
    const bNachSchluessel = new Map(B.elemente.map(e => [e.schluessel, e]));
    const bNachName = new Map(B.elemente.map(e => [e.nameSchluessel, e]));
    const paare = new Map(); // A-Element → B-Element
    const bBenutzt = new Set();
    for (const a of A.elemente) {
      const b = bNachSchluessel.get(a.schluessel);
      if (b && !bBenutzt.has(b)) { paare.set(a, b); bBenutzt.add(b); }
    }
    for (const a of A.elemente) {
      if (paare.has(a)) continue;
      const b = bNachName.get(a.nameSchluessel) || bNachSchluessel.get(a.nameSchluessel);
      if (b && !bBenutzt.has(b)) { paare.set(a, b); bBenutzt.add(b); }
    }

    // Reihenfolge: A-Reihenfolge, B-only-Elemente hinter ihrem Vorgänger aus B
    const reihe = A.elemente.map(a => ({ a, b: paare.get(a) || null }));
    let anker = -1;
    const einfuegen = [];
    for (const b of B.elemente) {
      if (bBenutzt.has(b)) { anker = reihe.indexOf(reihe.find(z => z.b === b)); continue; }
      einfuegen.push({ nach: anker, z: { a: null, b } });
    }
    // von hinten einfügen, damit Indizes stabil bleiben; gleiche Anker behalten ihre Reihenfolge
    const gruppiert = new Map();
    for (const e of einfuegen) {
      if (!gruppiert.has(e.nach)) gruppiert.set(e.nach, []);
      gruppiert.get(e.nach).push(e.z);
    }
    const ergebnisReihe = [];
    if (gruppiert.has(-1)) ergebnisReihe.push(...gruppiert.get(-1));
    reihe.forEach((z, i) => {
      ergebnisReihe.push(z);
      if (gruppiert.has(i)) ergebnisReihe.push(...gruppiert.get(i));
    });

    const pfadeA = new Set(A.elemente.map(e => e.pfad));
    const pfadeB = new Set(B.elemente.map(e => e.pfad));
    const nurModell = A.art === 'modell' || B.art === 'modell';

    const zeilen = [];
    for (const { a, b } of ergebnisReihe) {
      const basis = a || b;
      let kategorie;
      let unterschiede = [];
      let erklaerung;
      let gezaehlt = true;
      if (a && b) {
        unterschiede = vergleicheZellen(a, b);
        kategorie = unterschiede.length ? 'unterschiedlich' : 'gleich';
        if (kategorie === 'gleich' && !a.relevant && !b.relevant) gezaehlt = false;
        erklaerung = unterschiede.length
          ? `„${basis.name}“ ist in beiden enthalten, unterscheidet sich aber bei: ${unterschiede.map(u => u.label).join(', ')}.`
          : `„${basis.name}“ ist in ${namen.a} und ${namen.b} gleich festgelegt.`;
      } else {
        const seite = a ? 'a' : 'b';
        const el = a || b;
        const andere = a ? B : A;
        if (!el.relevant && !nurModell) continue; // unveränderte Basiselemente nur einer Seite ausblenden
        if (!el.relevant && nurModell && el.art === 'profil') continue;
        kategorie = 'nur-' + seite;
        const basisDa = vorfahrVorhanden(el.pfad, a ? pfadeB : pfadeA) || el.pfad.split('.').length <= 2;
        const istSlice = /:/.test(el.elementId);
        if (andere.art === 'modell') {
          erklaerung = `„${el.name}“ ist in ${namen[seite]} festgelegt; das logische Modell von ${namen[seite === 'a' ? 'b' : 'a']} enthält dafür kein FHIR-Mapping.`;
        } else if (istSlice) {
          erklaerung = `„${el.name}“ (z. B. eine Extension oder ein Slice) gibt es nur in ${namen[seite]}.`;
        } else if (basisDa) {
          erklaerung = `„${el.name}“ ist nur in ${namen[seite]} genauer festgelegt; in ${namen[seite === 'a' ? 'b' : 'a']} gilt die allgemeine FHIR-Definition.`;
        } else {
          erklaerung = `„${el.name}“ gibt es nur in ${namen[seite]}.`;
        }
      }
      zeilen.push({
        schluessel: basis.schluessel,
        pfad: basis.pfad,
        elementId: basis.elementId,
        tiefe: Math.max(0, basis.pfad.split('.').length - 2),
        name: basis.name,
        mioName: (a && a.mioName) || (b && b.mioName) || null,
        a, b, kategorie, unterschiede, erklaerung, gezaehlt,
      });
    }

    // Score: Übereinstimmung der gemeinsamen (relevanten) Elemente; Abdeckung getrennt
    const zaehler = { 'nur-a': 0, 'nur-b': 0, unterschiedlich: 0, gleich: 0 };
    let gemeinsam = 0;
    let gleich = 0;
    let gesamt = 0;
    for (const z of zeilen) {
      zaehler[z.kategorie] += 1;
      if (!z.gezaehlt) continue;
      gesamt += 1;
      if (z.a && z.b) {
        gemeinsam += 1;
        if (z.kategorie === 'gleich') gleich += 1;
      }
    }
    return {
      zeilen,
      zaehler,
      score: gemeinsam ? Math.round((100 * gleich) / gemeinsam) : null,
      gemeinsam,
      gesamt,
      nichtZuordenbar: { a: A.nichtZuordenbar, b: B.nichtZuordenbar },
    };
  }

  global.ProfilVergleich = { seiteAusProfil, seiteAusModell, modellGruppen, modellTypen, vergleicheSeiten, normName };
})(typeof window !== 'undefined' ? window : globalThis);
