# Frontend-Leitlinien und Entwicklungspfad für den Workspace

> **Überholt seit 2026-11-03:** Die Entscheidung ist jetzt Vue + TypeScript in einem eigenen Client-Verzeichnis mit explizitem Build und Übernahme nach `lib/editor/public/`. Maßgeblich ist der [Vue-Migrationsplan](superpowers/plans/2026-11-03-vue-workspace-client.md). Die folgenden No-Build- und Plain-JS-Migrationsvorschläge dokumentieren den früheren Diskussionsstand; allgemeine Regeln zu Zuständigkeiten und Ressourcen bleiben als Hintergrund nützlich.

Stand: 2026-11-02. Referenzstand der Untersuchung: `0b272379eba16d936fbddbcc98508df0ba53ad46`.

Dieses Dokument ist der Übergabevorschlag für die weitere Frontend-Entwicklung. Es implementiert keine Migration und ist noch keine automatisch geltende AGENTS.md-Anweisung. Vor Umsetzung sind die dann vorhandenen Features und Änderungen zu berücksichtigen.

## 1. Zweck und Rahmen

Der Workspace ist eine ergänzende Bedienoberfläche der CLI-Pipeline. Planung, Generierung, Rendering, Dateiverwaltung, Sperren und fachliche Validierung gehören weiterhin zur Pipeline beziehungsweise zum bestehenden Backend. Die Oberfläche zeigt Ergebnisse, sammelt Eingaben, startet vorhandene Aktionen und beobachtet deren Fortschritt.

Die Anwendung muss mit dem bestehenden Editor-Befehl starten. Browserdateien werden direkt durch Bun ausgeliefert. Für diesen Entwicklungspfad sind kein Frontend-Build, kein zusätzlicher Entwicklungsserver und kein CDN zur Laufzeit erforderlich.

Die Größe der HTML-Datei ist ein Anlass für bessere Zuständigkeiten, kein hinreichender Grund für einen Framework-Wechsel. Ein Framework wird erst eingeführt, wenn es nachweisbar die Synchronisierung von Zustand und Darstellung vereinfacht.

## 2. Beobachteter Ausgangspunkt

- `lib/editor/page.html`: 2.660 Zeilen beim Referenzstand; CSS, HTML und ungefähr 2.200 Zeilen Browser-JavaScript in einer Datei.
- Ansichten: Projektübersicht, Bibliothek, Referenzen, Casting, Sängerzuordnung und Timeline.
- Timeline/Player: zwei Videoelemente mit Vorladen, separate Audiospur, Wiedergabeuhr, Scrubbing, Zoom, Loop, Versionsvergleich und Canvas-Wellenform.
- Daten: JSON-Endpunkte, EventSource für laufende Jobs, zusätzliche periodische Abfragen.
- Zustand und DOM werden explizit synchronisiert: unter anderem `loadProject`, `loadFreshness`, `renderTimeline`, `renderInspector` und `showClip`.
- `lib/editor/project.ts` enthält bereits DTO-artige Typen wie `EditorProject` und `EditorClip`, importiert aber zugleich serverseitige Implementierung.
- `lib/editor/server.ts` besitzt Origin-/Host-Prüfungen und kontrollierte Medienauslieferung einschließlich Range Requests.
- Bestehende Editor-Tests decken vor allem Backend-Verhalten ab. Sie ersetzen keine Browserprüfung der Wiedergabe.

Diese Liste ist eine Ausgangsinventur, keine abschließende Featureliste. Neue Funktionen anderer Agents müssen vor jeder größeren Extraktion ergänzt werden.

## 3. Regeln für neue Frontend-Arbeit

### 3.1 Verantwortlichkeiten

1. Neue Fachlogik gehört in die Pipeline oder ins Backend. Frontend-Validierung dient der schnellen Rückmeldung und ersetzt niemals die Backend-Prüfung.
2. Jede Seite besitzt ihre eigenen Ansichts- und Formularzustände. Gemeinsam genutzte Daten haben genau einen erkennbaren Eigentümer.
3. API-Zugriff, Wiedergabesteuerung und DOM-Darstellung werden getrennt. Die Grenzen folgen Aufgaben; nicht jede kleine Funktion benötigt eine eigene Datei.
4. Neue größere Features werden als native ES-Module entwickelt. Bestehende Funktionen werden nur dann mit extrahiert, wenn sie zur konkreten Änderung gehören oder separat als Refactor beauftragt sind.
5. Keine neue globale Sammlung aus Zustand, DOM-Helfern und fachlichen Aktionen. Kein selbst gebauter Event-Bus, Proxy-Store, Dependency-Injection-Container oder Reaktivitätsmechanismus auf Vorrat.
6. Kein Modul darf durch seinen bloßen Import Timer, Requests oder DOM-Listener starten. Diese Arbeit beginnt in einer expliziten Initialisierung.

