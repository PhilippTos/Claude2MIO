# MIO ↔ EU Spec Compare

Statische Web-App, die eine **MIO-Datei (FHIR XML)** mit der passenden **EU-Spezifikation** vergleicht und vor allem die **Unterschiede** übersichtlich anzeigt. Aktuell enthalten ist der Vergleich MIO ePA EU Patient Summary ↔ HL7 Europe Patient Summary.

> **Daten verlassen Ihren Browser nicht – bitte nur Testdaten verwenden.**
> Die hochgeladene Datei wird ausschließlich im Browser ausgewertet. Es gibt kein Backend, kein Tracking und keine Cookies.

> **Ersetzt keine offizielle Validierung.** Für verbindliche Prüfungen den offiziellen HL7 FHIR Validator verwenden.

## Bedienung

1. **Projekt wählen:** Jede Karte verbindet ein MIO mit einer EU-Spezifikation.
2. **Datei hochladen:** Eine FHIR-XML-Datei (Bundle oder einzelne Ressource) in die Fläche ziehen oder auswählen. Ohne eigene Testdatei geht auch **„Beispieldatei laden“**.
3. **Ergebnis:**
   - **Score-Ring:** Anteil übereinstimmender Elemente. Kritische Befunde zählen doppelt, „Nur im MIO“ senkt den Wert nicht.
   - **Befunde:** Nach Ressource gruppiert, filterbar nach Kategorie (Chips), Schwere und Ressource, mit Volltextsuche.
   - **Nebeneinander:** MIO-Datei (Ist) links, EU-Profil (Soll) rechts, Zeile für Zeile ausgerichtet. Mit „Nur Unterschiede zeigen“ bleiben nur die Abweichungen sichtbar.
   - **Export:** CSV (für Excel, mit Semikolon), JSON oder Druckansicht. Exportiert werden jeweils die aktuell gefilterten Befunde.

**Teilen:** Der Link `https://<user>.github.io/<repo>/#<projekt-id>` öffnet direkt das richtige Projekt, z. B. `…/#pka-eps`. Die hochgeladene Datei wird nie geteilt.

**Eigene Profile:** Unter „Erweitert“ lassen sich StructureDefinitions (JSON, Snapshot-Form) für einen Ad-hoc-Vergleich laden. Sie gelten nur in der laufenden Sitzung.

## MIO ↔ MIO: zwei MIO-Inhalte vergleichen

Oben rechts auf **„MIO ↔ MIO“** umschalten:

1. **MIO A** und **MIO B** wählen, z. B. „MIO ePA EU Patient Summary“ und „Wechselschnittstelle (WeST)“. Auch das **HL7 Europe Patient Summary (EU)** steht zur Wahl. Ein MIO, das auf einer Seite gewählt ist, ist auf der anderen gesperrt.
2. **Inhalt** wählen, z. B. „Diagnose (Condition)“ oder „Impfung (Immunization)“. Angeboten werden alle Inhalte, die in beiden vorkommen. Gibt es mehrere Profile bzw. Gruppen pro Typ, wählt man eins aus. Inhalte, für die ein logisches Modell noch keine FHIR-Mappings hat, sind als „nur Strukturübersicht“ gekennzeichnet. Ihre Elemente werden mit Kardinalität, EHDS-Bezug und ValueSet aufgelistet, aber nicht Zeile für Zeile zugeordnet.
3. **Vergleichen.** Das Ergebnis zeigt A und B nebeneinander, Element für Element nach FHIR-Pfad ausgerichtet:
   - **Unterschiedlich:** in beiden vorhanden, aber Kardinalität, Datentyp, ValueSet/Binding, fester Wert/Muster oder Must Support weichen ab. Abweichende Werte sind mit „≠“ markiert. Obligations der EU-Profile (z. B. `SHALL:populate-if-known`) zählen wie Must Support.
   - **Nur in A / Nur in B:** z. B. Extensions oder Elemente, die nur ein MIO genauer festlegt.
   - **Gleich:** standardmäßig ausgeblendet.
   - **Übereinstimmung (Ring):** Anteil der gleich festgelegten Elemente unter denen, die es in beiden gibt. Wie viele Elemente überhaupt gemeinsam sind, steht daneben.

