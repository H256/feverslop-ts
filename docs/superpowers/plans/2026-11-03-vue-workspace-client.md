# Vue Workspace Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Die genannten Skill-Namen stammen aus dem Planformat. Falls sie in der ausführenden Umgebung fehlen, die dort verfügbaren Plan-Ausführungs-/Review-Skills verwenden. Dieser Auftrag ist zunächst nur ein Plan; keine Agents starten und keine Implementierung allein durch Lesen dieses Dokuments beginnen.

**Goal:** Die vollständige vorhandene Workspace-Oberfläche als Vue-Client in `client/` abbilden, dessen Produktionsbuild nach `lib/editor/public/` kopiert und vom bestehenden Bun-Server ausgeliefert wird.

**Architecture:** Vue besitzt Darstellung und UI-Zustand. Der bestehende Bun-Server behält JSON-API, SSE, Medienauslieferung und die gemeinsame Änderungslogik mit der CLI. Ein expliziter Build erzeugt und installiert statische Dateien; der normale Editor-Start kompiliert nichts.

**Tech Stack:** Vue 3, TypeScript, Vue Single-File Components mit Composition API und `<script setup>`, Vite, Vue Router, Bun für Backend und Paketverwaltung; Vitest/Vue Test Utils für Clienttests, Playwright für echte Browserprüfungen.

---

## 1. Verbindlicher Ausgangspunkt

Untersucht am 2026-11-03 auf **`97bb1f4`**, nach `git fetch origin` und Fast-Forward dieses Worktrees auf `origin/main`. Die früher diskutierten Konflikte mit #535/#536 und dem Timing-Editor sind keine ausstehenden Migrationen mehr: Die entsprechenden Funktionen liegen im aktuellen Code.

`lib/editor/page.html` hat jetzt **3.561 Zeilen**. Zu migrieren sind neun Ansichten: Übersicht, Bibliothek, Timeline, Story/Screenplay, Casting, Singers, Timing, Look und References. Die Zahl ist eine Inventur des Referenzstands, kein Grund, neuere Funktionen zu übergehen.

Zusätzliche aktuelle Funktionen, die in älteren Plänen fehlen:

- Vorproduktion in Stufen und Bilder bereits auf der Look-Stufe.
- Story an den Cast anpassen, Vorschlag vergleichen, annehmen oder verwerfen.
- Cast und Look einschließlich selektiv neu zu erzeugender Texte bearbeiten.
- Sängerwechsel innerhalb einer Zeile.
- Wort-/Zeilen-Timing mit Wellenform, Undo, Abhören, Speichern und erneutem Schneiden.
- CLI-Gegenstücke für GUI-Änderungen und `lib/editor/cli-first.test.ts` als Architekturprüfung.

**Vorrang:** Dieser Plan ersetzt die frühere Vorgabe „kein Frontend-Build“ aus `docs/frontend-guidelines.md`. Dessen Regeln zu Zuständigkeiten, Ressourcen, Entwürfen und sicherer Darstellung bleiben sinnvoll. Der frühere Plain-JS-Zwischenrefactor ist keine Vorbedingung mehr; gezielte Extraktionen erfolgen direkt im Zuge der Vue-Migration.

## 2. Entscheidungen und Grenzen

### Festgelegt

1. `client/` ist ein eigenes privates Paket mit eigenem `package.json` und `bun.lock`. Keine Umstellung der gesamten Pipeline auf ein Monorepo-Werkzeug.
2. Client-Dependencies werden explizit installiert. Root-`bun install` bleibt für die CLI ausreichend; `bun run client:install` installiert zusätzlich den Client.
3. `client/dist/` ist der reine Build-Ausgang. `lib/editor/public/` ist ausschließlich die installierte, generierte Serverkopie.
4. Vue, Router und sämtliche Browserassets werden lokal gebündelt. Keine CDN-Abhängigkeit im Betrieb.
5. Ein Produktions-Client genügt; kein SSR, Nuxt, Electron, Tauri, Service Worker oder Offline-Cache.
6. Zunächst kein Pinia, Axios, Query-Framework, UI-Kit oder Tailwind. Bestehende Gestaltung und native Browser-APIs erhalten.
7. Keine fachliche Neuentwicklung und kein Redesign innerhalb der Migration. Alle vorhandenen bestätigungspflichtigen Aktionen bleiben bewusst ausgelöste Aktionen.
8. Die Pipeline bleibt ohne den Client installierbar und benutzbar. Frontend-Werkzeuge dürfen nicht in ihre Runtime-Abhängigkeiten gelangen.
9. Die exakten kompatiblen Paketversionen werden beim Scaffold geprüft, festgehalten und durch das Client-Lockfile reproduzierbar gemacht. Keine ungeprüften `latest`-Abhängigkeiten in einem übergebenen Endstand.

### Änderungen am Entwicklungsablauf

Nach einer frischen Installation des Quellcodes ist der Client einmal zu bauen. Nach Änderungen am Client wird erneut gebaut. `bun run editor` startet nur Bun und verwendet das vorhandene Artefakt. Ein fertiges Distributionspaket kann die Dateien bereits enthalten.

Die erste Implementierung verwendet bewusst den Produktionsbuild als Entwicklungs-/Integrationsweg. Ein Vite-HMR-Server ist optionaler späterer Komfort, keine zweite notwendige Runtime. Das hält API, SSE und Medien von Anfang an unter derselben Origin.

## 3. Zielstruktur und Verantwortlichkeiten

