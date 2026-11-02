# Anleitung: der Workspace

Der Workspace zeigt alle Projekte und Filme im Browser. Du siehst ein Video als Ganzes auf einer Timeline und kannst einzelne Teile neu rendern, ohne dass der Plan sich ändert. Diese Anleitung beschreibt die typischen Abläufe, die Beschriftungen stehen so da, wie die Seite sie zeigt. Alle Optionen im Detail stehen in der [README](../README.md#the-workspace).

## Starten

```powershell
bun run editor
```

Dann http://127.0.0.1:4173/ öffnen. Mit `bun run editor <id>` startest du direkt in einem Projekt, `--film` nimmt einen Film, `--port=4174` einen anderen Port. Die Seite ist nur auf diesem Rechner erreichbar.

Alles, was rendert, ist die normale CLI: Die Seite startet sie nur. Solange ein Lauf an einem Projekt arbeitet, ist es gesperrt, egal ob du ihn hier oder im Terminal gestartet hast. Einen Lauf aus dem Terminal kannst du hier verfolgen und stoppen.

Drei Dinge gelten überall:

- **Vor jedem Render fragt die Seite nach.** Der Dialog nennt, was passiert, was es ungefähr kostet und welche anderen Clips betroffen sind. Unter **Render on** wählst du die Server. Ohne **Start** oder **Render it** passiert nichts.
- **Alte Fassungen gehen nicht verloren.** Eine ersetzte Fassung wird weggelegt und bleibt auswählbar.
- **`?`** zeigt alle Tasten und erklärt die Begriffe.

## Die wichtigsten Begriffe

| Begriff | Bedeutung |
|---|---|
| **Stale** | Aus einem anderen Prompt, Bild oder Startframe gemacht, als der Plan jetzt hat. Die Datei ist noch brauchbar und wird nur auf deinen Wunsch neu gerendert. |
| **Pinned** | Eigene Datei, geänderter Prompt oder älter als diese Prüfung. Die Pipeline lässt sie in Ruhe. |
| **Goes on** | Der Clip beginnt auf dem letzten Frame des Clips davor. Wird der neu gerendert, passt der Anfang nicht mehr. |
| **Anchor** | Das eine Bild, von dem eine Person oder ein Ort ausgeht. |
| **Sheet** | Das Referenzbild mit mehreren Ansichten, aus einem kurzen Video vom Anchor gemacht. |
| **Take** | Projekte, deren Namen sich nur durch Datum oder Endung unterscheiden. Sie liegen auf der Startseite in einer Karte. |

## Ein Projekt finden

![Startseite mit Projektkarten](images/workspace/home.jpg)

Jede Karte zeigt, wie weit ein Projekt ist und was als Nächstes käme. Oben filterst du nach Art (**Music videos**, **Films**) und Zustand (**Running**, **Failed**, **Unfinished**, **Done**) und suchst über **Find a project**. Oben rechts siehst du, welche Render-Server erreichbar und wie ausgelastet sie sind. Ein Klick auf die Karte öffnet die Timeline.

## Ein Video ansehen

![Timeline mit Monitor und Clip-Details](images/workspace/timeline.jpg)

- **Oben links** läuft das Video, **unten** liegt die Timeline mit Abschnitten, Ton, Clips und gesungenen oder gesprochenen Zeilen.
- **Rechts** stehen die Details des gewählten Clips: **Prompt**, **Shots**, **References**, **Render** und **Versions**.
- **Rechts neben der Abspielzeit** wählst du, was läuft: das fertige Video oder **Clips over the song**, also die einzelnen Clips. Zum Beurteilen von Clips nimmst du Letzteres, denn ein fertiges Video zeigt die Clips so, wie sie beim Zusammenbau waren.

Nützliche Tasten: `Leertaste` spielt und pausiert, `←` und `→` springen zum vorigen oder nächsten Clip, `,` und `.` gehen einen Frame zurück oder vor, `O` wiederholt den Clip in Schleife.

Über der Timeline steht, wie viele Clips fehlen oder stale sind. **Only flagged** blendet alle anderen ab, `‹` und `›` springen von einem auffälligen Clip zum nächsten. **Scan for backdrops** sucht ohne GPU nach grauen Studio-Hintergründen in den Clips.

## Einen Clip neu rendern

1. Clip auf der Timeline anklicken.
2. Rechts den Reiter **Render** öffnen.
3. **Preview** ist der billige Test: wenige Schritte, wenige Pixel, in einem eigenen Ordner. Ein echter Clip wird dabei nie ersetzt.
4. **Render again** rendert den ganzen Clip neu. Der Dialog nennt die geschätzte Dauer und warnt, wenn andere Clips auf diesem aufbauen.
5. Nach dem Render öffnen sich alte und neue Fassung nebeneinander.

![Alte und neue Fassung nebeneinander](images/workspace/compare.jpg)

**Play both from the start** spielt beide synchron. Gefällt dir die alte besser, nimmst du **Go back to the old one**. Später geht das im Reiter **Versions** mit **Compare** (das Fenster im Bild, dort heißt der Knopf **Make the right one current**) oder direkt mit **Make current**.

### Nur einen Teil neu rendern

Ist nur eine Stelle schlecht, gibst du im Reiter **Render** unter **Render a part again** die Sekunden an und klickst **Render this part**. Hat der Clip mehrere Shots, gibt es dafür je einen Knopf. Der übrige Clip bleibt erhalten, das fertige Video wird dabei nicht neu zusammengebaut.

> **Vorsicht:** Das ist noch nicht erprobt. Auf der Radeon lief dieser Job in den Speicherfehler, und ein Versuch hat den Server abstürzen lassen. Bei einem Film geht ein Teil mit Dialog nicht, weil der Ton dort am Bild hängt.

## Mehrere Clips auf einmal

![Timeline mit drei markierten Clips](images/workspace/marked.jpg)

1. Mit `Strg`+Klick markierst du einzelne Clips, mit `Umschalt`+Klick alle bis zu diesem Clip. **Mark flagged** markiert alle auffälligen.
2. Über der Timeline erscheinen **Render marked**, **Preview marked** und **Clear**.
3. Während des Laufs zeigt jeder Clip auf der Timeline, ob er wartet, rendert oder fertig ist.

## Clips durchgehen und entscheiden

![Review mit Tastenleiste unter dem Bild](images/workspace/review.jpg)

**Review** spielt die markierten Clips nacheinander in Schleife ab. Ist nichts markiert, nimmt es die auffälligen, sonst alle.

| Taste | |
|---|---|
| `Enter` | passt, nächster Clip |
| `R` | neu rendern: merken, nächster Clip |
| `←` | zurück |
| `C` | mit der älteren Fassung vergleichen |
| `Esc` | Review beenden |

Am Ende bleiben genau die mit `R` gemerkten Clips markiert, und die Seite fragt, ob sie gerendert werden sollen.

## Einen Lauf verfolgen oder stoppen

![Laufender Render mit Leiste am Seitenende](images/workspace/run.jpg)

Am unteren Rand steht, was gerade läuft und wie viele Clips fertig sind. **Log** zeigt die Ausgabe der CLI, **Stop** beendet den Lauf. Fertige Dateien bleiben, und Jobs, die schon auf einem Server liegen, nimmt der nächste Lauf wieder auf.

**Wenn etwas schiefgeht:** Bei bekannten Fehlern steht über der Timeline in Klartext, was passiert ist und was zu tun ist, daneben **Repeat**. Andere Fehler zeigt das **Log**. Der häufigste Fall ist `out of memory`: Dann nimmst du einen anderen Server oder renderst kürzer oder kleiner, statt denselben Job noch einmal zu schicken.

## Referenzbilder ändern

![Referenzseite mit Karten und Details](images/workspace/references.jpg)

Unter **References** liegen alle Personen, Orte und Requisiten. Rechts stehen Prompt, Ansichten, ältere Fassungen und die Clips, die das Bild benutzen.

- **New sheet, same anchor**: dieselbe Person, andere Ansichten.
- **New anchor**: eine andere Person oder ein anderer Ort, alles danach wird neu.
- **Prompt ändern** und dann rendern: Das Bild bleibt danach gepinnt, der Prompt im Plan bleibt, wie er war.
- **Make current** holt eine ältere Fassung zurück.

Bei einem gepinnten Bild sind die Render-Knöpfe gesperrt. Clips, die das Bild benutzen, werden danach stale, aber nicht von selbst neu gerendert: Das entscheidest du auf der Timeline.

## Besetzung und Bibliothek

![Casting-Seite mit einer Auswahl je Rolle](images/workspace/casting.jpg)

**Casting** zeigt jede Rolle und jeden Ort mit einer Auswahl: **Rendered in this project** oder ein Asset aus der Bibliothek. Eine Änderung schreibt nur einen Eintrag in `casting.json`. Wirksam wird sie mit dem nächsten Planlauf (**Plan now**). Die betroffenen Clips werden dann stale, gerendert wird nichts von selbst.

**Library** (oben rechts) zeigt alle Assets und wo sie benutzt werden. **New asset from a picture** legt eines aus einem Bild an. Aus einem Projekt heraus geht es unter **References** mit **Put into the library**. Ein vorhandenes Asset wird dabei nie überschrieben.

## Ein älteres Projekt aufwerten

![Refinish-Dialog](images/workspace/refinish.jpg)

**Refinish** über der Timeline macht ein fertiges Projekt größer, flüssiger und farblich wie die neueren, aus den vorhandenen Clips. Es läuft kein Plan und kein Prompt ändert sich. `videos/` und das fertige Video bleiben, wie sie sind: Jede Variante bekommt einen eigenen Ordner und eigene Dateinamen.

| Auswahl | Was passiert | Aufwand |
|---|---|---|
| **Grade and sharpen only** | Farbe und Schärfe | keine GPU |
| **48 fps, grade and sharpen** | dazu Zwischenbilder | etwa 15 Minuten für 37 Clips auf der Radeon |
| **Full HD by a refine pass, 48 fps, grade and sharpen** | dazu der zweite Render-Pass auf jedem Clip | etwa 6 s pro Frame auf der Radeon, also viele Stunden für ein ganzes Projekt |
| **Say it one by one** | alles einzeln wählen | |

So gehst du sinnvoll vor:

1. **Einen oder zwei Clips markieren**, am besten einen mit Gesang. Mit Markierung entstehen nur die größeren Clips, kein fertiges Video. Das lohnt sich also nur mit einer Variante, die vergrößert: Ohne Vergrößerung entsteht dabei gar nichts.
2. **Refinish** öffnen und die Variante starten.
3. Im Reiter **Render** unter **Larger versions** auf **Compare with the original** klicken und **mit Ton** ansehen. Refine kann Münder leicht verändern. Prüfe auch Clips mit *Goes on*, weil jeder Clip für sich bearbeitet wird und es am Übergang springen kann.
4. Passt es, ohne Markierung für das ganze Projekt starten. Fertige Clips werden nicht noch einmal gemacht.

Die Varianten erscheinen in der Auswahl neben der Abspielzeit als **Clips: refine-fullhd** und die fertigen Videos als **Refinish refine-fullhd 48 fps finished**. Die Optionen für das Terminal stehen in der [README](../README.md#making-an-older-project-over).

## Tasten

![Fenster mit allen Tasten und Begriffen](images/workspace/keys.jpg)

`?` zeigt dieses Fenster auf jeder Timeline.
