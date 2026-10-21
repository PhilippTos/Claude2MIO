/*
 * specs.js – lädt Projektkonfiguration und Spezifikationen per fetch() (nur relative Pfade).
 * Profile werden erst bei Bedarf geladen und zwischengespeichert.
 * Eigene StructureDefinitions (Upload) werden nur im Speicher gehalten.
 */
(function (global) {
  'use strict';

  const cache = new Map();
  let basis = ''; // Präfix für relative Pfade (z. B. '../' für die Testseite)

  function setzeBasis(b) {
    basis = b || '';
  }

  async function ladeJson(pfad) {
    if (cache.has(pfad)) return cache.get(pfad);
    const p = fetch(basis + pfad, { cache: 'no-cache' }).then(async r => {
      if (!r.ok) throw new Error(`Datei konnte nicht geladen werden: ${pfad} (HTTP ${r.status})`);
      return r.json();
    });
    cache.set(pfad, p);
    try {
      return await p;
    } catch (e) {
      cache.delete(pfad);
      throw e;
    }
  }

  async function ladeProjekte() {
    const cfg = await ladeJson('config/projects.json');
    return cfg.projekte || [];
  }

  /** Ordner, in dem eine Datei liegt (mit abschließendem /). */
  function ordner(pfad) {
    return pfad.slice(0, pfad.lastIndexOf('/') + 1);
  }

  /**
   * Lädt alles, was für den Vergleich eines Projekts nötig ist (ohne die einzelnen Profile).
   */
  async function ladeProjekt(projekt) {
    const [index, mapping, mioModell, hinweise] = await Promise.all([
      ladeJson(projekt.eu.profilIndex),
      projekt.mapping ? ladeJson(projekt.mapping).catch(() => null) : null,
      projekt.mio && projekt.mio.modell ? ladeJson(projekt.mio.modell).catch(() => null) : null,
      projekt.eu.bindingHinweise ? ladeJson(projekt.eu.bindingHinweise).catch(() => null) : null,
    ]);
    const basis = ordner(projekt.eu.profilIndex);
    const profile = (index.profile || []).map(p => ({ ...p, pfad: basis + p.datei.replace(/^eu\//, '') }));
    return {
      projekt,
      profile,
      mapping,
      mioModell,
      bindingHinweise: (hinweise && hinweise.valueSets) || {},
      eigeneProfile: new Map(),
    };
  }

  /** Lädt ein Profil des Projekts (normalisiert) oder liefert ein hochgeladenes eigenes Profil. */
  async function ladeProfil(daten, url) {
    if (daten.eigeneProfile.has(url)) return daten.eigeneProfile.get(url);
    const eintrag = daten.profile.find(p => p.url === url);
    if (!eintrag) return null;
    const sd = await ladeJson(eintrag.pfad);
    return CompareLogik.normalisiereProfil(sd, daten.projekt.eu.igUrl);
  }

  /** Alle Profil-URLs (Projekt + eigene) zu einem Ressourcentyp. */
  function kandidaten(daten, resourceType) {
    const eigene = [...daten.eigeneProfile.values()].filter(p => p.type === resourceType).map(p => p.url);
    if (eigene.length) return eigene;
    return daten.profile.filter(p => p.type === resourceType).map(p => p.url);
  }

  /**
   * Nimmt hochgeladene StructureDefinitions (JSON-Text) auf.
   * Gibt die Titel der übernommenen Profile zurück.
   */
  function fuegeEigeneProfileHinzu(daten, jsonText) {
    let obj;
    try {
      obj = JSON.parse(jsonText);
    } catch (e) {
      throw new FhirXml.FhirFehler('json-ungueltig', 'Die Profildatei ist kein gültiges JSON.');
    }
    const sds = obj.resourceType === 'Bundle'
      ? (obj.entry || []).map(e => e.resource).filter(r => r && r.resourceType === 'StructureDefinition')
      : [obj];
    const neu = [];
    for (const sd of sds) {
      if (!sd || sd.resourceType !== 'StructureDefinition') {
        throw new FhirXml.FhirFehler('kein-profil', 'Die Datei enthält keine StructureDefinition.');
      }
      if (!sd.snapshot || !sd.snapshot.element) {
        throw new FhirXml.FhirFehler('kein-snapshot',
          `Das Profil „${sd.name || sd.id}“ hat keinen Snapshot. Bitte die Snapshot-Form verwenden (z. B. aus dem package.tgz des IG).`);
      }
      const p = CompareLogik.normalisiereProfil(sd, null);
      daten.eigeneProfile.set(p.url, p);
      neu.push(p.title);
    }
    return neu;
  }

  /**
   * Komplette Auswertung einer FHIR-XML-Datei gegen ein geladenes Projekt.
   * Wirft FhirXml.FhirFehler bei ungültigem XML, fehlender FHIR-Ressource oder unbekanntem Profil.
   */
  async function analysiere(text, daten) {
    const { ressourcen } = FhirXml.parseFhirXml(text);
    const wahl = [];
    for (const info of ressourcen) {
      const urls = kandidaten(daten, info.resourceType);
      const profile = (await Promise.all(urls.map(u => ladeProfil(daten, u)))).filter(Boolean);
      wahl.push(CompareLogik.waehleProfil(info, profile, daten.mapping));
    }
    if (!wahl.some(Boolean)) {
      const typen = [...new Set(ressourcen.map(r => r.resourceType))].join(', ');
      throw new FhirXml.FhirFehler('unbekanntes-profil',
        `Für ${typen} gibt es in diesem Projekt kein passendes EU-Profil. Bitte ein anderes Projekt wählen oder ein eigenes Profil hochladen.`);
    }
    if (!daten.mioIndex) daten.mioIndex = CompareLogik.baueMioIndex(daten.mioModell, daten.mapping);
    const ergebnis = CompareLogik.vergleicheDokument(ressourcen, wahl, {
      bindingHinweise: daten.bindingHinweise,
      mioIndex: daten.mioIndex,
    });
    ergebnis.anzahlRessourcen = ressourcen.length;
    return ergebnis;
  }

  global.Specs = { setzeBasis, ladeJson, ladeProjekte, ladeProjekt, ladeProfil, kandidaten, fuegeEigeneProfileHinzu, analysiere };
})(typeof window !== 'undefined' ? window : globalThis);