```text
client/
  package.json
  bun.lock
  index.html
  vite.config.ts
  tsconfig.json                 DOM, Vite-Typen, keine Bun-Globals
  tsconfig.node.json            Build-/Test-Konfiguration separat
  src/
    main.ts
    App.vue
    router.ts
    styles/workspace.css        übernommene Gestaltung und Theme-Variablen
    api/
      http.ts                   JSON, FormData, Abbruch, Fehlernormalisierung
      workspace.ts              benannte Endpunkt-Funktionen
      urls.ts                   Projekt-/Bibliotheks-/Medien-URLs
    composables/
      useProject.ts             Projekt-Snapshot, Freshness, Status und Reload
      useRun.ts                 SSE, Log-Cursor, Runstatus und Aktionen
      useServers.ts             Serverauswahl und Statuspolling
      useUnsavedChanges.ts      Router-Guard und beforeunload
    components/
      WorkspaceShell.vue
      ProjectNavigation.vue
      StageBar.vue
      RunDock.vue
      ConfirmDialog.vue
      MediaViewer.vue
      ToastHost.vue
    pages/
      HomePage.vue
      LibraryPage.vue
      StoryPage.vue
      CastingPage.vue
      LookPage.vue
      ReferencesPage.vue
      SingersPage.vue
      TimingPage.vue
      TimelinePage.vue
      NotFoundPage.vue
    features/
      timeline/
        state.ts
        playback.ts             Mediencontroller, keine Vue-Template-Logik
        canvas.ts               Ruler/Wellenform zeichnen
        TimelineTracks.vue
        PlayerMonitor.vue
        PlaybackControls.vue
        ClipInspector.vue
        VersionCompare.vue
        ReviewPanel.vue
      timing/
        draft.ts                lokale Timing-Entwürfe und Undo
        TimingWaveform.vue
      singing/
        SingerLine.vue
  tests/
    unit/
    components/
    e2e/
    fixtures/                   synthetische DTOs, kleine kontrollierte Medien
  playwright.config.ts
  dist/                         generiert, ignoriert

shared/workspace/
  contracts.ts                  browserneutrale Request-/Response-Typen

tools/
  build-client.ts               geprüfter Build + Installation des Artefakts
lib/editor/
  server.ts                     bestehender Router, API und Medien
  static.ts                     begrenzte Auslieferung des Client-Artefakts
  static.test.ts
  client-build.ts               prüfbare Validierung/Übernahme des Builds
  client-build.test.ts
  public/                       generiert, ignoriert
  page.html                     nur während der Übergangsphase
tests/workspace/
  startup.test.ts               vorhandene echte CLI-Startprüfung hierher verlagern
```

Keine leeren Platzhaltermodule anlegen. Ein Dateisplit muss einen tatsächlich eigenständigen Verantwortungsbereich abbilden. Falls der Inspector zu groß wird, dessen Panels fachlich aufteilen, statt eine zweite monolithische Datei zu schaffen.

## 4. Build und Übergabe an Bun

### Pfade und URL-Namensraum

- Buildquelle: `client/` relativ zum Repository, unabhängig vom aktuellen Prozessverzeichnis.
- Vite-Ausgang: `client/dist/`.
- Installiertes Ziel: `lib/editor/public/`.
- Öffentlicher Asset-Präfix: **`/workspace-assets/`**.
- Vue-Router-Basis: **`/`**, unabhängig vom Asset-Präfix.
- `GET /` und erlaubte Projektseiten liefern `public/index.html`; die darin referenzierten JS-/CSS-Dateien kommen beispielsweise von `/workspace-assets/assets/index-<hash>.js`.

Vite-Konfiguration als verbindlicher Ausgangspunkt:

```ts
import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: '/workspace-assets/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    manifest: true,
    sourcemap: false,
  },
})
```

Das Vite-Manifest dient der Buildvalidierung; Bun muss daraus kein HTML zusammensetzen. Bun liefert die von Vite erzeugte `index.html` direkt. Der Router darf nicht mit `import.meta.env.BASE_URL` initialisiert werden, weil dieser Wert hier den Asset-Präfix enthält. Für den Router ausdrücklich `createWebHistory('/')` verwenden.

### Vorgesehene Befehle

Root-`package.json` erhält:

```json
{
  "client:install": "bun install --cwd client --frozen-lockfile",
  "client:check": "bun run --cwd client check",
  "client:build": "bun tools/build-client.ts",
  "client:test": "bun run --cwd client test",
  "client:e2e": "bun run --cwd client test:e2e",
  "test": "bun test ./lib ./comfy",
  "test:workspace": "bun run client:build && bun test ./tests/workspace"
}
```

Client-Scripts:

```json
{
  "check": "vue-tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json",
  "build": "bun run check && vite build",
  "test": "vitest run",
  "test:e2e": "playwright test"
}
```

Beim ersten Scaffold wird das Client-Lockfile einmal durch eine reguläre Installation erzeugt; danach verwenden Setup und CI `--frozen-lockfile`. Root-`test` wird bewusst begrenzt, damit Bun weder Vitest- noch Playwright-Tests ausführt. Nach heutigem Stand liegen sämtliche bisherigen Backendtests in `lib/` und `comfy/`; diese Annahme vor Änderung erneut prüfen.

`tools/build-client.ts` muss `--help` über das vorhandene CLI-System unterstützen, wenn es als Root-Script mit `bun … .ts` eingetragen wird: `lib/cli.test.ts` findet solche Scripts automatisch. Dafür `client:build` in `lib/cli.ts` beschreiben und im Tool vor jeder Build-Arbeit `cli('client:build')` aufrufen.