### 3.2 Daten und Zustand

Vier Arten von Zustand bleiben unterscheidbar:

| Art | Beispiele | Eigentümer |
| --- | --- | --- |
| Serverdaten | Projekte, Clips, Versionen, Jobstatus | Datenzugriff der jeweiligen Seite bzw. Jobanzeige |
| UI-Zustand | ausgewählte Clip-ID, Tab, Filter, Zoom | betreffende Ansicht |
| Formularentwurf | noch nicht gespeicherte Casting-/Sängeränderungen | Formular |
| Wiedergabe | aktuelle Zeit, aktive Videoseite, Audiouhr, RAF-ID | Player |

- Auswahl wird möglichst über stabile IDs gespeichert, nicht über Objektidentität aus einem vorherigen Server-Snapshot.
- Abgeleitete Werte werden berechnet. Ein zusätzlicher gespeicherter Wert braucht einen konkreten Grund und eine klare Aktualisierungsregel.
- Ein Hintergrund-Refresh darf ungespeicherte Eingaben nicht unbemerkt überschreiben. Entwürfe separat halten; bei konkurrierenden Änderungen Konflikt oder erneutes Laden sichtbar anbieten.
- Veraltete Request-Antworten dürfen kein inzwischen anderes Projekt überschreiben. Abbruch oder eine einfache Anfragegeneration verwenden, wo parallele Abfragen möglich sind.
- Keine neuen Backend-Events oder API-Verträge allein für den Refactor erfinden. Bestehende Polling- und SSE-Semantik zuerst erhalten.

### 3.3 Darstellung und DOM

- Jede Komponente oder Ansicht besitzt einen definierten DOM-Bereich. Fremde Bereiche werden über explizite Funktionen aktualisiert, nicht über verstreute globale Selektoren.
- Texte aus Projekten, Prompts, Dateinamen oder Modellantworten ausschließlich als Text einsetzen. Das bisherige sichere Verhalten von `el()` erhalten; kein `innerHTML` für diese Daten.
- Im Vanilla-Code Änderungen über wenige benannte Funktionen abwickeln, etwa Auswahl ändern, Projektdaten übernehmen, Fortschritt anzeigen. Nicht an jeder Aufrufstelle dieselbe Liste von Render-Aufrufen wiederholen.
- Nur betroffene Bereiche aktualisieren. Player, fokussierte Eingaben und scrollende Logs nicht bei jedem Server-Snapshot neu aufbauen.
- Native Buttons, Eingaben und Dialoge bevorzugen. Tastaturbedienung, Fokus, Beschriftungen, Escape und bestehende Shortcuts erhalten.
- Globale CSS-Variablen und Theme-Regeln bleiben zentral. Feature-Stile durch eindeutige Klassen oder einen Container eingrenzen.
- Die kleine Theme-Initialisierung vor dem ersten Paint darf im HTML bleiben, um einen falschen Theme-Blitz zu vermeiden.

### 3.4 Lebensdauer und Nebenwirkungen

- Initialisierung liefert eine `dispose()`-Funktion zurück, wenn sie Ressourcen anlegt.
- `dispose()` entfernt eigene Listener, schließt eigene EventSource-Verbindungen, beendet Timer/RAF und bricht ausstehende Requests ab, soweit diese der Ansicht gehören.
- Jede Ressource besitzt genau einen Eigentümer. Gemeinsam verwendete Jobüberwachung nicht versehentlich beim Schließen eines untergeordneten Panels beenden.
- Keine SPA-Navigation als Nebenprodukt des Refactors einführen. Bestehende Seitenwechsel, URLs, Queryparameter und Hashes beibehalten.
- Neue Lifecycle-Logik muss auch wiederholtes Initialisieren und Beenden korrekt behandeln. Doppeltes Mounten entweder verhindern oder ausdrücklich unterstützen.

### 3.5 API und Fehler

