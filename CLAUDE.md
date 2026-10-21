# MIO ↔ EU Spec Compare

Statische Web-App, die eine MIO-Datei (FHIR XML) mit der passenden EU-Spezifikation vergleicht,
z. B. MIO Patientenkurzakte ↔ HL7 Europe Patient Summary, und vor allem die **Unterschiede** zeigt.
Veröffentlicht über GitHub Pages (Branch `main`, Ordner root) unter `https://<user>.github.io/<repo>/`.
Ein Projekt ist per Link-Anker `#projekt-id` direkt teilbar.

## Ordnerlogik
- `_eingang/` ist die Rohdatei-Ablage des Nutzers. Sie steht in `.gitignore` und wird **nie** veröffentlicht.
  Pro Projekt gibt es einen Ordner (z. B. `pka-eps/`) mit den Unterordnern `1_eu-spezifikation`,
  `2_mio-profile`, `3_beispieldateien` und `4_mappings-und-doku`. Die Metadaten stehen in `_eingang/projektliste.md`.
- `config/projects.json` ist die Projektliste der App. Daraus wird `projektliste.md` erzeugt.
- `specs/<projekt>/{eu,mio}/` enthält Snapshot-StructureDefinitions und `valuesets/` (keine großen CodeSystems).
  Unter `specs/<projekt>/mapping.json` steht die Zuordnung MIO-Profil → EU-Profil (Status ggf. „vorgeschlagen“).
- `samples/<projekt>/` enthält nur synthetische Beispielinstanzen.
- `css/`, `js/` (Vergleichslogik in `js/compare.js`, getrennt von der UI) und `tests/` (`compare.test.html`).

## Regeln
- Rein statisch: HTML/CSS/JS, kein Build und kein Backend. Nur relative Pfade, Daten per `fetch()` aus `config/` und `specs/`.
- **Nie** aus `_eingang/` laden oder darauf verlinken.
- Externe Bibliotheken nur von cdnjs oder jsDelivr, mit exakt gepinnter Version. Schrift: Inter über Google Fonts.
- Nutzerdaten bleiben im Browser (DOMParser). Keine Requests mit Nutzerdaten, kein Tracking.
  Sichtbarer Hinweis: „Daten verlassen Ihren Browser nicht – bitte nur Testdaten verwenden.“
- Neue Projekte kommen nur über `projects.json` und `specs/` hinzu, ohne Code-Änderung.
- Keine echten Patientendaten. Bei Zweifeln, ob ein Sample synthetisch ist, nachfragen.
- Bei SNOMED-CT-Codes in ValueSets auf Lizenzfragen hinweisen.
- Hinweis in App und README: ersetzt keine offizielle Validierung (z. B. HL7 FHIR Validator).
- UI-Texte auf Deutsch. Nach WCAG AA, also Farbe nie als einziges Merkmal, Tastaturbedienung und responsiv.
- **Nie committen oder pushen.** Das macht der Nutzer selbst mit GitHub Desktop.

## Vergleichskategorien
1. FEHLT: Pflichtelement (min ≥ 1) oder mustSupport in der EU-Spec, im MIO nicht vorhanden.
2. NUR IM MIO: in der EU-Spec nicht vorgesehen, z. B. deutsche Extensions.
3. ABWEICHEND: Kardinalität, Datentyp, fixed/pattern oder Binding/Codesystem, jeweils mit Ist- und Soll-Wert.
4. ÜBEREINSTIMMEND: standardmäßig eingeklappt.

Jeder Befund hat: Schwere (kritisch/Warnung/Info), FHIR-Pfad, Ressource, eine Erklärung in einem Satz und einen IG-Link.

## Phasen
1. Struktur anlegen. **Erledigt.** Danach STOPP.
2. Nach „Dateien sind abgelegt“: Archive entpacken (außerhalb des Repos oder in `_eingang/<projekt>/_entpackt/`),
   SDs, ValueSets und Samples einsortieren, `projects.json` und `mapping.json` erzeugen,
   Prüfbericht ✔/✘/⚠ mit Größe von `specs/` und offenen Fragen. Danach STOPP. **Erledigt für pka-eps.**
3. Erst einen Umsetzungsplan vorlegen und auf OK warten, dann die App bauen.
   Dazu gehören Stepper, Projektkarten, Drag-&-Drop, Dashboard mit Score-Ring, Filtern und Suche,
   die Ansicht „Nebeneinander“, Hell/Dunkel, Export als CSV/JSON/Druck, Tests und README.
   **Erledigt (2026-10-21).** Ohne externe Bibliotheken. Die Binding-Prüfung nutzt `specs/<projekt>/eu/binding-hinweise.json`.
   Der Selbsttest liegt unter `tests/compare.test.html` (24 Fälle).
4. Lokalen Testserver starten. Auf diesem Rechner gibt es weder Python noch Node, deshalb läuft ein PowerShell-`HttpListener`-Skript (nicht im Repo). Prüfen, dass nichts auf `_eingang/` verweist und `git status` den Ordner nicht zeigt.
   Öffentliche Adresse und Links je Projekt nennen. Nicht committen.

## Stand & Entscheidungen (Phase 2, 2026-10-21)
- Projekt `pka-eps` heißt „MIO ePA EU Patient Summary ↔ HL7 Europe Patient Summary“. Die Ordner-ID bleibt.
- MIO-Quelle: ART-DECOR-Export (logisches Modell, keine FHIR-Profile) → `specs/pka-eps/mio/model.json`.
  Ein FHIR-Mapping ist nur bei einem Teil der Elemente vorhanden. Das hochgeladene MIO-XML wird primär gegen die EU-Snapshots geprüft.
- EU-Version: immer den letzten verfügbaren Stand nehmen und nach dem Datum der letzten Änderung benennen
  (aktuell CI-Build vom 2026-10-16, Quelle `build.fhir.org/ig/hl7-eu/eps/package.tgz`).
- Die EU-Profile nutzen Obligations statt mustSupport. Sie werden als mustSupport-ähnlich gewertet.
- Das KBV-URL-Muster `https://fhir.kbv.de/StructureDefinition/<Name>` ist bestätigt. Nicht belegte Profilnamen werden mit „⚠ URL unsicher“ markiert.
- SNOMED-CT-Codes werden mit Bezeichnung veröffentlicht (Entscheidung des Nutzers).
- Die Q3-Platzhalterdateien sind entfernt. `index.html` entsteht in Phase 3 neu als App.