### Buildübernahme, Ausfälle und laufender Server

1. Build im Client-Verzeichnis ausführen und Exitcode prüfen. Keine automatische Paketinstallation im Build oder Editor-Start.
2. Nach erfolgreichem Build `index.html` und `.vite/manifest.json` validieren. Die referenzierten Einträge, Imports, CSS und Assets müssen innerhalb von `dist` existieren; Pfade und Symlinks dürfen nicht nach außen führen.
3. Vollständige Kopie in ein temporäres Geschwisterverzeichnis von `public` schreiben. Nicht zuerst das funktionierende `public` löschen.
4. Kopie prüfen; altes `public` als Backup umbenennen, Staging-Verzeichnis als `public` einsetzen. Bei fehlgeschlagener Installation Backup wiederherstellen und mit Fehler abbrechen.
5. Nur selbst angelegte, nachweislich unter dem vorgesehenen Editor-Verzeichnis liegende temporäre Ordner entfernen. Insbesondere unter Windows keine rekursiven Operationen auf ungeprüften berechneten Pfaden.
6. Produktionsupdates erfolgen bei gestopptem Editor, danach Neustart und Browser-Reload. Der Verzeichnistausch ist kein Versprechen für unterbrechungsfreie Updates; Windows-Dateisperren und alte Lazy-Chunk-URLs sind zu berücksichtigen.

Dies ist eine kleine lokale Buildinstallation, kein neues Deployment-System. Keine Release-Datenbank, Hintergrund-Synchronisierung oder automatischen Garbage-Collector dafür einführen.

### Versionierung und Distribution

`client/dist/`, `lib/editor/public/`, Staging-/Backup-Verzeichnisse, Client-Caches und Browser-Testreports werden ignoriert. Quellcode und beide Lockfiles werden versioniert.

Für einen Quellcheckout dokumentieren:

```text
bun install --frozen-lockfile
bun run client:install
bun run client:build
bun run editor
```

Für einen späteren vorgebauten Download werden das Repo-Paket und genau sein gebautes `lib/editor/public/` zusammen ausgeliefert. Der bestehende `.github/workflows/release.yml` erzeugt aktuell nur Releases/Notizen und kann historische Tags durchlaufen. Er darf nicht pauschal Client-Builds für alle alten Tags verlangen. Ein eigener Build-Artefakt-Job für unterstützte Tags oder ein gesonderter Paketierungsschritt ist eine nachgelagerte Arbeit; weder ein Desktop-Installer noch automatischer Download ist für diese Migration nötig.

## 5. Auslieferung und Routing

### Serveränderung

`lib/editor/static.ts` exportiert einen Handler mit explizit übergebbarem Public-Verzeichnis für Tests. Standardpfad über `import.meta.dir`, nicht über `process.cwd()` ermitteln. Das ist wichtig, weil Projektdaten weiterhin über das Arbeitsverzeichnis gefunden werden und die Startup-Tests aus einem leeren Temp-Verzeichnis starten.

Reihenfolge in `server.ts`:

1. Bestehende Host-, Methoden- und Origin-Prüfungen.
2. Bestehende globale API und Bibliotheks-API.
3. Bestehende Projekt-API und Medien-/Thumbnail-Routen, inklusive Target-Prüfung und Range Requests.
4. `/workspace-assets/…` an den begrenzten statischen Handler.
5. Erlaubte UI-Routen an `index.html`.
6. Alles andere: `404`.

Keine generische SPA-Fallback-Regel vor API/Medien/Assets. Ein fehlendes Script liefert `404`, nicht `200 text/html`.

| Anfrage | Erwartetes Ergebnis |
| --- | --- |
| `/`, `/library` | Vue-Einstiegs-HTML |
| `/p/music/:id/`, `/p/film/:id/` | Vue-HTML nach bestehender Projektprüfung |
| dieselben Pfade mit `story`, `casting`, `singers`, `timing`, `look`, `references` | Vue-HTML; Seite behandelt fachliche Verfügbarkeit |
| `/api/*`, `/p/:kind/:id/api/*` | bestehende API-Antwort, niemals HTML-Fallback |
| `/library/media/*`, `/library/thumb/*`, projektbezogene Medien | bestehende Handler |
| `/workspace-assets/assets/<hash>.js` | JS mit richtigem MIME-Typ |
| unbekanntes Asset / `.map` / `.vite/*` / Traversal / fremder Pfad | `404` bzw. bestehende Ablehnung |
| fehlendes Projekt | weiterhin `404` |

Aktuell rendert der Server bei manchen unbekannten Projekt-Unterpfaden ebenfalls die alte Seite, die dann auf Timeline fällt. Der neue Router soll unbekannte Unterseiten ausdrücklich als nicht gefunden behandeln. Diese kleine bewusst gewählte Verhaltensänderung in Tests und PR nennen; gültige bestehende URLs bleiben unverändert.

HTML: `Cache-Control: no-cache`. Von Vite gehashte Assets: langfristig `immutable`. Nicht gehashte Dateien: `no-cache`. `HEAD` liefert dieselben Header wie `GET`, aber keinen Body. Statische Pfade einmal kontrolliert dekodieren, null bytes/Backslashes/absolute Pfade und Traversal ablehnen; das tatsächlich aufgelöste Ziel einschließlich Symlinks muss im Public-Verzeichnis liegen.

### Fehlender Build

Im finalen Vue-Modus schlägt der normale CLI-Start bei fehlender `public/index.html` mit einer klaren Meldung und dem Befehl `bun run client:build` fehl. `--help` und Missing-Project-Prüfung werden davor ausgeführt, damit CLI-Hilfe ohne Clientinstall funktioniert.