- Relative Same-Origin-URLs verwenden. Projekt-, Bibliotheks- und Medienpfade zentral und korrekt kodieren; bestehende Versionsparameter erhalten.
- JSON, FormData und Medien nicht durch denselben unpassenden Request-Wrapper zwingen. Insbesondere bei FormData keinen JSON-Content-Type setzen.
- Initiales Laden, Hintergrundaktualisierung und schreibende Aktionen haben unterschiedliche Fehlerfolgen: Startfehler zeigen, vorhandene Daten bei vorübergehendem Refresh-Fehler erhalten, fehlgeschlagene Schreibaktionen klar melden.
- Keine stillen Fehler-Catches bei neuen Benutzeraktionen. Erwartete Abbrüche dürfen still bleiben; wiederkehrende Hintergrundfehler dürfen keine Toast-Flut auslösen.
- Backend-Schutzmaßnahmen, Dateisperren und erlaubte Medienpfade bleiben erhalten. Neue statische Routen dürfen weder Repository noch Projektdateien frei verfügbar machen.

### 3.6 Wiedergabe und häufige Aktualisierungen

- Die bestehende Wiedergabelogik zunächst funktional unverändert extrahieren. Optimierung und Refactor in getrennten Änderungen behandeln.
- Video-/Audioelemente stabil halten. Quellen nur wechseln, wenn sich die tatsächliche Quelle oder Version ändert.
- Die Wiedergabeuhr ist kein globaler UI-Takt. Fortschrittszeiger und Zeittext dürfen pro Frame laufen; Inspector, Cliplisten und Formulare nur bei ihren relevanten Änderungen.
- Vorladen, Audio-Synchronisation, Clipgrenzen, Leerstellen, Finalvideo-Modus, Geschwindigkeit und Loop sind zu erhaltende Funktionen.
- Canvas-Zeichnung bleibt explizit. Ein späteres Framework besitzt den Canvas-Knoten; der Renderer besitzt dessen Zeicheninhalt.

### 3.7 JavaScript und Typprüfung

- Browsercode bleibt direkt ausführbares JavaScript mit relativen `.js`-Imports.
- Öffentliche Modulgrenzen erhalten JSDoc-Typen. Neue/extrahierte Module sollen mit `checkJs` geprüft werden; kein pauschales `any` oder `@ts-nocheck`, um Migrationserfolge vorzutäuschen.
- Dafür eine eigene Browser-Konfiguration vorsehen: `allowJs`, `checkJs`, `noEmit`, DOM-Libraries und Browserquellen. Die aktuelle Root-Konfiguration enthält Bun-Typen und nur `ESNext`; sie darf nicht ungeprüft als Browser-Konfiguration übernommen werden.
- Browserdateien aus der serverseitigen Root-Prüfung ausschließen, falls sie dort sonst mit den falschen Libraries geprüft würden. Beide Prüfungen bleiben ausführbar.
- API-Datentypen können später in ein reines Vertragsmodul ausgelagert werden. Browsercode importiert keine Serverimplementierung mit Dateisystem-, Bun- oder Pipeline-Abhängigkeiten zur Laufzeit.
- JSDoc-Typprüfung ist keine Laufzeitvalidierung von JSON. Keine umfassende Schema-Infrastruktur allein für diesen Refactor hinzufügen.

## 4. Mögliche Modulstruktur

Die Namen sind ein Strukturvorschlag. Beim Umsetzen anhand des aktuellen Codes anpassen; keine leeren Dateien für mögliche zukünftige Funktionen anlegen.

```text
lib/editor/
  page.html                    HTML-Grundgerüst, Theme-Bootstrap
  server.ts                    bestehende API und explizite statische Auslieferung
  frontend/
    app.js                     Route lesen, Shell und genau eine Seite starten
    workspace.css              bestehende Styles und Designvariablen
    api.js                     JSON-/Upload-Zugriff und URL-Helfer
    dom.js                     kleine sichere DOM-Helfer
    shell.js                   Theme, Navigation, Serverauswahl
    dialogs.js                 gemeinsam verwendete Dialoge und Toasts
    run-dock.js                Jobaktionen, SSE, Logs und Aufräumen
    pages/
      home.js
      library.js
      references.js
      casting.js
      singers.js
      timeline.js              Zusammensetzung der Timeline-Ansicht
    timeline/
      state.js                 Zustand dieser Ansicht, keine globale Framework-Kopie
      playback.js              Mediensteuerung und Wiedergabeuhr
      tracks.js                Clipdarstellung, Auswahl, Zoom, Scrubbing
      waveform.js              Canvas-Darstellung
      inspector.js             Detailanzeige und zugehörige Aktionen
      review.js                Versionsvergleich und Review, sofern eigenständig
```