Slices werden über die Extension-URL bzw. ein festes Codesystem zugeordnet, ersatzweise über den Slice-Namen. **Logische Modelle** (ART-DECOR, z. B. ePA EU Patient Summary) werden über ihre FHIR-Mappings verglichen. Elemente ohne Mapping erscheinen gesondert als „nicht zuordenbar“, ValueSets werden dort nur über den Namen abgeglichen.

Teilbarer Link, z. B.: `…/#vergleich/epa-eps/west/Condition`

## Automatischer Import aus mio42-Repositories

Die MIO-Profile für „MIO ↔ MIO“ kommen **ausschließlich aus öffentlichen Repositories** der GitHub-Organisation `mio42-GmbH`. Private Repositories werden nicht genutzt; der Import prüft das vor jedem Download.

- **Quellenliste:** `config/quellen.json`. Ein neuer Eintrag genügt, eine Code-Änderung ist nicht nötig.
  - `ig-package`: veröffentlichtes `package.tgz` eines IG (z. B. `WEST-IG/site/package.tgz`) mit fertigen Snapshots.
  - `validierungspaket`: Profile ohne Snapshot (z. B. `Validierungspaket-MIO-Patientenkurzakte`). Die Snapshots erzeugt der Workflow mit dem HL7 FHIR Validator.
- **Workflow** `.github/workflows/import.yml`: läuft montags automatisch und bei Bedarf per Hand („Actions → MIO-Import → Run workflow“). Er aktualisiert `specs/mio/`, `config/mios.json` und ggf. `samples/` und öffnet dazu einen **Pull Request**. Erst nach deinem Merge geht die Änderung live.
  - Einmalig nötig: *Settings → Actions → General → „Allow GitHub Actions to create and approve pull requests“* aktivieren.
- **Beispieldateien** aus den Repositories werden nur übernommen, wenn sie in `config/quellen.json` unter `freigegebeneBeispiele` stehen. Vorher bitte prüfen, dass sie synthetisch sind.
- **Lokal** (nur IG-Packages, ohne Snapshot-Erzeugung):

```bash
powershell -ExecutionPolicy Bypass -File tools/import.ps1 -Nur west
```

- **Zusätzliche ValueSet-Namen** (z. B. FHIR-Core-ValueSets für den Abgleich mit ART-DECOR-Namen) stehen in `config/valueset-namen.json`.

## Vergleichskategorien

| Kategorie | Bedeutung | Schwere |
|---|---|---|
| **Fehlt** | In der EU gefordert, im MIO nicht vorhanden: Pflicht (min ≥ 1), Must-Support oder Obligation (`SHALL:populate…`) | kritisch / Warnung / Info |
| **Nur im MIO** | In der EU-Spec nicht vorgesehen, z. B. deutsche Extensions | Info / Warnung |
| **Abweichend** | Kardinalität, Datentyp, fester Wert/Muster oder Codesystem (z. B. ICD-10-GM statt SNOMED CT), jeweils mit Ist- und Soll-Wert | kritisch / Warnung / Info |
| **Übereinstimmend** | Vorhanden und passend, standardmäßig ausgeblendet | – |

Jeder Befund enthält den FHIR-Pfad, die Ressource, eine Erklärung, sofern bekannt die deutsche MIO-Bezeichnung und einen Link zur Elementdefinition im EU-IG.

## Grenzen der Prüfung

- Geprüft wird die **Instanz gegen die EU-Profile** (Snapshot). Die MIO-Seite liegt derzeit nur als logisches Modell (ART-DECOR) vor und liefert Zusatzinformationen wie deutsche Bezeichnungen.
- **Terminologie:** Es gibt keinen Terminologieserver. Geprüft wird nur, ob das Codesystem bzw. der Wertebereich zum Binding passt. Die Grundlage dafür ist `specs/<projekt>/eu/binding-hinweise.json`. Einzelne Codes werden nicht gegen das ValueSet geprüft.
- **Slicing:** Ausgewertet werden nur einfache Diskriminatoren (Wert/Muster auf `url` oder Code, Typ von `$this` bzw. `resource`). Slices mit `resolve()` werden nicht aufgelöst.
- **Datentyp-Profile** wie `Address-eu` werden nicht mitgeprüft. Innerhalb nicht aufgeklappter Datentypen werden nur Extensions gemeldet.
- **FHIRPath-Invarianten** (Constraints) werden nicht ausgewertet.
- **Profilwahl je Ressource** in dieser Reihenfolge: `meta.profile` → einziges Profil des Ressourcentyps → passendes Code-Muster → `mapping.json`.