Ein direkt instanziierter HTTP-Handler bleibt für API-Tests benutzbar; eine angefragte UI-Seite ohne Build liefert `503` mit kurzer Build-Anleitung. Kein stiller Rückfall auf eine zufällig veraltete Legacy-Oberfläche nach Abschluss der Migration.

### Router und Navigation

Vue Router erhält explizite Routen für die neun Ansichten. Queryparameter der Übersicht (`q`, `kind`, `state`, `page`) sowie Clip-/Referenz-Hashes und `#line-N` im Timing-Editor bleiben erhalten. Trailing Slashes konsistent behandeln.

Beim Wechsel von Projekt A zu B dieselbe Komponente nicht mit alten Requests weiterlaufen lassen: Projekt-Session über `(kind,id)` neu anlegen oder gezielt beobachten und vorher entsorgen. Filteränderungen oder Hashwechsel dürfen keine unnötige komplette Remount-Kette auslösen.

Ungespeicherte Änderungen benötigen sowohl `beforeunload` als auch Router-Guards. Ein `beforeunload` allein greift bei SPA-Navigation nicht. Browser-Zurück/Vorwärts und Wechsel zwischen zwei Projekt-IDs sind eigene Abnahmefälle.

## 6. API-Verträge und CLI-first

`shared/workspace/contracts.ts` enthält ausschließlich browserneutrale Typen. Zuerst tatsächlich über HTTP transportierte Typen aus `project.ts`, `singing.ts`, `timing.ts`, `preproduction.ts`, `library.ts`, `references.ts`, `progress.ts` und `runs.ts` inventarisieren. Nur benötigte DTOs verschieben; Servermodule können sie für bestehende Imports re-exportieren.

Keine Client-Runtime-Imports aus `lib/editor/project.ts` oder `runs.ts`: diese Module enthalten Filesystem-/Pipeline-Abhängigkeiten. Auch Typimporte nicht durch einen großen Server-Abhängigkeitsgraphen ziehen, wenn ein kleines neutrales DTO genügt. Gemeinsame Typen vermeiden Drift, validieren aber keine JSON-Antworten zur Laufzeit.

Insbesondere nicht blind `RunAction` als erlaubte Browser-API kopieren: Der aktuelle Server akzeptiert `/run` nur für seine explizite Aktionsmenge, einschließlich `plan`, `look-pictures` und `adapt-story`. Direkte Text-/Zuordnungsänderungen besitzen eigene CLI-first-Routen. `promptFile` und vom Server ermittelte Look-Zustände sind interne Felder, keine frei sendbaren Clientparameter.

Endpunkt-Inventur für die Implementierung:

| Bereich | Bestehende Endpunkte/Verträge |
| --- | --- |
| Übersicht/Server | `/api/projects`, `/api/servers` |
| Bibliothek | `/api/library/assets`, `/api/library/create` (FormData), `/api/library/run-events` |
| Projektdaten | `project`, `freshness`, `status`, `waveform`, `progress` unter Projekt-API |
| Jobs | `run-events`, `run`, `stop`, `estimate`; Planung/Bilder auf Look-Stufe/Story-Anpassung über `run` mit `plan`/`look-pictures`/`adapt-story` |
| Story | `book`, `book/for-cast`, `book/drop-proposal`; Generierung über die genannten `run`-Aktionen |
| Cast/Look | `cast`, `look`, `casting`, `casting-redo` |
| Sänger/Timing | `singing`, `timing`, `timing-wave` |
| Referenzen/Versionen | `references`, `references/:id/rerender`, `references/:id/pick`, `versions/:id`, `versions/:id/pick` |
| Film-Auswahl | `override/:id` |

Die exakten aktuellen POST-Routen vollständig aus `server.ts` übernehmen; die Tabelle ersetzt diese Prüfung nicht. Bestehende Schreibfunktionen bleiben die Quelle für erlaubte Änderungen, betroffene Schritte und Projektlocks. `cli-first.test.ts` muss unverändert in seiner Aussage bestehen. Keine neue Businesslogik in Vue-Composables und kein Aufweichen dieses Tests, um eine Migration grün zu bekommen.

## 7. Reaktivität und Lebensdauer

- API-Snapshots in `shallowRef` ablegen und vollständig ersetzen; große Clip-/Wellenformdaten nicht ohne Bedarf tief proxifizieren.
- Auswahl über IDs halten. `computed` leitet ausgewählten Clip, Filterergebnisse und Summen ab.
- Formulare bekommen eigene Entwürfe und eine geladene Ausgangsversion. Polling überschreibt keine Dirty-Entwürfe.
- Einfache lokale Zustände über `ref`/`reactive`; geteilte Services werden in der Shell/Projekt-Session angelegt und per Props/Injection bereitgestellt. Keine versteckten modulgroßen Singletons mit aktiven Timern.
- HTTP-Requests pro Ansicht mit `AbortController` beziehungsweise Generation-Check. Abbruch ist kein Benutzerfehler; echte Lade-/Speicherfehler sind sichtbar.
- Initialfehler, vorübergehender Refreshfehler und Schreibfehler getrennt behandeln. Bereits geladene Daten bei vorübergehendem Fehler behalten.
- Projektpolling zunächst wie bisher ungefähr alle zehn Sekunden bei sichtbarer Seite sowie bei Fokus; Fortschritt während Runs ungefähr alle zwei Sekunden. Keine überlappenden Polls aufstauen.
- SSE-Cursor pro Projekt/Bibliothek verwalten, nicht beim Projektwechsel wiederverwenden. Auf Reconnect keine doppelten Logzeilen. Der bestehende Serververtrag mit `after`, `lines.next` und `state` ist maßgeblich; prüfen, ob eine neue Verbindung mit fortgeschriebenem Cursor nötig ist.
- RunDock und Logbuffer bleiben begrenzt. Auto-Scroll nur, wenn der Benutzer vorher am Ende war.
- Beim Unmount: EventSource schließen, Timer/RAF stoppen, Observer trennen, Pointer- und Tastatur-Listener entfernen und ausstehende Requests abbrechen. Das beendet die Beobachtung, nicht den serverseitigen Job.
- Native `EventSource`, `fetch`, `<dialog>`, `<video>`, `<audio>` und Canvas weiter verwenden.
- Textinterpolation statt `v-html` für Prompt, Story, Namen, Logs und API-Fehler.

