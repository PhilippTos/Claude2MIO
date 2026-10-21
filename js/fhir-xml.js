/*
 * fhir-xml.js – liest FHIR-XML im Browser (DOMParser) in einen einfachen Knotenbaum.
 * Kein Netzwerkzugriff: Die Datei bleibt vollständig im Browser.
 *
 * Knoten: { name, value?, url?, children: Knoten[] }
 *  - name:  Elementname wie im XML (z. B. "onsetDateTime", "coding")
 *  - value: Wert des value-Attributs bei primitiven Typen
 *  - url:   url-Attribut bei extension/modifierExtension
 */
(function (global) {
  'use strict';

  const FHIR_NS = 'http://hl7.org/fhir';
  const XHTML_NS = 'http://www.w3.org/1999/xhtml';

  class FhirFehler extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'FhirFehler';
      this.code = code; // 'xml-ungueltig' | 'kein-fhir' | 'unbekanntes-profil' | 'leer'
    }
  }

  function elementZuKnoten(el) {
    const knoten = { name: el.localName, children: [] };
    if (el.hasAttribute('value')) knoten.value = el.getAttribute('value');
    if (el.hasAttribute('url')) knoten.url = el.getAttribute('url');
    if (el.namespaceURI === XHTML_NS) {
      knoten.value = '(XHTML-Narrativ)';
      return knoten;
    }
    for (const kind of el.children) {
      if (kind.namespaceURI !== FHIR_NS && kind.namespaceURI !== XHTML_NS) continue;
      knoten.children.push(elementZuKnoten(kind));
    }
    return knoten;
  }

  /** Liefert die Ressource innerhalb eines <resource>-Wrappers (Bundle.entry.resource, contained). */
  function innereRessource(wrapper) {
    return wrapper && wrapper.children.length === 1 ? wrapper.children[0] : null;
  }

  function kind(knoten, name) {
    return knoten.children.find(k => k.name === name);
  }

  function kinder(knoten, name) {
    return knoten.children.filter(k => k.name === name);
  }

  function profileVon(ressource) {
    const meta = kind(ressource, 'meta');
    return meta ? kinder(meta, 'profile').map(p => p.value).filter(Boolean) : [];
  }

  function ressourceInfo(knoten, fullUrl, pfad) {
    const id = kind(knoten, 'id');
    return {
      resourceType: knoten.name,
      id: id ? id.value : null,
      fullUrl: fullUrl || null,
      profile: profileVon(knoten),
      pfad,
      knoten,
    };
  }

  /**
   * Parst FHIR-XML-Text.
   * @returns {{ wurzel: object, ressourcen: object[] }}
   *   ressourcen[0] ist die Wurzelressource, bei einem Bundle folgen die Einträge.
   */
  function parseFhirXml(text) {
    if (!text || !text.trim()) throw new FhirFehler('leer', 'Die Datei ist leer.');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const fehler = doc.getElementsByTagName('parsererror')[0];
    if (fehler) {
      // Browser liefern unterschiedliche (englische) Texte – Zeile/Spalte herausziehen, wenn möglich
      const roh = fehler.textContent || '';
      const m = roh.match(/line (\d+) at column (\d+): ([^\n]+)/i) || roh.match(/Line Number (\d+), Column (\d+)/i);
      const detail = m ? ` (Zeile ${m[1]}, Spalte ${m[2]}${m[3] ? ': ' + m[3].trim() : ''})` : '';
      throw new FhirFehler('xml-ungueltig', 'Die Datei ist kein gültiges XML' + detail + '. Bitte prüfen Sie, ob alle Elemente korrekt geschlossen sind.');
    }
    const root = doc.documentElement;
    if (!root || root.namespaceURI !== FHIR_NS) {
      throw new FhirFehler('kein-fhir',
        'Die Datei enthält keine FHIR-Ressource (erwartet wird der Namensraum http://hl7.org/fhir).');
    }
    const wurzel = elementZuKnoten(root);
    const ressourcen = [ressourceInfo(wurzel, null, wurzel.name)];
    if (wurzel.name === 'Bundle') {
      kinder(wurzel, 'entry').forEach((entry, i) => {
        const r = innereRessource(kind(entry, 'resource'));
        const fullUrl = kind(entry, 'fullUrl');
        if (r) ressourcen.push(ressourceInfo(r, fullUrl && fullUrl.value, `Bundle.entry[${i}].resource`));
      });
    }
    return { wurzel, ressourcen };
  }

  global.FhirXml = { parseFhirXml, FhirFehler, kind, kinder };
})(typeof window !== 'undefined' ? window : globalThis);
