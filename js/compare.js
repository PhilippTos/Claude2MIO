/*
 * compare.js – Vergleichslogik MIO-Instanz ↔ EU-Profil (Snapshot). Keine DOM-Abhängigkeit.
 *
 * Kategorien:  'fehlt' | 'nur-mio' | 'abweichend' | 'ok'
 * Schweregrade: 'kritisch' | 'warnung' | 'info'
 *
 * Grenzen (bewusst): keine FHIRPath-Invarianten, keine Terminologieserver-Abfrage,
 * Slicing nur mit einfachen Diskriminatoren (value/pattern auf url/Code, type auf $this/resource).
 */
(function (global) {
  'use strict';

  const PRIMITIVE = new Set(['boolean', 'integer', 'integer64', 'string', 'decimal', 'uri', 'url', 'canonical',
    'base64Binary', 'instant', 'date', 'dateTime', 'time', 'code', 'oid', 'id', 'markdown', 'unsignedInt',
    'positiveInt', 'uuid', 'xhtml']);

  const SYSTEM_NAMEN = {
    'http://snomed.info/sct': 'SNOMED CT',
    'http://loinc.org': 'LOINC',
    'http://fhir.de/CodeSystem/bfarm/icd-10-gm': 'ICD-10-GM',
    'http://fhir.de/CodeSystem/bfarm/ops': 'OPS',
    'http://fhir.de/CodeSystem/bfarm/atc': 'ATC (BfArM)',
    'http://www.whocc.no/atc': 'ATC (WHO)',
    'http://hl7.org/fhir/sid/icd-10': 'ICD-10 (WHO)',
    'http://unitsofmeasure.org': 'UCUM',
  };

  const GEWICHT = { kritisch: 2, warnung: 1, info: 0.5 };

  // ---------------------------------------------------------------- Profile normalisieren

  function ohneVersion(url) {
    return url ? String(url).split('|')[0] : url;
  }

  function typCode(code) {
    if (!code) return code;
    // FHIRPath-Systemtypen (z. B. bei Element.id) → FHIR-Primitive
    if (code.startsWith('http://hl7.org/fhirpath/System.')) {
      const t = code.split('.').pop();
      return t.charAt(0).toLowerCase() + t.slice(1);
    }
    return code;
  }

  function letztesSegment(id) {
    return id.slice(id.lastIndexOf('.') + 1);
  }

  function elternId(id) {
    return id.slice(0, id.lastIndexOf('.'));
  }

  function ersterWertMitPraefix(e, praefix) {
    for (const k of Object.keys(e)) {
      if (k.startsWith(praefix) && k.length > praefix.length) {
        return { typ: k.slice(praefix.length), wert: e[k] };
      }
    }
    return null;
  }

  function leseObligations(e) {
    return (e.extension || [])
      .filter(x => x && typeof x.url === 'string' && x.url.endsWith('/obligation'))
      .map(x => {
        const sub = x.extension || [];
        const code = (sub.find(s => s.url === 'code') || {}).valueCode || '';
        const actor = (sub.find(s => s.url === 'actor') || {}).valueCanonical || '';
        return { code, actor };
      })
      .filter(o => o.code);
  }

  /**
   * Bringt eine StructureDefinition (Snapshot) in eine für den Vergleich praktische Form.
   */
  function normalisiereProfil(sd, igUrl) {
    if (!sd || !sd.snapshot || !Array.isArray(sd.snapshot.element) || !sd.snapshot.element.length) {
      throw new Error('Profil ohne Snapshot: ' + (sd && (sd.url || sd.id)));
    }
    const elemente = sd.snapshot.element.map(e => ({
      id: e.id || e.path,
      path: e.path,
      sliceName: e.sliceName || null,
      min: e.min == null ? 0 : Number(e.min),
      max: e.max == null || e.max === '*' ? Infinity : Number(e.max),
      maxText: e.max == null ? '*' : String(e.max),
      typen: (e.type || []).map(t => ({
        code: typCode(t.code),
        profile: (t.profile || []).map(ohneVersion),
      })),
      binding: e.binding && e.binding.valueSet
        ? { strength: e.binding.strength, valueSet: ohneVersion(e.binding.valueSet) } : null,
      mustSupport: !!e.mustSupport,
      isModifier: !!e.isModifier,
      obligations: leseObligations(e),
      fixed: ersterWertMitPraefix(e, 'fixed'),
      pattern: ersterWertMitPraefix(e, 'pattern'),
      slicing: e.slicing || null,
      contentReference: e.contentReference || null,
      short: e.short || '',
      definition: e.definition || '',
    }));

    const byId = new Map();
    const kinder = new Map();
    const slices = new Map();
    for (const el of elemente) {
      byId.set(el.id, el);
      if (el.id === elemente[0].id) continue;
      const seg = letztesSegment(el.id);
      const doppelpunkt = seg.indexOf(':');
      if (doppelpunkt >= 0) {
        if (seg.indexOf('/') >= 0) continue; // Re-Slicing wird nicht ausgewertet
        const basis = elternId(el.id) + '.' + seg.slice(0, doppelpunkt);
        if (!slices.has(basis)) slices.set(basis, []);
        slices.get(basis).push(el);
      } else {
        const eltern = elternId(el.id);
        if (!kinder.has(eltern)) kinder.set(eltern, []);
        kinder.get(eltern).push(el);
      }
    }

    return {
      url: sd.url,
      id: sd.id,
      type: sd.type,
      title: sd.title || sd.name || sd.id,
      version: sd.version || '',
      igUrl: igUrl || null,
      elemente,
      byId,
      kinder,
      slices,
      wurzel: elemente[0],
    };
  }

  function kinderVon(profil, el) {
    const direkt = profil.kinder.get(el.id);
    if (direkt && direkt.length) return direkt;
    if (el.contentReference) {
      const ziel = el.contentReference.replace(/^.*#/, '');
      return profil.kinder.get(ziel) || [];
    }
    return [];
  }

  // ---------------------------------------------------------------- Hilfen Instanz

  function kleinerAnfang(s) {
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  function choiceTyp(name, basis) {
    if (!name.startsWith(basis) || name.length <= basis.length) return null;
    const rest = name.slice(basis.length);
    if (rest.charAt(0) !== rest.charAt(0).toUpperCase()) return null;
    const klein = kleinerAnfang(rest);
    return PRIMITIVE.has(klein) ? klein : rest;
  }

  /** Prüft, ob ein Instanzknoten einen fixed-/pattern-Wert (FHIR-JSON-Form) erfüllt. */
  function passt(knoten, wert) {
    if (wert === null || wert === undefined) return true;
    if (typeof wert !== 'object') return knoten.value !== undefined && String(knoten.value) === String(wert);
    if (Array.isArray(wert)) return wert.every(w => passt(knoten, w));
    return Object.entries(wert).every(([schluessel, soll]) => {
      if (schluessel === 'url' && knoten.url !== undefined) return knoten.url === soll;
      if (schluessel === 'extension' || schluessel === 'id') return true;
      const kinder = knoten.children.filter(k => k.name === schluessel);
      const liste = Array.isArray(soll) ? soll : [soll];
      return liste.every(s => kinder.some(k => passt(k, s)));
    });
  }

  function systemName(s) {
    return SYSTEM_NAMEN[s] || s;
  }

  function codings(knoten) {
    const cs = knoten.children.filter(k => k.name === 'coding');
    if (cs.length) return cs.map(c => leseCoding(c));
    if (knoten.children.some(k => (k.name === 'system' || k.name === 'code') && k.value !== undefined)) return [leseCoding(knoten)];
    return [];
  }

  function leseCoding(c) {
    const wert = n => { const k = c.children.find(x => x.name === n); return k ? k.value : undefined; };
    return { system: wert('system'), code: wert('code'), display: wert('display') };
  }

  function kurzWert(knoten) {
    if (knoten.value !== undefined) return knoten.value;
    if (knoten.url !== undefined && /extension$/i.test(knoten.name)) return knoten.url.split('/').pop();
    const cs = codings(knoten);
    if (cs.length) return cs.map(c => `${c.code || '?'} (${systemName(c.system || '?')})`).join(' + ');
    const ref = knoten.children.find(k => k.name === 'reference');
    if (ref) return '→ ' + ref.value;
    const text = knoten.children.find(k => k.name === 'text' && k.value !== undefined);
    if (text) return text.value;
    return knoten.children.length ? `{${knoten.children.length} Unterelemente}` : '(leer)';
  }

  function zusammenfassung(liste) {
    const s = liste.map(kurzWert).join(' · ');
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  }

  // ---------------------------------------------------------------- Anforderungen

  function istErzeugerObligation(o) {
    return !/consumer/i.test(o.actor || '');
  }

  /** Warum ein fehlendes Element relevant ist – oder null. */
  function anforderung(el) {
    const obl = el.obligations.filter(istErzeugerObligation).map(o => o.code);
    if (el.min >= 1) return { schwere: 'kritisch', art: 'pflicht' };
    if (obl.some(c => /^SHALL:populate$/.test(c) || /SHALL:populate(?!-if)/.test(c))) {
      return { schwere: 'kritisch', art: 'obligation', code: obl.find(c => /SHALL:populate/.test(c)) };
    }
    if (obl.some(c => c.includes('SHALL:populate-if-known'))) {
      return { schwere: 'warnung', art: 'obligation', code: 'SHALL:populate-if-known' };
    }
    if (el.mustSupport) return { schwere: 'warnung', art: 'mustsupport' };
    if (obl.some(c => /SHOULD:populate/.test(c))) {
      return { schwere: 'info', art: 'obligation', code: obl.find(c => /SHOULD:populate/.test(c)) };
    }
    return null;
  }

  function sollText(el) {
    const teile = [`${el.min}..${el.maxText}`];
    if (el.typen.length) teile.push(el.typen.map(t => t.code).join(' | '));
    return teile.join(' · ');
  }

  // ---------------------------------------------------------------- Slicing

  function istExtensionElement(el) {
    return /\.(extension|modifierExtension)$/.test(el.path);
  }

  function diskriminatorUnterstuetzt(d) {
    if (!d || !d.path || d.path.includes('resolve()')) return false;
    if (d.type === 'value' || d.type === 'pattern') return true;
    if (d.type === 'type' && d.path === '$this') return true;
    if ((d.type === 'type' || d.type === 'profile') && d.path === 'resource') return true;
    return false;
  }

  function knotenEntlangPfad(knoten, pfad) {
    let aktuell = [knoten];
    for (const seg of pfad.split('.')) {
      if (seg === '$this') continue;
      aktuell = aktuell.flatMap(k => k.children.filter(c => c.name === seg));
    }
    return aktuell;
  }

  function sliceSollWert(profil, slice, pfad) {
    let id = slice.id;
    for (const seg of pfad.split('.')) id += '.' + seg;
    const el = profil.byId.get(id);
    if (!el) return undefined;
    if (el.fixed) return el.fixed.wert;
    if (el.pattern) return el.pattern.wert;
    return undefined;
  }

  function sliceTrifft(profil, slice, d, knoten) {
    if (d.type === 'value' || d.type === 'pattern') {
      if (d.path === 'url' && knoten.url !== undefined) {
        const erwartet = sliceSollWert(profil, slice, 'url')
          || (slice.typen[0] && slice.typen[0].profile[0]);
        return erwartet !== undefined && knoten.url === erwartet;
      }
      const soll = sliceSollWert(profil, slice, d.path);
      if (soll === undefined) return false;
      return knotenEntlangPfad(knoten, d.path).some(k => passt(k, soll));
    }
    if (d.type === 'type' && d.path === '$this') {
      return slice.typen.some(t => t.code === knoten._typ);
    }
    if (d.path === 'resource') {
      const resEl = profil.byId.get(slice.id + '.resource');
      const erwartet = resEl && resEl.typen[0] && resEl.typen[0].code;
      const wrapper = knoten.children.find(c => c.name === 'resource');
      const innen = wrapper && wrapper.children[0];
      return !!(erwartet && innen && innen.name === erwartet);
    }
    return false;
  }

  function ordneSlicesZu(profil, el, knotenListe) {
    const slices = profil.slices.get(el.id) || [];
    const diskriminatoren = (el.slicing && el.slicing.discriminator) || [];
    const zuordnung = new Map(slices.map(s => [s, []]));
    const rest = [];
    for (const k of knotenListe) {
      const s = slices.find(sl => diskriminatoren.every(d => sliceTrifft(profil, sl, d, k)));
      if (s) zuordnung.get(s).push(k);
      else rest.push(k);
    }
    return { slices, zuordnung, rest };
  }

  // ---------------------------------------------------------------- Vergleich einer Ressource

  function igLink(profil, el) {
    if (!profil.igUrl) return null;
    const basis = profil.igUrl.endsWith('/') ? profil.igUrl : profil.igUrl + '/';
    return `${basis}StructureDefinition-${profil.id}-definitions.html#${encodeURIComponent(el.id)}`;
  }

  function anzeigeName(el) {
    return el.sliceName ? `${letztesSegment(el.path)}:${el.sliceName}` : letztesSegment(el.path);
  }

  /**
   * Vergleicht eine Ressource (aus FhirXml.parseFhirXml) mit einem normalisierten EU-Profil.
   * @param info   { resourceType, id, fullUrl, profile[], knoten }
   * @param profil normalisiertes Profil
   * @param ctx    { bindingHinweise, mioIndex }
   * @returns { befunde[], zeilen[] }
   */
  function vergleicheRessource(info, profil, ctx) {
    ctx = ctx || {};
    const hinweise = ctx.bindingHinweise || {};
    const mioIndex = ctx.mioIndex || new Map();
    const befunde = [];
    const zeilen = [];
    const ressource = {
      typ: info.resourceType,
      label: info.resourceType + (info.id ? '/' + info.id : ''),
      fullUrl: info.fullUrl || null,
    };

    if (profil.type !== info.resourceType) {
      throw new Error(`Profil ${profil.url} gilt für ${profil.type}, nicht für ${info.resourceType}.`);
    }

    function neu(kategorie, schwere, el, aspekt, ist, soll, erklaerung, zeile) {
      const b = {
        kategorie, schwere, aspekt,
        ressource: ressource.label,
        ressourceTyp: ressource.typ,
        fullUrl: ressource.fullUrl,
        pfad: el ? el.id : ressource.typ,
        element: el ? anzeigeName(el) : ressource.typ,
        mioName: el ? (mioIndex.get(el.path) || null) : null,
        ist: ist === undefined ? null : ist,
        soll: soll === undefined ? null : soll,
        erklaerung,
        profil: profil.url,
        profilTitel: profil.title,
        igLink: el ? igLink(profil, el) : null,
      };
      befunde.push(b);
      if (zeile) zeile.befunde.push(b);
      return b;
    }

    function neueZeile(el, tiefe, knotenListe, nurMio) {
      const z = {
        tiefe,
        elementId: el ? el.id : null,
        name: el ? anzeigeName(el) : nurMio.name,
        ist: knotenListe.length ? zusammenfassung(knotenListe) : '',
        soll: el ? sollText(el) : '—',
        mioName: el ? (mioIndex.get(el.path) || null) : null,
        befunde: [],
      };
      zeilen.push(z);
      return z;
    }

    function pruefeWert(el, k, zeile) {
      const name = anzeigeName(el);
      if (el.fixed && !passt(k, el.fixed.wert)) {
        neu('abweichend', 'kritisch', el, 'fixed', kurzWert(k), JSON.stringify(el.fixed.wert),
          `„${name}“ muss laut EU-Spezifikation genau den festgelegten Wert haben, die Datei enthält einen anderen.`, zeile);
      }
      if (el.pattern && !passt(k, el.pattern.wert)) {
        neu('abweichend', 'kritisch', el, 'pattern', kurzWert(k), JSON.stringify(el.pattern.wert),
          `„${name}“ entspricht nicht dem von der EU-Spezifikation vorgegebenen Muster.`, zeile);
      }
      if (el.binding && el.binding.strength !== 'example') {
        const h = hinweise[el.binding.valueSet];
        if (!h) return;
        const schwere = el.binding.strength === 'required' ? 'kritisch'
          : el.binding.strength === 'extensible' ? 'warnung' : 'info';
        const staerke = { required: 'verpflichtend', extensible: 'erweiterbar', preferred: 'empfohlen' }[el.binding.strength] || el.binding.strength;
        if (h.systeme) {
          const cs = codings(k).filter(c => c.system);
          if (cs.length && !cs.some(c => h.systeme.includes(c.system))) {
            const ist = [...new Set(cs.map(c => systemName(c.system)))].join(', ');
            neu('abweichend', schwere, el, 'binding', ist, `${h.name || el.binding.valueSet} (${staerke})`,
              `„${name}“ ist mit ${ist} kodiert, die EU-Spezifikation erwartet ${h.systeme.map(systemName).join(' oder ')}.`, zeile);
          }
        }
        if (k.value !== undefined && (h.codes || h.muster)) {
          const ok = (h.codes ? h.codes.includes(k.value) : true) && (h.muster ? new RegExp(h.muster).test(k.value) : true);
          if (!ok) {
            neu('abweichend', schwere, el, 'binding', k.value, `${h.name || el.binding.valueSet} (${staerke})`,
              `Der Wert „${k.value}“ in „${name}“ ist im geforderten Wertebereich (${h.name || el.binding.valueSet}) nicht enthalten.`, zeile);
          }
        }
      }
    }

    function verarbeiteKinder(el, k, tiefe) {
      if (el.path === 'Bundle.entry.resource' || /\.contained$/.test(el.path)) return; // eigene Prüfung
      const kinderEls = kinderVon(profil, el);
      if (!kinderEls.length) {
        // Datentyp im Profil nicht aufgeklappt → Inhalt nicht weiter geprüft, nur verschachtelte Extensions melden
        if (!istExtensionElement(el)) meldeVerschachtelteExtensions(el, k, tiefe);
        return;
      }
      const verbraucht = new Set();
      for (const ke of kinderEls) {
        const seg = letztesSegment(ke.path);
        let treffer;
        if (seg.endsWith('[x]')) {
          const basis = seg.slice(0, -3);
          treffer = k.children.filter(c => {
            const t = choiceTyp(c.name, basis);
            if (t) c._typ = t;
            return !!t;
          });
        } else {
          treffer = k.children.filter(c => c.name === seg);
        }
        treffer.forEach(t => verbraucht.add(t));
        verarbeiteElement(ke, treffer, tiefe + 1);
      }
      for (const c of k.children) {
        if (verbraucht.has(c)) continue;
        const z = neueZeile(null, tiefe + 1, [c], { name: c.name });
        Object.assign(neu('nur-mio', 'warnung', null, 'element', kurzWert(c), null,
          `Das Element „${c.name}“ ist im EU-Profil an dieser Stelle (${el.path}) nicht definiert.`, z),
        { pfad: el.path + '.' + c.name, element: c.name });
      }
    }

    function meldeVerschachtelteExtensions(el, k, tiefe) {
      const datentypProfil = el.typen.map(t => t.profile[0]).find(Boolean);
      (function suche(knoten, pfad) {
        for (const c of knoten.children) {
          const p = pfad + '.' + c.name;
          if (/^(extension|modifierExtension)$/.test(c.name)) {
            const kurz = (c.url || '').split('/').pop();
            const rz = neueZeile(null, tiefe + 1, [c], { name: `${p.slice(el.path.length + 1)} (${kurz})` });
            Object.assign(neu('nur-mio', c.name === 'modifierExtension' ? 'warnung' : 'info', el, 'extension', c.url || '(ohne URL)', null,
              `Die Extension „${kurz}“ in „${anzeigeName(el)}“ ist im EU-Profil nicht ausdrücklich vorgesehen` +
              (datentypProfil ? ` (das Datentyp-Profil ${datentypProfil.split('/').pop()} wurde nicht geprüft).` : ' (z. B. eine nationale Ergänzung).'), rz),
            { pfad: p + '[url=' + (c.url || '') + ']' });
          } else {
            suche(c, p);
          }
        }
      })(k, el.path);
    }

    function verarbeiteElement(el, knotenListe, tiefe) {
      const name = anzeigeName(el);
      const n = knotenListe.length;

      if (n === 0) {
        const a = anforderung(el);
        if (!a) return;
        const z = neueZeile(el, tiefe, [], null);
        let text;
        if (a.art === 'pflicht') text = `„${name}“ ist in der EU-Spezifikation Pflicht (${el.min}..${el.maxText}), fehlt aber in der Datei.`;
        else if (a.art === 'mustsupport') text = `„${name}“ ist in der EU-Spezifikation als Must-Support markiert, fehlt aber in der Datei.`;
        else if (a.schwere === 'info') text = `Die EU-Spezifikation empfiehlt, „${name}“ zu befüllen (${a.code}); in der Datei fehlt es.`;
        else text = `Die EU-Spezifikation verlangt „${name}“ (${a.code}); in der Datei fehlt es.`;
        neu('fehlt', a.schwere, el, a.art, '—', sollText(el), text, z);
        return;
      }

      const z = neueZeile(el, tiefe, knotenListe, null);
      const vorher = befunde.length;

      if (n < el.min || n > el.max) {
        const text = el.max === 0
          ? `„${name}“ ist in der EU-Spezifikation ausgeschlossen (0..0), kommt in der Datei aber ${n}-mal vor.`
          : `„${name}“ kommt ${n}-mal vor, die EU-Spezifikation erlaubt ${el.min}..${el.maxText}.`;
        neu('abweichend', 'kritisch', el, 'kardinalitaet', `${n}×`, `${el.min}..${el.maxText}`, text, z);
      }

      // Datentyp bei [x]-Elementen
      if (el.path.endsWith('[x]') && el.typen.length) {
        for (const k of knotenListe) {
          if (k._typ && !el.typen.some(t => t.code === k._typ)) {
            neu('abweichend', 'kritisch', el, 'datentyp', k._typ, el.typen.map(t => t.code).join(' | '),
              `„${name}“ verwendet den Datentyp ${k._typ}, die EU-Spezifikation erlaubt nur ${el.typen.map(t => t.code).join(', ')}.`, z);
          }
        }
      }

      knotenListe.forEach(k => pruefeWert(el, k, z));

      const hatSlices = el.slicing && (profil.slices.get(el.id) || []).length;
      const unterstuetzt = hatSlices && (el.slicing.discriminator || []).length
        && el.slicing.discriminator.every(diskriminatorUnterstuetzt);

      if (unterstuetzt) {
        const { slices, zuordnung, rest } = ordneSlicesZu(profil, el, knotenListe);
        for (const s of slices) verarbeiteElement(s, zuordnung.get(s), tiefe + 1);
        for (const k of rest) {
          if (el.slicing.rules === 'closed') {
            const rz = neueZeile(el, tiefe + 1, [k], null);
            neu('abweichend', 'kritisch', el, 'slicing', kurzWert(k), (profil.slices.get(el.id) || []).map(s => s.sliceName).join(', '),
              `Dieser Eintrag in „${name}“ passt zu keiner von der EU-Spezifikation erlaubten Variante.`, rz);
          } else if (istExtensionElement(el)) {
            const rz = neueZeile(null, tiefe + 1, [k], { name: `${name} (${(k.url || '').split('/').pop()})` });
            const modifier = el.path.endsWith('modifierExtension');
            neu('nur-mio', modifier ? 'warnung' : 'info', el, 'extension', k.url || '(ohne URL)', null,
              `Die ${modifier ? 'Modifier-Extension' : 'Extension'} „${(k.url || '').split('/').pop()}“ ist in der EU-Spezifikation nicht vorgesehen (z. B. eine nationale Ergänzung).`, rz)
              .pfad = el.path + '[url=' + (k.url || '') + ']';
          }
          verarbeiteKinder(el, k, tiefe);
        }
      } else if (istExtensionElement(el) && !el.sliceName) {
        // Extensions ohne Slicing-Information: jede Extension ist eine Ergänzung gegenüber der EU-Spec
        for (const k of knotenListe) {
          const rz = neueZeile(null, tiefe + 1, [k], { name: `${name} (${(k.url || '').split('/').pop()})` });
          neu('nur-mio', 'info', el, 'extension', k.url || '(ohne URL)', null,
            `Die Extension „${(k.url || '').split('/').pop()}“ ist in der EU-Spezifikation nicht vorgesehen (z. B. eine nationale Ergänzung).`, rz)
            .pfad = el.path + '[url=' + (k.url || '') + ']';
        }
      } else {
        knotenListe.forEach(k => verarbeiteKinder(el, k, tiefe));
      }

      const eigene = befunde.slice(vorher).filter(b => b.pfad === el.id && b.kategorie !== 'ok');
      if (!eigene.length) {
        neu('ok', 'info', el, 'element', zusammenfassung(knotenListe), sollText(el),
          `„${name}“ ist vorhanden und entspricht der EU-Spezifikation.`, z);
      }
    }

    // Profilangabe der Instanz
    if (info.profile && info.profile.length && !info.profile.includes(profil.url)) {
      neu('abweichend', 'info', profil.wurzel, 'profil', info.profile.join(', '), profil.url,
        `Die Ressource gibt ein anderes Profil an (${info.profile.map(p => p.split('/').pop()).join(', ')}); verglichen wird mit dem EU-Profil „${profil.title}“.`);
    }

    verarbeiteElement(profil.wurzel, [info.knoten], 0);
    return { befunde, zeilen };
  }

  // ---------------------------------------------------------------- Profilwahl

  /**
   * Wählt das passende EU-Profil für eine Ressource.
   * Reihenfolge: meta.profile → einziger Kandidat → Muster (fixed/pattern) passt → mapping.json → erster.
   */
  function waehleProfil(info, kandidaten, mapping) {
    if (!kandidaten || !kandidaten.length) return null;
    const perMeta = kandidaten.find(k => (info.profile || []).includes(k.url));
    if (perMeta) return { profil: perMeta, grund: 'meta.profile' };
    if (kandidaten.length === 1) return { profil: kandidaten[0], grund: 'Ressourcentyp' };

    const musterTreffer = kandidaten.filter(k => {
      const muster = (k.kinder.get(k.wurzel.id) || []).filter(e => e.pattern || e.fixed);
      if (!muster.length) return false;
      return muster.every(e => {
        const seg = letztesSegment(e.path);
        const knoten = info.knoten.children.filter(c => c.name === seg);
        const soll = (e.pattern || e.fixed).wert;
        return knoten.some(kn => passt(kn, soll));
      });
    });
    if (musterTreffer.length === 1) return { profil: musterTreffer[0], grund: 'Code-Muster' };

    const auswahl = musterTreffer.length ? musterTreffer : kandidaten;
    const zuordnungen = (mapping && mapping.zuordnungen) || [];
    const perMapping = auswahl.find(k => zuordnungen.some(z => z.euProfil === k.url && z.ressource === info.resourceType));
    if (perMapping) return { profil: perMapping, grund: 'Zuordnung (mapping.json)' };
    return { profil: auswahl[0], grund: 'erster passender Ressourcentyp' };
  }

  // ---------------------------------------------------------------- MIO-Bezeichnungen

  /**
   * Index FHIR-Pfad (ohne Slices, mit Ressourcentyp) → deutsche MIO-Bezeichnung.
   */
  function baueMioIndex(modell, mapping) {
    const index = new Map();
    if (!modell || !modell.elemente) return index;
    const zuordnungen = (mapping && mapping.zuordnungen) || [];
    function ressourceZu(profilName) {
      const z = zuordnungen.find(x => x.mioProfil && x.mioProfil.split(' ')[0] === profilName);
      return z ? z.ressource : null;
    }
    for (const e of modell.elemente) {
      for (const m of e.fhirMapping || []) {
        const teile = m.split('.');
        const typ = ressourceZu(teile[0]);
        if (!typ) continue;
        const pfad = [typ, ...teile.slice(1).map(t => t.split(':')[0])].join('.');
        const bisher = index.get(pfad);
        if (!bisher) index.set(pfad, e.name);
        else if (!bisher.split(' / ').includes(e.name)) index.set(pfad, bisher + ' / ' + e.name);
      }
    }
    return index;
  }

  // ---------------------------------------------------------------- Gesamtauswertung

  function berechneScore(befunde) {
    let ok = 0;
    let abzug = 0;
    for (const b of befunde) {
      if (b.kategorie === 'ok') ok += 1;
      else if (b.kategorie === 'fehlt' || b.kategorie === 'abweichend') abzug += GEWICHT[b.schwere] || 1;
    }
    return ok + abzug === 0 ? null : Math.round((100 * ok) / (ok + abzug));
  }

  function zaehle(befunde) {
    const z = { fehlt: 0, 'nur-mio': 0, abweichend: 0, ok: 0, kritisch: 0, warnung: 0, info: 0 };
    for (const b of befunde) {
      z[b.kategorie] += 1;
      if (b.kategorie !== 'ok') z[b.schwere] += 1;
    }
    return z;
  }

  /**
   * Vergleicht alle Ressourcen eines Dokuments.
   * @param ressourcen  aus FhirXml.parseFhirXml(...).ressourcen
   * @param wahl        Array gleicher Länge: { profil, grund } | null
   */
  function vergleicheDokument(ressourcen, wahl, ctx) {
    const ergebnis = { ressourcen: [], befunde: [] };
    ressourcen.forEach((info, i) => {
      const w = wahl[i];
      const eintrag = {
        label: info.resourceType + (info.id ? '/' + info.id : ''),
        typ: info.resourceType,
        fullUrl: info.fullUrl,
        profil: w ? w.profil.url : null,
        profilTitel: w ? w.profil.title : null,
        grund: w ? w.grund : null,
        zeilen: [],
        befunde: [],
      };
      if (w) {
        const r = vergleicheRessource(info, w.profil, ctx);
        eintrag.zeilen = r.zeilen;
        eintrag.befunde = r.befunde;
      } else {
        const b = {
          kategorie: 'nur-mio', schwere: 'warnung', aspekt: 'ressource',
          ressource: eintrag.label, ressourceTyp: info.resourceType, fullUrl: info.fullUrl,
          pfad: info.resourceType, element: info.resourceType, mioName: null,
          ist: (info.profile || []).join(', ') || info.resourceType, soll: null,
          erklaerung: `Für den Ressourcentyp ${info.resourceType} gibt es in der EU-Spezifikation kein Profil; die Ressource wurde nicht verglichen.`,
          profil: null, profilTitel: null, igLink: null,
        };
        eintrag.befunde = [b];
      }
      ergebnis.ressourcen.push(eintrag);
      ergebnis.befunde.push(...eintrag.befunde);
    });
    ergebnis.score = berechneScore(ergebnis.befunde);
    ergebnis.zaehler = zaehle(ergebnis.befunde);
    return ergebnis;
  }

  global.CompareLogik = {
    normalisiereProfil, vergleicheRessource, vergleicheDokument, waehleProfil,
    baueMioIndex, berechneScore, zaehle, passt, anforderung, systemName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