Abhängigkeiten fließen von `app` zu Seiten und von Seiten zu ihren Modulen. Kleine DOM-/API-Helfer importieren keine Seiten. Module der Timeline importieren nicht gegenseitig ihre vollständigen Controller. Die Seite verbindet sie mit wenigen expliziten Callbacks.

Eine Signatur wie `mountCasting(root, {api, projectId}) -> {dispose}` beschreibt die Grenze. Konkrete Argumente nur hinzufügen, wenn die Implementierung sie benötigt. Keine generische Basisklasse für alle Seiten.

## 5. Schrittweiser Übergang ohne Funktionsverlust

### Schritt A: Aktuellen Stand erfassen

- [ ] Aktuellen Commit und Working-Tree-Status dokumentieren; lokale Änderungen anderer Agents nicht überschreiben.
- [ ] Alle inzwischen vorhandenen Ansichten, Aktionen, Datenquellen und URL-Varianten inventarisieren.
- [ ] Das delta zwischen Referenzstand dieses Dokuments und aktuellem Stand prüfen, insbesondere `page.html`, `server.ts`, Editor-Tests und Paket-/Typecheck-Konfiguration.
- [ ] Bestehende Editor-Tests und Typprüfung ausführen; bereits vorhandene Fehler getrennt festhalten.
- [ ] Repräsentative Musik- und Filmprojekte sowie leere/fehlende Medien für Browserprüfungen bestimmen. Schreibende Prüfungen nur an eigens vorbereiteten Testprojekten durchführen.

### Schritt B: Auslieferung und mechanische Trennung

- [ ] CSS und Modulskript zunächst weitgehend mechanisch auslagern. Reihenfolge, DOM-IDs und Verhalten erhalten.
- [ ] Root-absolute Asset-URLs verwenden, damit verschachtelte Projektseiten dieselben Assets laden.
- [ ] Statische Route auf den vorgesehenen Frontend-Ordner beziehungsweise erlaubte Dateien begrenzen; passende MIME-Typen und während der Migration `no-cache` verwenden.
- [ ] Tests für HTML-Verweise, erreichbare JS-/CSS-Dateien, unbekannte Assets, unzulässige Pfade und erhaltene Origin-Prüfungen ergänzen.
- [ ] Den bisherigen Test, der `prefers-color-scheme` im HTML sucht, auf die ausgelieferte CSS-Ressource umstellen. Nicht nur die Assertion entfernen.
- [ ] Alle vorhandenen Einstiegs-URLs direkt im Browser laden; keine fehlenden Imports oder MIME-Fehler.

### Schritt C: Einen vollständigen Bereich abgrenzen

- [ ] Casting als überschaubaren ersten Kandidaten prüfen; falls dieser inzwischen stark verändert wurde, eine andere abgeschlossene Ansicht wählen und den Grund dokumentieren.
- [ ] Zustand, API-Zugriff, Darstellung und Ressourcenbesitz dieser Ansicht erfassen.
- [ ] Die Ansicht in ein Modul mit expliziter Initialisierung und Aufräumen überführen.
- [ ] Laden, Änderungen, Speichern, Fehler und erneutes Öffnen prüfen.
- [ ] Browser-Typprüfung für diesen Bereich etablieren. Keine repo-weite Typbereinigung mit diesem Schritt vermischen.

### Schritt D: Weitere Ansichten und gemeinsame Funktionen

- [ ] Bestehende Seiten nacheinander extrahieren; nur tatsächlich gemeinsame Helfer teilen.
- [ ] Jobanzeige und SSE-Lebensdauer explizit machen, einschließlich Log-Cursor und Wiederverbindungsverhalten.
- [ ] URL-/History-Verhalten und Schutz ungespeicherter Sängeränderungen erhalten.
- [ ] Nach jeder Ansicht einen überprüfbaren, startfähigen Stand hinterlassen.

### Schritt E: Timeline und Player zuletzt

- [ ] Aktuelle Zustandsfelder und alle Leser/Schreiber erfassen.
- [ ] Wiedergabesteuerung zuerst isolieren, ohne Synchronisationsalgorithmus und Medienwechsel gleichzeitig neu zu entwerfen.
- [ ] Danach Tracks, Canvas und Inspector abgrenzen.
- [ ] Hintergrundaktualisierung während Playback, Scrubbing, Vergleich und Formulareingabe prüfen.
- [ ] Erst bei belegtem Bedarf Berechnung oder Darstellung optimieren; keine behaupteten Performancegewinne ohne Messung.