### Mediencontroller

`playback.ts` erhält Referenzen auf zwei stabile Videoelemente und das Audioelement sowie explizite Methoden für Play/Pause/Seek/Quelle/Geschwindigkeit/Loop/Dispose. Projektwechsel beendet seine Session. Gleiche Quelle lädt nicht bei jedem Snapshot neu.

Die Zeitquelle bleibt die bisherige Priorität: Finalvideo, Song, aktiver Clip oder Uhr für Lücken. Vorladen und Umschalten der beiden Videos, Audio-Driftkorrektur, leere Clips und Fallback-Poster erhalten. Keine Neuentwicklung dieses Algorithmus im selben Commit wie seine Extraktion.

Pro Frame nur Playhead, Zeittext und notwendige Medienzustände aktualisieren. Der Inspector und alle Clips dürfen nicht von einem globalen 60-Hz-Signal abhängen. Canvas zeichnet imperativ in einem von Vue bereitgestellten stabilen Element. Vue besitzt dessen Lebensdauer, der Renderer den Inhalt.

## 8. Funktionsparität als Abnahmematrix

| Ansicht/Bereich | Zwingend zu erhalten | Regressionsprüfung |
| --- | --- | --- |
| Shell | Theme vor erstem Paint, lokale Präferenzen, Serverwahl, Hilfe, Toasts, Dialoge | Reload/Systemtheme, Keyboard/Fokus, abbrechen ohne POST |
| Übersicht | Musik/Film, Statusfilter, Suche, Gruppierung von Takes, Pagination, URL-Zustand, Planungsstufe | Query direkt laden, Back/Forward, leere Liste |
| Bibliothek | Filter, Details, Verwendung, Upload, Erzeugen und Jobanzeige | FormData, Fehler, leere Bibliothek, kein Job ohne Bestätigung |
| Story | Musik bearbeiten, Film read-only, Stufen, neu schreiben, Cast-Vorschlag vergleichen/annehmen/verwerfen | Backend meldet betroffene Schritte; Dirty-Entwurf bleibt bei Refresh |
| Casting | Bibliothekszuordnung, direkte Bearbeitung, Hinzufügen/Entfernen nur wenn erlaubt, Umbenennen und Story-Folgen | Musik und Film separat, `casting-redo`, gesperrtes Projekt |
| Look | Gesamtlook, Einzeltexte, selektives Neuschreiben, Speichern/Planen, frühe Bilder | Datenverlustwarnung, selektive Aktion statt Vollreset |
| References | Bilder, Viewer, Prompt, Anchor, Rerender, Versionen, Export/Add-view soweit vorhanden | URL-Versionierung, nur bestätigte Aktionen |
| Singers | Zeilen/Teilzeilen, Trennstellen, Sängerwechsel, Abhören, Speichern, Planen | Split/Join, Undo/Verwerfen soweit vorhanden, Dirty-Navigation |
| Timing | feine Wellenform, Wort/Zeile ziehen, Keyboard, Undo, Auswahlhash, Abhören, Save/Plan/Re-cut | keine unzulässige Wortüberlappung, identische POST-Semantik, Warnung vor Re-cut |
| Timeline/Player | Clips/Final/Preview/Varianten, Vorladen, Audio, Zoom, Scrub, Loop, Speed, Shortcuts | kontrollierte lokale Medien, DOM-Identität bei Refresh |
| Inspector/Review | Prompt/Shots/Refs/Overrides, Renderoptionen, Retake, Refinish, Versionen, Vergleichen, Markierungen | Clip-/Shotgrenzen, Auswahl bleibt, Modale schließen pausiert Medien |
| Runs | Start/Stop, externe Runs, Fortschritt, Logs, Fehler, Wiederholen/Nächster Schritt | SSE-Reconnect, Projektwechsel, kein doppelter Start |

Vor Umsetzung die matrix mit tatsächlichen Labels/Aktionen des aktuellen Codes abgleichen. Neue Features werden ergänzt, nicht stillschweigend als außerhalb des Plans behandelt.

## 9. Teststrategie und Toolgrenzen

### Backend und Buildinstallation