## Neues Projekt hinzufügen

Neue Projekte brauchen **keine Code-Änderung**, nur Daten:

1. Im Ordner `_eingang/` einen Projektordner anlegen, z. B. `_eingang/impfpass-eu-vacc/`. Am einfachsten `pka-eps/` kopieren und umbenennen.
2. Dateien so ablegen, wie sie heruntergeladen wurden, **nicht entpacken**. Was wohin gehört, steht in der `HIER_ABLEGEN.md` des jeweiligen Unterordners:
   - `1_eu-spezifikation/`: `package.tgz` des EU-IG (Pflicht)
   - `2_mio-profile/`: MIO-Package oder ART-DECOR-Export (Pflicht)
   - `3_beispieldateien/`: synthetische Beispiele (optional)
   - `4_mappings-und-doku/`: Mapping-Tabellen, PDFs, Notizen (optional)
3. Das Projekt in `_eingang/projektliste.md` eintragen.
4. In Claude Code schreiben: **„Dateien sind abgelegt“**. Claude sortiert die Dateien dann in `specs/<projekt>/` und `samples/<projekt>/` ein, ergänzt `config/projects.json` und erstellt einen Prüfbericht.

`_eingang/` steht in `.gitignore` und wird **nie veröffentlicht**. Trotzdem gilt: keine echten Patientendaten.

### Dateistruktur je Projekt

```
config/projects.json                Projektliste der App
specs/<projekt>/eu/index.json       Liste der EU-Profile (url, type, datei)
specs/<projekt>/eu/*.json           EU-StructureDefinitions (Snapshot, verschlankt)
specs/<projekt>/eu/binding-hinweise.json   erwartete Codesysteme je ValueSet
specs/<projekt>/mio/model.json      MIO-Modell (deutsche Bezeichnungen, FHIR-Mapping)
specs/<projekt>/mio/valuesets/      MIO-ValueSets
specs/<projekt>/mapping.json        Zuordnung MIO-Profil → EU-Profil
samples/<projekt>/*.xml             synthetische Beispieldateien
```

## Lokal testen

Die App lädt Daten per `fetch()` und muss daher über einen Webserver laufen, nicht als `file://`. Jeder einfache statische Server reicht, z. B.:

```bash
python -m http.server 8080
```

Danach `http://localhost:8080/` öffnen. Den Selbsttest der Vergleichslogik gibt es unter `http://localhost:8080/tests/compare.test.html`.

## Technik

- Rein statisch: HTML, CSS, JavaScript, ohne Build-Schritt und ohne Bibliotheken. Die Schrift „Inter“ kommt über Google Fonts mit System-Fallback.
- `js/fhir-xml.js` liest das XML ein (DOMParser), `js/compare.js` enthält die Vergleichslogik Datei ↔ EU-Spec (ohne DOM), `js/profilvergleich.js` die Logik MIO ↔ MIO (ohne DOM), `js/specs.js` lädt die Daten, `js/app.js` und `js/mio-vergleich.js` steuern die Oberfläche, `js/export.js` den Export.
- `tools/import.ps1` und `tools/snapshots.ps1` übernehmen den Import (PowerShell 5.1 und 7).
- Hell/Dunkel folgt dem System und ist umschaltbar. Die Oberfläche ist per Tastatur bedienbar und zeigt Status immer mit Icon und Text, nicht nur über Farbe.
- Veröffentlicht über GitHub Pages (Branch `main`, Ordner root). `.nojekyll` sorgt dafür, dass alle Ordner ausgeliefert werden.

## Lizenzen und Quellen

- HL7 Europe Patient Summary: CC0-1.0, HL7 Europe (Stand: CI-Build vom 16.10.2026).
- MIO ePA EU Patient Summary: Kassenärztliche Bundesvereinigung (KBV) / mio42.
- Wechselschnittstelle (WeST): mio42 GmbH, `kbv.mio.west` (CC0-1.0), aus dem öffentlichen Repository `mio42-GmbH/WEST-IG`.
- Enthält SNOMED-CT-Codes mit Bezeichnungen (in den MIO-ValueSets und Beispielen). SNOMED CT® ist eine Marke von SNOMED International. Für die Nutzung gelten die Bedingungen der jeweiligen nationalen Lizenz.