## 6. Späterer Weg zu einem reaktiven Framework

### Entscheidungsauslöser

Ein Pilot ist sinnvoll, wenn nach der Modultrennung weiterhin mehrfach dieselben Render-Aufrufe gepflegt werden, abhängige Anzeigen regelmäßig veralten oder Formulare und Detailpanels viel Synchronisationscode benötigen. Dateigröße allein ist kein Auslöser.

### Vorauswahl unter der Vorgabe „kein eigener Build“

| Kandidat | Passung | Grenze |
| --- | --- | --- |
| Vue 3 als Browser-Modul | Durchgehend reaktive Ansichten, Formulare und Komponenten | Templates im Browser; keine `.vue`-Dateien ohne zusätzlichen Verarbeitungsschritt |
| Lit | Einzelne eigenständige UI-Komponenten mit expliziten Eigenschaften | Anpassung der CSS-Grenzen, insbesondere bei Shadow DOM; expliziterer Zustandsfluss |
| Alpine.js | Begrenzte reaktive Ergänzungen vorhandener HTML-Bereiche | Für große zusammengesetzte Editor-Komponenten weniger überzeugend |

Vue 3 ist der Ausgangskandidat für einen Pilot mit einer vollständigen reaktiven Ansicht. Lit ist die Alternative, wenn dauerhaft einzelne native Custom Elements gewünscht sind. Nicht mehrere neue UI-Bibliotheken gleichzeitig einführen. Svelte wäre neu zu bewerten, falls die Vorgabe ohne Build später bewusst aufgegeben wird.

### Pilot und Integration

1. Eine bereits abgegrenzte Ansicht wie Casting wählen; den Player nicht als ersten Versuch verwenden.
2. Eine geprüfte feste Bibliotheksversion einschließlich benötigter Abhängigkeiten lokal ausliefern. Herkunft, Version und Lizenz dokumentieren. Kein CDN oder beweglicher Versionsalias zur Laufzeit.
3. Den bisherigen DOM-Bereich dieser Ansicht vollständig dem Framework übergeben. Vanilla-Code darf dessen Kinder anschließend nicht parallel verändern.
4. Dieselben API-Funktionen, URLs und Datenverträge verwenden. Auswahl und Formularentwürfe in den lokalen reaktiven Zustand übernehmen.
5. Server-Snapshots explizit übernehmen. Speichern und Render-Start bleiben Benutzeraktionen; kein Effekt darf durch eine beobachtete Zustandsänderung unbeabsichtigt einen Pipeline-Job starten.
6. Vorher/nachher vergleichen: weniger Synchronisationsstellen, nachvollziehbare Komponenten, gleiche Funktionen, keine zusätzlichen Startschritte, offline nutzbar.
7. Bei negativem Ergebnis Pilot zurücknehmen; API-, Player- und Modultrennung bleiben unabhängig davon nützlich.
8. Bei positivem Ergebnis weitere Ansichten einzeln migrieren. Gemeinsamen State-Manager oder Router erst bei konkretem Bedarf ergänzen.

Ein späterer Framework-Player darf vorhandene Videoelemente nicht bei jedem Update ersetzen. Für Frame-Zeit, Canvas und Mediensteuerung bleiben explizite Controller sinnvoll. Reaktivität ersetzt keine Medienuhr.

## 7. Zusammenarbeit bei laufender Entwicklung

- Dieses Dokument ist bewusst kein Patch gegen eine eingefrorene Version. Vor jeder Extraktion aktuelle Änderungen lesen; nach neu hinzugekommenen Features erneut nach Zustandszugriffen und Listenern suchen.
- Die zentrale `page.html` sollte während ihrer Extraktion genau einen zuständigen Agent haben. Andere Agents dürfen ihre Änderungen weiter vorbereiten, müssen betroffene Funktionen und neue Zustandsfelder für die Integration kenntlich machen.
- Keine parallelen großflächigen Formatierungen. Mechanische Verschiebung, funktionale Verbesserung und Framework-Pilot als getrennte Änderungen halten.
- Nach der ersten Trennung Zuständigkeiten nach Dateien/Features vergeben. Gemeinsam bearbeitete Dateien wie `app.js`, `server.ts` und Typkonfiguration explizit koordinieren.
- Eingehende Änderungen nicht durch Rücksetzen auf den Referenzstand beseitigen. Neue Funktionen in die passende Zuständigkeit übertragen und die Funktionsinventur aktualisieren.
- Ein Modulrefactor darf vorübergehend einen größeren Restblock hinterlassen. Neue Architektur darf nicht verlangen, dass alle laufenden Features gleichzeitig umgeschrieben werden.
- Kein Push, Merge, Versand an andere Agents oder Ersetzen bestehender Arbeit wird durch dieses Dokument automatisch beauftragt.