- Bestehende Tests unter `lib/` und `comfy/` bleiben Bun-Tests.
- Statischer Handler wird mit einem winzigen temporären Buildfixture getestet, nicht mit einem bei jedem Unit-Test neu gebauten Vue-Client.
- Bestehende HTML-Tests auf tatsächlich ausgelieferte Assets umstellen: `prefers-color-scheme` steht künftig im CSS, nicht zwingend in `index.html`.
- Die bisherige echte CLI-/HTTP-Startprüfung aus #537 nach `tests/workspace/startup.test.ts` verschieben und auf den gebauten Client aktualisieren. `test:workspace` baut vorher; der Test darf fehlende Artefakte nicht still überspringen.
- Separater Test für fehlenden Build: CLI-Hilfe funktioniert, normaler Start erklärt den Build-Befehl. Für diesen Test ein isoliertes Source-/Serverfixture verwenden, nicht `public` im Entwicklercheckout vorübergehend löschen.
- Root-Typecheck schließt `client/**` und generierte Artefakte aus. Gemeinsame Contracts bleiben geprüft; Browser-DOM-Libraries nicht global in die Pipeline-Typecheck-Konfiguration mischen.

### Client

- Vitest für URL-Erzeugung, Auswahl/Entwürfe, SSE-Cursorverhalten, Timing-Undo und Controllerzustand.
- Vue Test Utils für relevante Benutzerinteraktionen: Dirty-Formulare, Bestätigungen, Datenübernahme und eingeschränkte Filmfunktionen.
- Playwright gegen **Bun + installierten Produktionsbuild**, nicht ausschließlich gegen Vite. Das erfasst kopierte Assets, direkte Deep Links, MIME, History und Same-Origin-Anbindung.
- API-Antworten und schreibende Requests für UI-Szenarien kontrolliert stubben; mindestens ein echter Empty-Workspace-Test gegen das Backend. Keine LLM-/GPU-Aufrufe aus automatischen Tests.
- Medienfixtures sind klein und synthetisch. Browsermedien-Kompatibilität wirklich prüfen; Stubtests allein beweisen weder Codec-Wiedergabe noch Audio-Synchronisation.
- Nach jeder Seite gezielte Checks, am Ende vollständige Backend-/Client-/Browsermatrix. Keine wiederholten Volltests ohne neue Änderungen oder offenen Verdacht.

Minimaler statischer Regressionstest als Form des Vertrags:

```ts
// fixturePublic enthält index.html und assets/app-123.js.
const handler = editorHandler({publicDir: fixturePublic, ui: 'vue'})
expect((await handler(new Request('http://localhost/'))).status).toBe(200)
const missing = await handler(new Request('http://localhost/workspace-assets/assets/missing.js'))
expect(missing.status).toBe(404)
expect(missing.headers.get('content-type')).not.toContain('text/html')
expect((await handler(new Request('http://localhost/api/nothing'))).status).toBe(404)
```

`editorHandler` hat diese Optionssignatur heute noch nicht. Sie wird in Phase 2 eingeführt; das Fixture wird im Test selbst erzeugt und bereinigt.

## 10. Umsetzung in überprüfbaren Etappen

Jede Etappe endet mit einem startfähigen Stand und fokussierten Tests. Bei produktivem Verhaltenscode zuerst einen relevanten fehlschlagenden Test schreiben, dann implementieren. Keine sinnlosen Tests für reine Dateiverschiebungen.

### Phase 0 — Inventur und Referenzprüfung

**Dateien:** aktuelles `page.html`, `server.ts`, `runs.ts`, Workspace-Anleitung, Editor-Tests; neue `client/MIGRATION.md` als knapper Fortschrittsnachweis.

- [ ] Aktuellen Main/Working Tree prüfen und Änderungen seit `97bb1f4` lesen.
- [ ] Vollständige Routen-/POST-/Funktionsinventur gegen Abschnitt 8 abhaken.
- [ ] `bun test ./lib/editor` und `bun run typecheck` als Baseline ausführen; vorhandene Fehler separat notieren.
- [ ] Reproduzierbare Testfälle für Musik, Film, Vorproduktion, fehlende Medien und leeren Workspace festlegen. Keine privaten Projektdaten als Fixture committen.
- [ ] Aktuelle Ansichtsscreenshots als Vergleich aufnehmen, ohne sie als alleinige Verhaltensprüfung zu verwenden.

**Gate:** Alle neun Ansichten und aktuellen Schreibaktionen sind einer Migration und einem Prüfpunkt zugeordnet.

### Phase 1 — Clientpaket und sichere Artefaktübernahme

**Anlegen:** `client/package.json`, Lockfile, Vite-/TS-Konfiguration, `index.html`, `src/main.ts`, `App.vue`; `tools/build-client.ts`, `lib/editor/client-build.ts` und Tests.
**Ändern:** Root-Scripts, `.gitignore`, Root-TSConfig, CLI-Hilfe und Entwicklungsdokumentation.

- [ ] Mit kompatiblen stabilen Vue/Vite/TypeScript-Versionen scaffolden und Tool-Laufzeitanforderungen dokumentieren. Bun als Package Manager ist nicht automatisch eine Zusicherung für jede Buildtool-Runtime.
- [ ] Client-Check/Build lokal ausführen; keine Pipelineimports im Browserbundle.
- [ ] Tests für erfolgreiche Übernahme, fehlende Entry-Datei, fehlende Manifestreferenz, Pfadflucht und fehlgeschlagenen Austausch schreiben.
- [ ] Kopier-/Rollbacklogik implementieren; fehlgeschlagener Build erhält das vorherige Public-Verzeichnis bytegleich.
- [ ] Root-/Client-Testdiscovery trennen; `client:build --help` startet keinen Build.
- [ ] Build vom Root und mit explizitem abweichendem cwd testen; Ziel bleibt dasselbe Repository-Public-Verzeichnis.

**Gate:** Ein reproduzierbares leeres Vue-Artefakt wird installiert; keine bestehende GUI ist ersetzt.

### Phase 2 — Bun-Auslieferung und Übergangsschalter

**Anlegen:** `lib/editor/static.ts`, `static.test.ts`.
**Ändern:** `server.ts`, `editor.ts`, betroffene Servertests und CLI-Dokumentation.

- [ ] Statische Handler-Tests aus Abschnitt 5 einschließlich Windows-Traversal, Symlinks, HEAD, Cache und Deep Links implementieren.
- [ ] Temporären prozessweiten Schalter `FEVERSLOP_EDITOR_UI=legacy|vue` einführen; während der Migration ist `legacy` der Default. Nicht aus Queryparametern oder persistenten Browsereinstellungen ableiten.
- [ ] In Vue-Modus Build prüfen und öffentliche Routen ausliefern. Bestehende API-, Host-/Origin- und Medienprüfungen unverändert erhalten.
- [ ] Legacy und Vue bei Bedarf in getrennten Prozessen/Ports mit denselben kontrollierten Testdaten vergleichen. Nicht beide DOM-Systeme auf derselben Seite initialisieren.
- [ ] Für die bestehenden Seite-Tests explizite Fixtures bzw. Legacy-Modus wählen, bis die jeweiligen Erwartungen umgestellt sind.

**Gate:** Vue-Shell und Legacy sind gezielt wählbar; API-Tests und CLI-first-Prüfung bleiben grün.

### Phase 3 — Verträge, Shell, API und Runs

**Dateien:** `shared/workspace/contracts.ts`, API-Module, Composables, Shell-/Dialog-/Run-Komponenten, Router und Theme-CSS.

- [ ] DTOs browserneutral machen und Serverimports kompatibel halten. Backendprüfung nach jeder zusammengehörigen Typgruppe.
- [ ] HTTP-Client für JSON/FormData/Abbruch implementieren; Error-Body und HTTP-Status erhalten.
- [ ] Theme-Bootstrap vor erstem Paint, Layout und vorhandene CSS-Variablen übernehmen.
- [ ] Serverauswahl samt bestehendem localStorage-Schlüssel erhalten.
- [ ] Bestätigungsdialoge und Toasts mit Fokus-/Escape-Verhalten portieren.
- [ ] RunDock/SSE mit Cursor, begrenztem Log und Scopewechsel testen.
- [ ] Router-Guards und Request-/Ressourcen-Cleanup zentral als kleine Composables bereitstellen.

**Gate:** Keine unbeabsichtigte Mutation beim Mounten; Netzwerkfehler und Ressourcenlebensdauer sind getestet.

### Phase 4 — Übersicht und Bibliothek

**Dateien:** `HomePage.vue`, `LibraryPage.vue`, zugehörige API-Funktionen und Tests.

- [ ] Übersicht inklusive Gruppierung, Statusabfragen, Suche, Pagination und URL-Zustand portieren.
- [ ] Bibliothek mit Details, Verwendungsstellen, Upload und Jobanzeige portieren.
- [ ] Browser-Smoke gegen das installierte Artefakt: `/`, `/library`, Reload, Back/Forward, leere Daten und keine Console-Errors.
- [ ] FormData- und Bestätigungsablauf durch Request-Assertions prüfen.

**Gate:** Erster vollständiger vertikaler Ausschnitt funktioniert unter Bun; keine fehlenden Buildassets.

### Phase 5 — Vorproduktion und Referenzen

**Dateien:** `StoryPage.vue`, `CastingPage.vue`, `LookPage.vue`, `ReferencesPage.vue`, `StageBar.vue` und Tests.

- [ ] Story und Cast-Vorschläge einschließlich Annahme/Verwerfen vollständig portieren.
- [ ] Casting: Bibliothekswahl und direkte Bearbeitung als getrennte Abläufe erhalten; Umbenennungs-/Story-Folgen anzeigen.
- [ ] Look: individuelle Texte, `Write anew`, Gesamtlook und Bilder vor Shot-Planung erhalten.
- [ ] References: Anchor-/Sheet-/Versionsaktionen und Viewer vollständig übernehmen.
- [ ] Für jede Aktion den tatsächlich gesendeten Request gegen den vorhandenen Vertrag prüfen.
- [ ] Dirty-Entwürfe bei Refresh, Projektwechsel und Back/Forward testen; Filmrestriktionen sichtbar erhalten.

**Gate:** CLI-first-Test besteht; Frontend berechnet keine eigenen Pipeline-Abhängigkeiten.

### Phase 6 — Singers und Timing

**Dateien:** `SingersPage.vue`, `SingerLine.vue`, `TimingPage.vue`, `TimingWaveform.vue`, `draft.ts` und Tests.

- [ ] Sänger-Teilzeilen einschließlich Trennstellen, Zuordnung und Abhörfunktion portieren.
- [ ] Timing-Editor als eigene View mit lokalem Draft/Undo und unabhängigem Audio-/Canvas-Lifecycle aufbauen.
- [ ] Zeilen-/Wortgrenzen und Keyboard-/Pointerinteraktion entsprechend dem aktuellen Code übernehmen.
- [ ] Save, Save and plan und Save and cut again bleiben getrennte Aktionen; Re-cut bleibt bestätigt und serverseitig definiert.
- [ ] Hashnavigation, Dirty-Guards, Save-Fehler und Observer-/Audio-Cleanup im Browser testen.

**Gate:** Kein Verlust der gerade integrierten #522/#523-Funktionen.

### Phase 7 — Timeline, Player, Inspector und Review

**Dateien:** `TimelinePage.vue` und `features/timeline/*`.