## 8. Prüfungen und Abnahmekriterien

Vor und nach der betroffenen Umsetzung:

```powershell
git status --short
bun test ./lib/editor
bun run typecheck
```

Nach Einrichtung einer separaten Browser-Konfiguration zusätzlich beispielsweise:

```powershell
bunx tsc --noEmit -p tsconfig.frontend.json
```

Die Datei und der Aufruf sind vor Verwendung tatsächlich anzulegen und in der Projektdokumentation zu beschreiben. Bestehende Root-Checks müssen weiterhin funktionieren. Keine Abhängigkeit mit unkontrolliertem Versionsupdate nur zum Ausführen eines Checks nachinstallieren.

Gezielte Verhaltenstests statt Tests auf private Funktionsnamen oder exakte Dateilängen schreiben. Für browserabhängiges Verhalten vorhandene Browser-Testwerkzeuge verwenden; falls keine bestehen, zunächst eine reproduzierbare manuelle Prüfung dokumentieren. Eine neue Testplattform ist eine eigene begründete Entscheidung.

Browser-Abnahme:

- [ ] Start ohne Frontend-Build und ohne Internet; alle sechs bekannten sowie inzwischen hinzugefügten Ansichten erreichbar.
- [ ] Direkte Projekt-/Unterseiten-URLs, Hash-Auswahl, Übersichtfilter und Browser-Zurück funktionieren wie zuvor.
- [ ] Theme, Serverauswahl und gespeicherte Quellenpräferenz bleiben erhalten.
- [ ] Play/Pause, Clipwechsel, Vorladen, Seek, Loop, Geschwindigkeit, Mute und Finalvideo-Modus funktionieren.
- [ ] Wellenform, Zoom, Auswahl, Mehrfachmarkierung und Tastaturbefehle funktionieren.
- [ ] Fehlende Medien, leere Projekte und API-Fehler führen zu verständlichen Zuständen.
- [ ] Speichern, Versionsvergleich und Wiederherstellung funktionieren an Testdaten.
- [ ] Render-Start/-Stop, Status, Logs und Aktualisierung nach Jobende funktionieren an kontrollierten Testdaten beziehungsweise einem geeigneten Stub; keine unbeabsichtigten kostenpflichtigen Render-Jobs.
- [ ] Hintergrund-Refresh erhält Wiedergabe, Fokus und ungespeicherte Eingaben.
- [ ] Wiederholtes Öffnen/Schließen erzeugt keine doppelten Listener, Timer oder SSE-Verbindungen.
- [ ] Keine neuen Browser-Konsolenfehler; Pipeline und bestehende Sicherheitsgrenzen unverändert wirksam.

## 9. Übergabeauftrag an einen ausführenden Agent

> Lies dieses Dokument und die aktuell geltenden Repository-Anweisungen. Prüfe zuerst den aktuellen Stand einschließlich neuer Features und uncommitteter Änderungen. Erstelle daraus eine aktualisierte Funktionsinventur und bearbeite die beauftragte Etappe in kleinen, funktional überprüfbaren Schritten. Behalte native Browsermodule, direkte Bun-Auslieferung, bestehende URLs und Pipeline-Verantwortlichkeiten bei. Führe ohne gesonderten Auftrag keinen Framework-Pilot aus. Berichte pro Etappe über verschobene Zuständigkeiten, erhaltene Funktionen, durchgeführte Prüfungen und verbleibende Risiken. Überschreibe keine parallel entstandene Arbeit.

## 10. Quellen für eine spätere Framework-Entscheidung

- Vue ohne Build: https://vuejs.org/guide/quick-start.html#using-vue-from-cdn
- Lit-Voraussetzungen: https://lit.dev/docs/tools/requirements/
- Alpine-Zustand: https://alpinejs.dev/essentials/state

Vor einem Framework-Pilot aktuelle Version, Browseranforderungen und lokale Auslieferung erneut prüfen. Diese Leitlinien legen bewusst keine heute recherchierte Paketversion für eine spätere Migration fest.