- [ ] Vorhandene Medienalgorithmen in `playback.ts` übernehmen; zunächst Controller-Verhalten testen.
- [ ] Stabile Video-/Audioelemente in `PlayerMonitor` anbinden; Canvas separat halten.
- [ ] Tracks, Zoom, Scrub, Mehrfachmarkierung, Loop und Shortcuts portieren.
- [ ] Inspector, Overrides, Retake/Refinish, Vergleich und Review einschließlich Nach-Render-Abläufen portieren.
- [ ] Neue Projekt-Snapshots übernehmen, ohne Player-DOM, Auswahl, Fokus oder laufende Wiedergabe unnötig zurückzusetzen.
- [ ] Echte kleine Medien im Browser prüfen: Clipgrenze, Audiowechsel, leere Stelle, Finalvideo, Preview/Variante, Geschwindigkeit und Loop.
- [ ] Häufige Zeitupdates auf ihre betroffenen Elemente begrenzen; nur bei beobachtetem Problem zusätzlich optimieren.

**Gate:** Funktionsmatrix vollständig; Medienverhalten durch tatsächliche Wiedergabe belegt.

### Phase 8 — Standard umschalten, Tests und Dokumentation abschließen

**Ändern:** `editor.ts`, `server.ts`, Root-Scripts, `README.md`, `docs/development.md`, `docs/workspace-guide.md`, Startup-Tests.

- [ ] Vue zum Default machen und die fehlender-Build-Meldung aktivieren.
- [ ] Echten CLI-Startup-Test nach `tests/workspace` verschieben; `test:workspace` baut vor dem Test. Behauptung „Editor startet nach Root-Install ohne Build“ aus älterer Doku korrigieren.
- [ ] Alle neun Ansichten und direkten URLs gegen Produktionsbuild abnehmen.
- [ ] Root-Typecheck, Backendtests, Client-Typecheck, Clienttests und Browsertests ausführen.
- [ ] Frischen Export mit beiden Frozen-Lockfile-Installationen, Build, Übernahme und Start prüfen.
- [ ] Nach bestätigter Parität Legacy-Schalter und `page.html` in einem eigenen nachvollziehbaren Cleanup-Commit entfernen. Kein dauerhafter zweiter Frontend-Stack.
- [ ] Leitlinien auf Vue/SFC/TypeScript und expliziten Build aktualisieren; alte No-Build-/Plain-JS-Migrationsanweisungen als überholt markieren.
- [ ] Diff prüfen: keine Pipelinefachlogik, keine privaten Fixtures, keine generierten Artefakte, keine versehentlich abgeschwächten CLI-first-Tests.

**Gate:** Fertiger Client wird allein durch Bun ausgeliefert; Rollback erfolgt über vorherigen Code samt dazu passendem Build.

## 11. Review-, Koordinations- und Abnahmeregeln

- Main vor Beginn und vor Integration jeder größeren Etappe erneut prüfen. Keine ungeprüfte Annahme, dass nach dieser Planung keine GUI-Funktionen mehr hinzukommen.
- Ein Verantwortlicher für `server.ts`, Root-Konfiguration, Contracts und Router. Feature-Arbeit kann nach Einrichtung dieser Grenzen getrennt erfolgen; parallele Änderungen an denselben Verträgen ausdrücklich koordinieren.
- Kleine Commits nach grünen fachlichen Etappen. Keine Komplettformatierung des Backends.
- Unabhängiger Review der Artefaktübernahme/statischen Pfade und des finalen Player-Lifecycles.
- Die Implementation ist erst abgeschlossen, wenn die komplette Funktionsmatrix geprüft ist. Ein startendes Vue-Gerüst oder ein eingeschlossener Legacy-Monolith ist kein fertiger Ersatz.
- Fehlende Browser-/Audio-/Codec-Nachweise als offen melden; nicht durch erfolgreiche Typechecks ersetzen.

Abschlusskommandos, sobald alle vorgesehenen Scripts existieren:

```text
bun install --frozen-lockfile
bun run client:install
bun run typecheck
bun run client:check
bun run test
bun run client:test
bun run test:workspace
bun run client:e2e
git diff --check
```

Playwrights Browserinstallation ist ein expliziter Test-Setup-Schritt im Client, keine Voraussetzung für den normalen Editorbetrieb. Die E2E-Konfiguration startet einen isolierten Bun-Prozess mit Testdaten und beendet ihn nach Abschluss; kein vorhandener Benutzerprozess wird wiederverwendet oder gestoppt.

## 12. Quellen und Begründung

- Vue empfiehlt für SFC-Projekte Vite und eine gesonderte TypeScript-/Template-Prüfung: https://vuejs.org/guide/scaling-up/tooling.html
- Vite unterstützt konfigurierbare Build-Verzeichnisse und Manifest-Erzeugung: https://vite.dev/config/build-options.html
- Backend-Anbindung: https://vite.dev/guide/backend-integration
- HTML5-Routing erfordert passende Serverauslieferung bei direkten Aufrufen: https://router.vuejs.org/guide/essentials/history-mode.html

Die hier gewählte Lösung liefert Vites fertiges HTML aus; die komplexere Manifest-basierte HTML-Generierung eines Template-Backends ist nicht erforderlich.

**Bewertung: ACCEPT WITH CONDITIONS.** Voraussetzung sind vollständige Funktionsparität, geprüfte Artefaktübernahme und statische Auslieferung sowie unveränderte CLI-first-Fachlogik. Ein zusätzlicher Client-Build ist ausdrücklich akzeptiert; ein zweiter Server im normalen Betrieb ist es nicht.
