# Anleitung: der Workspace

Der Workspace zeigt alle Projekte und Filme im Browser. Du siehst ein Video als Ganzes auf einer Timeline und kannst einzelne Teile neu rendern, ohne dass der Plan sich ändert. Diese Anleitung beschreibt die typischen Abläufe, die Beschriftungen stehen so da, wie die Seite sie zeigt. Alle Optionen im Detail stehen in der [README](../README.md#the-workspace).

## Starten

```powershell
bun run editor
```

Dann http://127.0.0.1:4173/ öffnen. Mit `bun run editor <id>` startest du direkt in einem Projekt, `--film` nimmt einen Film, `--port=4174` einen anderen Port. Die Seite ist nur auf diesem Rechner erreichbar. Beim ersten Start, und nach einem Pull, der die Seite geändert hat, baut `bun run editor` sie vorher neu (ein paar Sekunden, dafür braucht es Node.js).

Alles, was rendert, ist die normale CLI: Die Seite startet sie nur. Solange ein Lauf an einem Projekt arbeitet, ist es gesperrt, egal ob du ihn hier oder im Terminal gestartet hast. Einen Lauf aus dem Terminal kannst du hier verfolgen und stoppen.

Drei Dinge gelten überall:

- **Vor jedem Render fragt die Seite nach.** Der Dialog nennt, was passiert, was es ungefähr kostet und welche anderen Clips betroffen sind. Unter **Render on** wählst du die Server. Ohne **Start** oder **Render it** passiert nichts.
- **Alte Fassungen gehen nicht verloren.** Eine ersetzte Fassung wird weggelegt und bleibt auswählbar.
- **`?`** zeigt alle Tasten und erklärt die Begriffe.

## Die Leiste oben

Die Leiste oben liest sich von links nach rechts:

- **Links** steht, wo du bist: **Projects** (die Startseite) und **Library**, in einem Projekt dahinter sein Name.
- **Daneben** liegen die Seiten des Projekts als Reiter: **Timeline**, **Story** (beim Film **Screenplay**), **Casting**, **Singers** und **Timing** (nur bei Musikvideos, in denen gesungen wird), **Look**, **Direction**, **References**, **Settings**.
- **Rechts** steht der Rechner: welche Render-Server erreichbar und wie ausgelastet sie sind, das Farbschema und die Version des Workspace.

Darunter steht auf der Timeline eine schmale Zeile mit dem Zustand des Projekts: Art, ob das fertige Video aktuell ist, ob der letzte Lauf fehlgeschlagen ist (mit **Repeat**), fehlende oder stale Bilder (ein Klick führt zu **References**) und **Next:** mit dem nächsten Schritt. Führt der nächste Schritt über eine Seite, etwa weil Regie-Anweisungen nach einer Neuplanung geprüft werden müssen, öffnet **Next** diese Seite, statt etwas zu starten (siehe [Nach einer Neuplanung](#nach-einer-neuplanung)).

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

Jede Karte zeigt, wie weit ein Projekt ist und was als Nächstes käme. Oben filterst du nach Art (**Music videos**, **Films**) und Zustand (**Running**, **Failed**, **Unfinished**, **Done**) und suchst über **Find a project**. Ein Klick auf die Karte öffnet die Timeline.

## Ein Projekt in Stufen planen

Ein neues Projekt planst du am besten so, wie ein Film entsteht: erst das Buch, dann die Besetzung, dann der Look, dann die Einstellungen. Erst danach wird gerendert. So änderst du die Figuren, bevor irgendetwas auf ihnen aufbaut, und lange bevor GPU-Zeit anfällt.

| Stufe | Was entsteht | Wo du es ansiehst |
|---|---|---|
| **Story** (beim Film: **Screenplay**) | die Geschichte aus Songtext und Story-Idee, beim Film das Drehbuch | **Story** |
| **Cast** | Figuren und Orte, beim Musikvideo auch, wer welche Zeile singt | **Casting**, **Singers** |
| **Look** | der Look des Videos, das Aussehen jeder Figur und jedes Orts, auf Wunsch die Bilder dazu | **Look**, **References** |
| **Shot plan** | die Beats auf dem Song und die Einstellungen jedes Clips | **Timeline** |

Oben auf **Story** und **Casting**, und auf der Timeline eines Projekts ohne Clips, steht eine Leiste mit den Stufen. Erledigte Stufen sind abgehakt. Der Knopf rechts plant die nächste Stufe und hält dann an, zum Beispiel **Plan the cast**. **Plan everything** plant ohne Halt bis zu den Einstellungen. Das alles macht nur das Sprachmodell, gerendert wird nichts. Im Terminal geht dasselbe mit `--until=story`, `--until=cast` oder `--until=look`.

**Die Story ändern:** Auf **Story** steht der Text zum Bearbeiten. **Save the story** speichert ihn. Alles, was aus der alten Story geplant war, fällt dabei weg, und der nächste Planlauf macht es neu. **Write it again** lässt das Sprachmodell eine neue Story schreiben. Ein Drehbuch steht hier nur zum Lesen: Es wird im Skript unter `input/` geändert.

**Die Story an den Cast anpassen:** **Tell it anew for the cast** lässt das Sprachmodell dieselbe Story mit der Besetzung erzählen, die **Casting** jetzt hat: gleiche Handlung, gleiche Orte, etwa gleiche Länge. Der Vorschlag erscheint neben der jetzigen Story. **Take the new story** übernimmt ihn, **Drop it** verwirft ihn. Beim Übernehmen bleiben Cast, Sängerwahl und Looks, nur die Zusammenfassung und alles ab den Beats wird neu geplant.

![Vorschlag neben der jetzigen Story](images/workspace/story-proposal.jpg)

![Story-Seite mit der Stufen-Leiste](images/workspace/story.jpg)

**Den Look ändern:** Auf **Look** steht oben der Look des ganzen Videos, darunter je Figur und Ort der Look (daraus wird das Bild gemacht) und die Beschreibung für die Clip-Prompts, bei Orten auch Hintergrund und Grundriss. Du änderst einen Text von Hand oder setzt den Haken **Write anew**, dann schreibt das Sprachmodell ihn neu. Was aus einem geänderten Text folgt, wird nur für diese eine Figur oder diesen einen Ort neu geschrieben: aus einem neuen Look die Beschreibung, aus einem neuen Ort-Look Beschreibung, Hintergrund und Grundriss. Alle anderen behalten ihre Texte. Nach **Save** fragt die Seite, ob das gleich geschehen soll. Ein geänderter Look des ganzen Videos schreibt dagegen alle Looks neu.

![Look-Seite mit dem Look des Videos und je Figur Look und Beschreibung](images/workspace/look.jpg)

**Casting-Fotos:** Steht der Look, rendert **Render the pictures** die Bilder aller Figuren und Orte, bevor die Einstellungen geplant werden. Auf **References** siehst du sie an, änderst einen Prompt oder renderst ein Bild neu, ohne dass dabei schon die Einstellungen geplant werden. Nur die Mitglieder einer Gruppe kommen erst mit den Einstellungen, denn wie viele es sind, steht erst in den Beats. Im Terminal: `--until=look --render=images`.

**Den Cast ändern:** Siehe [Besetzung und Bibliothek](#besetzung-und-bibliothek). Am besten direkt nach **Plan the cast**: Dann baut noch nichts auf ihm auf.

### Dasselbe im Terminal

Alles aus diesem Abschnitt geht auch ohne Workspace. Die Seiten rufen dieselben Befehle auf. Jeder Befehl gibt ohne Option aus, was da ist. Mit Option ändert er es, nennt, was dabei wegfällt, und schlägt den Planlauf vor, der es neu macht.

| Im Workspace | Im Terminal |
|---|---|
| Stufen-Leiste: **Plan the cast** usw. | `bun index.ts <id> --until=story` (auch `cast`, `look`); Film: `bun film.ts <id> --until=…` |
| **Story** lesen, ändern | `bun run story <id> --out=story.txt`, ändern, dann `bun run story <id> --set=story.txt` |
| **Tell it anew for the cast**, **Take the new story**, **Drop it** | `bun run story <id> --adapt`, dann `--take` oder `--drop` |
| Film: **Add a character**, **Remove**, **Tell the screenplay anew** | `bun run story <id> --film --adapt --add="Name: Rolle" --remove=<id>`, dann `--take` oder `--drop` |
| neue Namen in die Story | `bun run story <id> --rename="Soren Hale=Soren Vale"` |
| **Change the cast**, **Add a character**, **Add a place**, **Remove** | `bun run cast <id> --json > cast.json`, ändern, dann `bun run cast <id> --set=cast.json`. Eine neue Figur steht ohne `id` drin, eine entfernte fehlt einfach. |
| Rolle aus der Bibliothek, **Plan now** | `bun run casting <id> --set=character:mara=library:mara-v2`, der Befehl nennt das passende `--redo` |
| Timing: **Put the song into the library…** | `bun run export-song <id> [--as=<song-id>] [--name=<name>]`; in ein Projekt: `bun run import-song <id> <song-id>` |
| **Look** lesen, ändern | `bun run look <id>`; `--json > look.json`, ändern, `--set=look.json` |
| **Write anew** | `bun run look <id> --again=leo,location:hall` |
| **Render the pictures** | `bun index.ts <id> --until=look --render=images` |

Beim Film kommt überall `--film` dazu. Das Drehbuch wird dort nur ausgegeben, und `cast --set` ändert nur Namen und Texte. Eine Figur kommt dazu oder fällt weg, indem das Drehbuch für sie neu erzählt wird: `bun run story <id> --film --adapt --add="Mira: eine junge Beleuchterin" --remove=emil`, dann `--take` oder `--drop` (Casting: **Add a character**, **Remove**, **Tell the screenplay anew**; Story: **Take the new screenplay**, **Drop it**).

Ein Beispiel von vorne bis zu den Casting-Fotos:

```powershell
bun index.ts mein-video --until=cast
bun run cast mein-video --json > cast.json
# cast.json bearbeiten: einen Namen ändern, eine Figur ohne "id" ergänzen
bun run cast mein-video --set=cast.json
bun run story mein-video --adapt
bun run story mein-video --take
bun index.ts mein-video --until=look
bun run look mein-video
bun run look mein-video --again=soren-hale
bun index.ts mein-video --until=look --render=images
bun index.ts mein-video
```

## Ein Video ansehen

![Timeline mit Monitor und Clip-Details](images/workspace/timeline.jpg)

- **Oben links** läuft das Video, **rechts** daneben stehen die Details des gewählten Clips: **Prompt**, **Shots**, **References**, **Render** und **Versions**.
- **Rechts neben der Abspielzeit** wählst du, was läuft: das fertige Video oder **Clips over the song**, also die einzelnen Clips. Zum Beurteilen von Clips nimmst du Letzteres, denn ein fertiges Video zeigt die Clips so, wie sie beim Zusammenbau waren.
- **Unten** liegt die Timeline, von oben nach unten: Abschnitte (beim Film Szenen), die Beats der Story (Musikvideo), der Ton, die Clips mit ihren Shots, die gesungenen oder gesprochenen Zeilen.
- **Darunter** hat jede Figur eine schmale Spur: grau, wo sie im Bild ist, orange, wo sie singt oder spricht, grün, wo sie spielt. Ein Klick auf einen Abschnitt öffnet den Shot im Regie-Dialog (siehe [Einen Shot direkt in der Timeline führen](#einen-shot-direkt-in-der-timeline-führen)).

**Die Leiste unter den Spuren** blendet unter **Show** den Player und jede Spur außer den Clips aus und ein: **Player**, **Sections** (**Scenes**), **Beats**, **Song** (**Sound**), **Sung** (**Lines**), **Cast**. Das bleibt im Browser gespeichert. Ohne Player hat die Timeline den ganzen Platz; der Ton läuft weiter. Rechts in der Leiste stehen **Fit** (das ganze Video) und **Zoom** (auch `Strg`+Mausrad über der Timeline). Am oberen Rand der Timeline ziehst du sie höher oder niedriger.

Nützliche Tasten: `Leertaste` spielt und pausiert, `←` und `→` springen zum vorigen oder nächsten Clip, `,` und `.` gehen einen Frame zurück oder vor, `O` wiederholt den Clip in Schleife.

**Die Leiste über den Spuren** fasst die Knöpfe nach dem zusammen, was sie tun:

| Gruppe | Was drin steht |
|---|---|
| Zahlen | wie viele Clips gerendert sind, fehlen, stale oder gepinnt sind, Markierungen, *goes on* |
| Markiert | nur mit Markierung: **Render marked**, **Preview marked**, **Plan … again**, **People…**, **Clear** (siehe [Mehrere Clips auf einmal](#mehrere-clips-auf-einmal)) |
| Rendern | **Render stale**, **Render missing**, **Render all**, jeweils mit der Zahl der Clips |
| Prüfen | **Only flagged** blendet alle anderen ab, `‹` und `›` springen von einem auffälligen Clip zum nächsten, **Mark flagged**, **Review**, **Scan for backdrops** (sucht ohne GPU nach grauen Studio-Hintergründen) |
| Fertigstellen | **Preview all**, **Preview video**, **Refinish**, und sobald es ein fertiges Video gibt **AI marker**, **Intro**, **Credits** |

**Render stale**, **Render missing** und **Render all** markieren diese Clips und stellen dann die übliche Frage mit Schätzung. **Render all** nimmt auch Clips, die als aktuell gelten, etwa nach einem anderen Seed.

## Einen Clip neu rendern

1. Clip auf der Timeline anklicken.
2. Rechts den Reiter **Render** öffnen.
3. **Preview** ist der billige Test: wenige Schritte, wenige Pixel, in einem eigenen Ordner. Ein echter Clip wird dabei nie ersetzt.
4. **Render again** rendert den ganzen Clip neu. Der Dialog nennt die geschätzte Dauer und warnt, wenn andere Clips auf diesem aufbauen.
5. Nach dem Render öffnen sich alte und neue Fassung nebeneinander.

![Alte und neue Fassung nebeneinander](images/workspace/compare.jpg)

**Play both from the start** spielt beide synchron. Gefällt dir die alte besser, nimmst du **Go back to the old one**. Später geht das im Reiter **Versions** mit **Compare** (das Fenster im Bild, dort heißt der Knopf **Make the right one current**) oder direkt mit **Make current**.

**Im Terminal:** `bun run versions <id> slot-007` listet die weggelegten Fassungen eines Clips, die neueste zuerst. `--pick=<Fassung>` macht eine davon wieder aktuell. Das geht genauso für Bilder (`bun run versions <id> mara`). Die aktuelle Fassung wird dabei weggelegt und bleibt auswählbar. Beim Film kommt `--film` dazu. Die eigene Wahl eines Film-Clips (Ansicht, Referenzen) setzt `bun run override <film-id> clip-007 --view=2 --without=<bild>`, `--clear` nimmt sie zurück.

### Nur einen Teil neu rendern

Ist nur eine Stelle schlecht, gibst du im Reiter **Render** unter **Render a part again** die Sekunden an und klickst **Render this part**. Hat der Clip mehrere Shots, gibt es dafür je einen Knopf. Der übrige Clip bleibt erhalten, das fertige Video wird dabei nicht neu zusammengebaut.

> **Vorsicht:** Das ist noch nicht erprobt. Auf der Radeon lief dieser Job in den Speicherfehler, und ein Versuch hat den Server abstürzen lassen. Bei einem Film geht ein Teil mit Dialog nicht, weil der Ton dort am Bild hängt.

## Mehrere Clips auf einmal

![Timeline mit drei markierten Clips](images/workspace/marked.jpg)

1. Mit `Strg`+Klick markierst du einzelne Clips, mit `Umschalt`+Klick alle bis zu diesem Clip. **Mark flagged** markiert alle auffälligen.
   - Ein Klick auf einen **Beat** markiert seine Clips, `Strg`+Klick nimmt sie dazu.
   - Ein Klick auf einen **Abschnitt** markiert die Clips darin, `Umschalt`+Klick die Clips aller Abschnitte mit diesem Namen (alle Refrains), `Strg`+Klick nimmt sie dazu oder heraus.
2. Über den Spuren erscheinen **Render marked**, **Preview marked** und **Clear**.
3. Während des Laufs zeigt jeder Clip auf der Timeline, ob er wartet, rendert oder fertig ist.

Gehören die markierten Clips zu Beats, kommen zwei Knöpfe dazu, beide nur mit dem Sprachmodell, gerendert wird nichts:

- **Plan … again** plant die Shots dieser Beats mit dem Planer, wie er jetzt ist, neu. Die anderen Beats behalten ihre Shots, die Clips werden stale. Ein gestrichelter Beat hat noch keinen Shot-Plan, der nächste Planlauf plant ihn sowieso.
- **People…** (Musikvideo) sagt, wer in den markierten Clips ist: Leute aus dem Cast oder neue mit eigenem Bild kommen dazu (**In these clips**, **New people**), andere gehen heraus (**Not in these clips**), und unter **What they do there** steht, was sie dort tun. Die Beats werden danach neu geplant. Im Terminal: `bun run direction <id> --with=… --join=… --out=… --clips=…` (siehe [Regie-Leitfaden](direction.md#who-is-in-which-beats-and-clips-music-video)).

> **Vorsicht nach einer Neuplanung:** Danach ist meist fast jeder Clip stale. Prüfe zuerst die Seite **Direction** und rendere einige markierte Clips zur Probe, statt gleich **Render stale** oder **Next** zu nehmen. Würde **Next** den Großteil des Videos rendern, warnt der Dialog davor.

## Clips durchgehen und entscheiden

![Review mit Tastenleiste unter dem Bild](images/workspace/review.jpg)

**Review** geht die markierten Clips nacheinander durch, jeden in Schleife. Ist nichts markiert, nimmt es die auffälligen, sonst alle. Abgespielt wird erst mit `Leertaste` - von selbst nur, wenn in der Leiste **Play by itself** angehakt ist (bleibt im Browser gespeichert). Nach einem erneuten Render mehrerer Clips sind diese markiert; die Review startet man dann selbst.

| Taste | |
|---|---|
| `Leertaste` | abspielen oder anhalten |
| `Enter` | passt, nächster Clip |
| `R` | neu rendern: nur vormerken, sofort weiter - gerendert wird am Ende |
| `←` | zurück |
| `C` | mit der älteren Fassung vergleichen |
| `Esc` | Review beenden |

Am Ende bleiben genau die mit `R` gemerkten Clips markiert, und die Seite fragt, ob sie gerendert werden sollen.

## Regie nachträglich ändern

Bewegung, Spiel und Bildausschnitt eines bereits geplanten Projekts änderst du nachträglich. Story, Cast, Referenzbilder, Ton und Schnittzeiten bleiben bestehen. Du musst die Regie nicht beim Anlegen des Projekts festlegen.

### Einen Shot direkt in der Timeline führen

In der Timeline unter **Shots → Direct this shot** öffnet sich der Shot in einem Dialog: Bildausschnitt, Kamera, Handlung und darunter jede Person im Bild mit dem, was sie tut (**Start**, **In frame**, **Movement**) und ob sie singt, spielt oder spricht.

- **Shot size** (wide, medium, close, extreme) ändert den Plan direkt, ohne Sprachmodell, und die Clip-Prompts werden gleich neu gebaut.
- **Take out** markiert eine Person, auch mehrere. **Take … out of the shot** nimmt alle markierten in einem Schritt heraus, durch den Code. Wer im Shot singt, spielt oder spricht, kann nicht herausgenommen werden. Nennt der Text des Shots danach noch jemanden von ihnen, startet gleich ein einziger Vorschlag des Sprachmodells, der den Shot ohne alle schreibt; **Take and build the prompts** übernimmt ihn, **Drop** baut die Prompts nur mit dem Herausnehmen. Sonst werden die Clip-Prompts gleich neu gebaut. **Rewrite the words** fragt für einen früher herausgenommenen noch einmal, **Undo** nimmt eine direkte Änderung zurück.
- **Bring in** zeigt alle aus dem Cast, die nicht im Shot sind. **+ Name** markiert sie, auch mehrere, darunter steht optional, was sie hier tun. **Bring … into the shot** setzt sie durch den Code in genau diesen Shot, ein einziger Vorschlag des Sprachmodells schreibt, wo sie stehen und was sie tun. Die anderen Shots des Clips und des Beats bleiben, wie sie sind; so kommt jemand aus Shot 2 auch in Shot 1. War die Person vorher mit **Take out** herausgenommen, wird nur das zurückgenommen. Nach der Übernahme nimmt **Undo** sie nicht mehr heraus, dafür ist **Take out** da.
- Unter **Instructions** schreibst du eine Anweisung für den ganzen Shot oder, über **Instruction for …**, für eine Person darin. **Propose** speichert sie und fragt das Sprachmodell in einem Schritt. **Proposed** zeigt danach nur die geänderten Felder, vorher und nachher.
- **Take and build the prompts** übernimmt den Vorschlag und baut die Clip-Prompts neu. Danach den Clip auf der Timeline rendern. **Drop** verwirft den Vorschlag.

Direkte Änderungen überstehen eine Neuplanung: Der Planer bekommt sie als Vorgabe, und der Code setzt sie auch im neuen Plan durch. Eine Änderung für einen einzelnen Shot muss nach einer Neuplanung neu zugeordnet werden, weil der neue Plan andere Shots hat.

### Anweisungen für mehrere Shots

1. **Direction** in der Projektnavigation öffnen.
2. Unter **Scope** Projekt, Charakter, Beat/Szene, einen Songzeitbereich oder einen Shot wählen. **Only for character** schränkt den Bereich zusätzlich ein.
3. Unter **Instruction** beispielsweise „Kael dreht sich zu seiner linken Seite, bis sein Rücken zur Kamera zeigt“ oder „Nahaufnahme der Greifhand beim Gitarrensolo“ eingeben. **Save instruction** speichert deinen Originaltext.
4. **Preview changes** startet den CLI-Aufruf an das Sprachmodell. **Before / After** zeigt die vorgeschlagenen Änderungen einschließlich Pose und Bewegung. Gleichrangige widersprüchliche Vorgaben oder Anschlussprobleme verhindern die Übernahme: Anweisungen korrigieren oder den Bereich erweitern und neu vorschlagen lassen.
5. **Take changes** übernimmt den Vorschlag und baut die Clip-Prompts gleich neu; **Drop proposal** verwirft ihn. Danach auf der Timeline die betroffenen veralteten Clips rendern. Die Regieaktionen selbst rendern nichts.

Unter **Direct edits** legst du direkte Änderungen für mehrere Shots an, ohne Sprachmodell: eine Person aus allen Shots eines Beats, einer Szene, eines Zeitbereichs oder aller Shots mit einer bestimmten Figur nehmen, oder dort die Einstellungsgröße setzen. **Add edit and build the prompts** speichert sie und baut die Clip-Prompts neu, **Undo edit** nimmt sie zurück. Bei einer Anweisung oder Änderung für einen einzelnen Shot öffnet **open in the timeline** den Shot im Regie-Dialog.

Ein Zeitbereich betrifft alle sich damit überschneidenden ganzen Shots; er erzeugt keine zusätzlichen Schnitte. **Remove instruction** entfernt die Vorgabe, macht eine bereits übernommene Bewegung jedoch nicht rückgängig.

### Nach einer Neuplanung

Werden die Shots neu geplant, etwa nach einer geänderten Einstellung oder mit **Plan … again**, bleiben die Anweisungen gespeichert. Eine Szene oder ein Shot mit derselben Nummer kann aber etwas anderes zeigen. Eine Anweisung für einen Beat, eine Szene oder einen Shot gilt deshalb erst wieder, wenn du sie neu zuordnest. Bis dahin hält der nächste Lauf an, bevor er einen Clip baut, mit „Direction needs review“ und der Liste der Anweisungen: Bereich, Anfang des Textes und Grund.

1. **Direction** öffnen. Die Leiste des fehlgeschlagenen Laufs (**Open the Direction page**) und der Chip **Next** führen dorthin.
2. Bei jeder Anweisung mit Warnung: nach Prüfung **Review current binding** (sie gilt für die Shots, wie sie jetzt sind), mit **Edit instruction** eine passende Auswahl treffen, oder **Remove instruction**.
3. **Preview changes**, dann **Take changes**.
4. **Take changes** baut die Clip-Prompts neu. Erst dann rendern, zuerst einige markierte Clips zur Probe (siehe die Warnung unter [Mehrere Clips auf einmal](#mehrere-clips-auf-einmal)).

Anweisungen, die an den Planer gegangen sind (mit **People…**), brauchen keine Prüfung. Im Terminal nennt `bun run status` die offenen Anweisungen und als nächsten Schritt `bun run direction <id> --preview`.

### Pläne zurückholen

Unter **Plan versions** kannst du einen kompatiblen früheren Plan einschließlich des Originalplans wiederherstellen. Bereits gerenderte Videos bleiben erhalten. CLI-Beispiele, JSON-Format und Regeln stehen im [Regie-Leitfaden](direction.md).

## Einen Lauf verfolgen oder stoppen

![Laufender Render mit Leiste am Seitenende](images/workspace/run.jpg)

Am unteren Rand steht, was gerade läuft: bei einem Render ein Balken mit fertigen und allen Clips (`12/37`) und Prozent, sonst der Schritt aus dem Log, dazu die Laufzeit. **Log** zeigt die Ausgabe der CLI, **Stop** beendet den Lauf. Fertige Dateien bleiben. Die Jobs, auf die der Lauf gewartet hat - Bilder, Sheets und Clips -, werden auf ihren Servern abgebrochen: aus der Warteschlange genommen, oder angehalten, wenn es gerade der eigene Job ist (nie der eines anderen). Der Server ist damit sofort frei, und der nächste Lauf rendert sie neu. So wirkt auch Ctrl+C im Terminal. Nur wenn ein Lauf abstürzt oder der Rechner einschläft, laufen seine Jobs weiter, und der nächste Lauf nimmt sie wieder auf.

**Wenn etwas schiefgeht:** Bei bekannten Fehlern steht über der Timeline in Klartext, was passiert ist und was zu tun ist, daneben **Repeat**. Gehört die Lösung auf eine andere Seite, etwa „Direction needs review“, führt ein Link dorthin. Andere Fehler zeigt das **Log**. Der häufigste Fall ist `out of memory`: Dann nimmst du einen anderen Server oder renderst kürzer oder kleiner, statt denselben Job noch einmal zu schicken.

## Referenzbilder ändern

![Referenzseite mit Karten und Details](images/workspace/references.jpg)

Unter **References** liegen alle Personen, Orte und Requisiten. Rechts stehen Prompt, Ansichten, ältere Fassungen und die Clips, die das Bild benutzen. Während eines Laufs erscheint jedes Bild hier und auf **Look**, sobald es fertig ist, nicht erst am Ende des Laufs.

- **New sheet, same anchor**: dieselbe Person, andere Ansichten.
- **New anchor**: eine andere Person oder ein anderer Ort, alles danach wird neu.
- **Prompt ändern** und dann rendern: Das Bild bleibt danach gepinnt, der Prompt im Plan bleibt, wie er war. Das Prompt-Feld zeigt danach den geänderten Prompt, und du kannst ihn weiter ändern und noch einmal rendern.
- **Take the plan's prompt** holt den Prompt aus dem Plan zurück. Damit gerendert, ist das Bild nicht mehr gepinnt und folgt wieder dem Plan. Der Anchor aus dem geänderten Prompt geht dabei mit weg.
- **Use my own anchor** setzt ein eigenes Bild als Anchor ein, egal ob es von Hand in ComfyUI oder sonst wo entstanden ist. Du lädst das Bild hoch (PNG, JPEG oder WebP, höchstens 50 MB). Dazu kannst du einen Prompt als Notiz mitgeben. Die Beschreibung, die die Clips und das Sheet von der Person oder dem Ort sagen, behältst du, schreibst du selbst oder lässt du vom Vision-Modell aus dem Bild lesen. Die letzte Möglichkeit gibt es nur, wenn ein Modell eingerichtet ist, das Bilder liest. ComfyUI rendert das Sheet dann aus deinem Bild. Was vorher da war, landet unter den älteren Fassungen. Das hochgeladene Bild liegt nur für die Dauer des Laufs in einem eigenen Temp-Ordner. Im Terminal geht dasselbe mit `--render=images --only=<id> --again --picture-anchor=<bild> [--picture-description=<datei> | --describe-picture]`.
- **Make current** holt eine ältere Fassung zurück.

Auch ein gepinntes Bild lässt sich neu rendern, auch ein eigenes. Was da ist, landet unter den älteren Fassungen. Gesperrt sind die Render-Knöpfe nur, wenn ein Asset aus der Bibliothek die Rolle spielt. Clips, die das Bild benutzen, werden danach stale, aber nicht von selbst neu gerendert: Das entscheidest du auf der Timeline.

## Besetzung und Bibliothek

![Casting-Seite mit einer Auswahl je Rolle](images/workspace/casting.jpg)

**Casting** zeigt jede Rolle und jeden Ort mit einer Auswahl: **Rendered in this project** oder ein Asset aus der Bibliothek. Eine Änderung schreibt nur einen Eintrag in `casting.json`. Wirksam wird sie mit dem nächsten Planlauf (**Plan now**). Der Dialog davor nennt, welche Schritte aus den alten Texten der Rolle geplant waren und jetzt neu geplant werden. Die betroffenen Clips werden dann stale, gerendert wird nichts von selbst.

**Change the cast** ändert den Cast selbst, ganz ohne Bibliothek: Name, Rolle in der Story und Requisite jeder Figur, die Namen der Orte. Beim Musikvideo kannst du Figuren und Orte auch hinzufügen und entfernen: **Add a character** und **Add a place** stehen über den Listen, **Remove** auf der Karte jeder Rolle. **Add** öffnet den Cast zum Bearbeiten, mit der neuen Figur oder dem neuen Ort schon drin. **Remove** bleibt auf der Liste: Die Karte wird als „Out of the cast when saved“ markiert, **Put back** auf ihr holt die Rolle zurück. Eine Leiste unten zählt, wer wegfällt, und speichert alle Streichungen auf einmal (**Save the cast**) oder verwirft sie (**Discard**). So streichst du viele Rollen in einem Rutsch und speicherst einmal. Im Formular von **Change the cast** steht, wer beim Speichern wegfällt, über dem Knopf, mit **Put back** daneben. Beim Film legt das Drehbuch fest, wer vorkommt: Dort änderst du mit **Edit the roles and places** Name, Rolle, Aussehen und Stimme. Die Ids bleiben, eine umbenannte Figur behält also ihre Bilder und ihren Eintrag in `casting.json`.

**Eine Figur im Film dazu oder heraus** (#589): Hat die Pipeline das Drehbuch aus `input/idea.txt` selbst geschrieben, stehen über den Figuren **Add a character** und auf jeder Karte **Remove**. Eine neue Figur bekommt einen Namen und ihre Rolle in der Geschichte. Die Leiste unten zählt, wer dazukommt und wer geht, und **Tell the screenplay anew** lässt das Sprachmodell das Drehbuch für diese Besetzung neu schreiben: dieselben Szenen an denselben Orten, eine Rolle für die Neuen (mit Aussehen und Stimme), nichts mehr von denen, die gehen, die Dialoge der anderen so weit wie möglich wörtlich. Der Code prüft die Antwort und fragt bei Fehlern einmal nach. Das Ergebnis wartet auf der Story-Seite neben dem Drehbuch. **Take the new screenplay** übernimmt es: Wer bleibt, behält Id, Looks und Bilder, der Look des Films und die Orte bleiben. Weg fallen, was aus dem Skript gelesen wird (Zusammenfassung, Requisiten, Einstellungen, Skript-Notizen), und der nächste Planlauf schreibt sie neu, dazu die Looks der Neuen. Bei einem eigenen Drehbuch (`input/screenplay.txt`) geht das nicht, denn dort prüft die Pipeline, dass keine Zeile verändert wird. Die Seite sagt dann: Figur im Skript ergänzen oder streichen, danach neu planen.

**Save the cast** nennt vorher, was aus dem alten Cast geplant war und wegfällt: die Looks, beim Musikvideo auch die Sängerwahl, später die Beats und Einstellungen. Der nächste Planlauf macht es neu, nur mit dem Sprachmodell. Beim Musikvideo werden dabei nur die Looks der neuen oder geänderten Figuren und Orte neu geschrieben, alle anderen behalten ihre. Nach dem Speichern fragt die Seite nach: Bei einer umbenannten Figur setzt **Put them in** den neuen Namen in die Story (als ganzes Wort, auch Vor- oder Nachname allein). Kam jemand dazu oder fiel weg, bietet sie an, die Story für die neue Besetzung erzählen zu lassen (siehe oben).

![Change the cast: je Figur Name, Rolle und Requisite, darüber wer beim Speichern wegfällt](images/workspace/cast-edit.jpg)

**Library** (oben links neben **Projects**) zeigt alle Assets und wo sie benutzt werden. **New asset from a picture** legt eines aus einem Bild an. Aus einem Projekt heraus geht es unter **References** mit **Put into the library**. Ein vorhandenes Asset wird dabei nie überschrieben.

## Wer welche Zeile singt

**Singers** (nur bei Musikvideos, in denen jemand singt) listet jede gesungene Zeile, nach Songteilen gruppiert. Hinter jeder Zeile stehen die Sänger als Schalter: Einer singt sie allein, mehrere singen sie zusammen (Duett, Chor). **All of these** schaltet einen Sänger für einen ganzen Songteil. Mit **Add a singer from the cast…** kommt jemand aus dem Cast dazu, der bisher nicht singt. Der Knopf ▶ (oder Leertaste) spielt die Zeile aus dem Vocals-Stem: So hört man, ob eine Frauen- oder Männerstimme singt. Auf der Timeline führt **Change singers** im Tab Shots zur ersten Zeile des Clips.

**Wechselt der Sänger mitten in der Zeile**, klickst du zwischen die beiden Wörter: Dort beginnt ein neuer Teil. Jeder Teil bekommt eigene Sänger-Schalter und einen eigenen ▶. Die Wörter sind in der Farbe ihres Sängers unterstrichen. Ein Klick auf die Trennstelle nimmt sie zurück. Zwei Teile mit denselben Sängern werden beim Speichern wieder einer. Die Trennstelle sitzt auf den Wortzeiten aus dem Abgleich mit dem Transkript. Bei einer Zeile, die dort kaum gefunden wurde, sind sie nur geschätzt; die Seite sagt das, dann hilft ▶ pro Teil.

Tasten auf einer Zeile: **1** bis **9** schaltet den Sänger mit dieser Nummer (bei einer geteilten Zeile im gewählten Teil), **← →** wählt den Teil, **↑ ↓** geht zur nächsten Zeile, **Leertaste** spielt die Zeile oder den gewählten Teil.

Rechts steht, was das Speichern auslöst: Die Beats, in denen eine geänderte Zeile gesungen wird, verlieren ihren Shot-Plan. Ihre Clips werden stale. Steht ein Sänger noch nicht in so einem Beat, wird er hinzugefügt, und der Beat wird ohne seinen Grundriss neu inszeniert. **Save and plan** startet danach den Planlauf. Er fragt das Sprachmodell nur nach diesen Beats, alle anderen Beats und die Story bleiben, gerendert wird nichts. `bun run status` und `--dry-run` nennen die Beats ohne Plan.

Die Zuordnung steht in `project.json` (Schritt `singing`). Sie bleibt, bis sich `lyrics.txt` oder `singers` in `config.json` ändern oder `--redo=singing` das Modell neu fragt.

**Im Terminal:** `bun run singers <id>` listet die Zeilen, nummeriert ab 1. `bun run singers <id> --line=12:mara,ben` lässt Zeile 12 von Mara und Ben singen. Für mehr auf einmal schreibt `--json > singers.json` die Zeilen in eine Datei. Du änderst sie, auch Wechsel mitten in der Zeile als `parts`, und gibst sie mit `--set=singers.json` zurück. Danach nennt der Befehl die neu zu planenden Beats und den Planlauf.

## Wann die Lyrics gesungen werden

**Timing** (bei Musikvideos mit abgeglichenen Lyrics) zeigt oben die Wellenform des Vocals-Stems um eine Zeile, darüber ihre Wörter als Kästen, darunter alle Zeilen. **Estimated** filtert die Zeilen, die der Abgleich mit dem Transkript kaum gefunden hat: Ihre Zeiten sind nur über die Zeile verteilt und können Sekunden danebenliegen.

- Ein Wort ziehen verschiebt es, seine Ränder ziehen ändert Anfang oder Ende. Stößt es an ein Nachbarwort, gibt dieses nach.
- Der Balken über den Wörtern verschiebt die ganze Zeile. **← →** verschiebt sie um 0,05 s, mit Shift um 0,5 s. **Tab** wählt ein Wort, dann gelten die Pfeile für das Wort, **Esc** wieder für die Zeile.
- **Leertaste** spielt die Zeile oder das gewählte Wort, ein Doppelklick ein Wort, ein Klick in die Wellenform spielt ab dort. **Strg+Mausrad** oder **+ / −** zoomt, **Strg+Z** macht rückgängig.
- Gestrichelte Linien sind die Schnitte zwischen den Clips. Fällt ein Schnitt in ein Wort, wird das Wort rot umrandet und die Seite warnt.

Mit bekannten Lyrics geht nichts verloren und es kommt nichts still dazu. Jede Zeile aus `lyrics.txt` ist genau einmal da, mit ihren eigenen Wörtern. Ein Wort, das Whisper nicht gehört hat, bleibt als geschätzt in der Zeile. Passt eine Zeile nicht zu `lyrics.txt` (ein Wort fehlt, sie fehlt ganz oder liegt nirgends), zeigt die Seite das als **check** an. Hat Whisper Gesang gehört, den `lyrics.txt` nicht hat, etwa eine Wiederholung, wird daraus ein **ad-lib**: ein Vorschlag, den kein Clip singt, bis du **Sing it** wählst. Hört Whisper eine Zeile zweimal an derselben Stelle, entsteht kein Ad-lib.

**Back to automatic** setzt eine von Hand gesetzte Zeile auf den automatischen Abgleich zurück, **All back to automatic** alle. Der Abgleich wird dafür aus dem gespeicherten Transkript neu berechnet, Whisper läuft nicht noch einmal.

**Save** behält die Schnitte: Die Vocals jedes Clips werden aus den neuen Zeiten neu berechnet, nur Beats mit geänderten Clips verlieren ihren Shot-Plan. **Save and plan** plant sie gleich neu. **Save and cut the song again…** schneidet den Song um die neuen Zeiten neu (`--redo=timeline`) und plant dabei jeden Shot neu, das dauert. Verschobene Zeilen gelten als von Hand gesetzt und nicht mehr als geschätzt. Die Zeiten stehen in `project.json` (`lyricsTiming`), bis sich `lyrics.txt` ändert oder `--redo=lyricsTiming` neu abgleicht.

**Im Terminal:** `bun run timing <id>` listet jede Zeile mit Anfang und Ende. `--json > timing.json` schreibt die Wortzeiten in eine Datei. Du verschiebst `start` und `end` und gibst sie mit `--set=timing.json` zurück. Unverändert zurückgegebene Zeilen zählen nicht als geändert. Fällt danach ein Schnitt in ein Wort, sagt der Befehl das und nennt `--redo=timeline`. `--reset=12,40` oder `--reset=all` setzt von Hand gesetzte Zeilen auf den automatischen Abgleich zurück, `--on=N` singt einen Ad-lib. Die Liste nennt Ad-libs und Zeilen, die nicht zu `lyrics.txt` passen.

**Den Song in die Bibliothek:** **Put the song into the library…** kopiert den Song, die Lyrics, die sechs Stems, die Analyse, das Transkript und das gespeicherte Timing in die Bibliothek (`library/songs/<id>/`), mit jeder von Hand gesetzten Zeile. Erst speichern: Der Knopf ist gesperrt, solange verschobene Zeilen ungespeichert sind. Ein neues Projekt nimmt den Song mit `bun run init` (die Songs der Bibliothek stehen dort zuerst) oder `bun run import-song <id> <song>` und fängt bei der Story an: Am Song wird nichts mehr neu gemacht. Jedes Projekt bekommt eine Kopie, eine spätere Änderung am Timing ändert weder die Bibliothek noch andere Projekte. Ein Song, den die Bibliothek schon hat, wird nie überschrieben. Im Terminal: `bun run export-song <id> [--as=<song-id>] [--name=<name>]`.

## Die Einstellungen eines Projekts ändern

Die Seite **Settings** enthält die Render-Einstellungen des Projekts, also das, was sonst in seiner `config.json` steht: den **Video workflow** (etwa `h3-ref2video-prism-2pass` statt `h3-ref2video-2pass`), die Workflows für Bilder und Sheets, die Größe von Video und Bildern, das Seitenverhältnis, Continuity und Context frames, den Seed, die Wiederholungen und die Bildrate des fertigen Videos. Jede Einstellung sagt, was sie tut und was ihr Standard ist. **Use the default** geht auf den Standard zurück, **Undo** auf das, was das Projekt hatte.

1. Ändere, was du brauchst. Eine geänderte Einstellung hat links einen farbigen Balken.
2. Klicke **Save**. Die Frage davor sagt, was sich ändert und **wie viele gerenderte Clips und Bilder dadurch stale werden**. Workflow, Größe und Seitenverhältnis gehören zu dem, woraus ein Clip gemacht wird: Ändert sich eines davon, ist der Clip stale. Andere Einstellungen, etwa die Wiederholungen oder die Bildrate des fertigen Videos, machen nichts stale.
3. Durch das Speichern wird **nichts gerendert**. Die Timeline zeigt danach, welche Clips stale sind, und du renderst sie, wann du willst.

> **Vorsicht bei Continuity und Context frames:** Sie bestimmen mit, wie lang ein Clip höchstens sein darf (ein Clip, der auf dem letzten Frame des vorigen beginnt, wird um die Context frames kürzer geplant). Ändert sich diese Länge, schneidet der nächste Planlauf den Song neu und plant dabei jeden Shot neu, auch wo sich nichts geändert hätte. Danach sind alle Clips stale, und die Regie-Anweisungen müssen geprüft werden (siehe [Nach einer Neuplanung](#nach-einer-neuplanung)). Dass nur neu geplant wird, was die Änderung betrifft, ist Issue #781.

Ein falscher Wert wird abgelehnt, mit denselben Worten wie beim Start eines Laufs. Ein sehr hoher Wert wird nur angemerkt, nie gekürzt. Solange ein Lauf an dem Projekt arbeitet, wird nichts geschrieben: Warte, bis er fertig ist.

**Im Terminal:** `bun run config <id>` zeigt die Einstellungen, `--set=videoWorkflow=h3-ref2video-prism-2pass` ändert eine (mehrfach möglich), `--unset=seed` nimmt eine aus der Datei. Beim Film kommt `--film` dazu. Andere Schlüssel der `config.json`, etwa die Sänger, änderst du auf der Seite, zu der sie gehören, oder von Hand.

## Ein älteres Projekt aufwerten

![Refinish-Dialog](images/workspace/refinish.jpg)

**Refinish** in der Leiste über den Spuren macht ein fertiges Projekt größer, flüssiger und farblich wie die neueren, aus den vorhandenen Clips. Es läuft kein Plan und kein Prompt ändert sich. `videos/` und das fertige Video bleiben, wie sie sind: Jede Variante bekommt einen eigenen Ordner und eigene Dateinamen.

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

## Vor dem Veröffentlichen: die KI-Kennzeichnung

**AI marker** in der Leiste über den Spuren (sobald es ein fertiges Video gibt) legt eine Kennzeichnung über ein fertiges Video, als neues Video daneben: `<name>-labeled.mp4`. Das Ausgangsvideo bleibt, wie es ist.

1. **From**: welches Video. Gibt es ein fertiges, ist es gewählt.
2. **Marker**: ein EU-Symbol für KI-erzeugte Inhalte (*AI GENERATED*, *AI MODIFIED* oder *AI*, weiß oder schwarz, deckend oder zu 50 % durchsichtig), oder *A PNG of my own* mit seinem Pfad.
3. **When**: nur am Anfang (genug für ein Musikvideo oder einen Film, also ein künstlerisches Werk), am Anfang und dann in Abständen wieder, oder die ganze Zeit. Dann Ecke, Höhe und Rand.
4. **Keep these settings for this project** schreibt sie in die `config.json`, das Formular öffnet beim nächsten Mal mit ihnen. **Keep them for every project** schreibt sie in die Einstellungsdatei.

Das läuft auf diesem Rechner, ohne GPU, etwa so lange, wie das Video dauert. Das neue Video erscheint unter den Videos der Timeline als *… + AI label*. Warum und wann so eine Kennzeichnung nötig ist: [docs/postwork.md](postwork.md).

**Im Terminal:** `bun run label <id>` mit denselben Wahlmöglichkeiten als Optionen (`--marker=`, `--mode=`, `--corner=`, …).

## Vor dem Veröffentlichen: Titelkarte und Abspann

**Credits** in der Leiste über den Spuren setzt eine Titelkarte vor ein fertiges Video und danach einen Abspann, der nach oben läuft: `<name>-credits.mp4`.

- **Title card**: der Titel (leer: der des Projekts), der Künstler, beim Film wer Regie geführt hat, der Hinweis (*Contains AI-generated content*) und, wenn du willst, die KI-Kennzeichnung darunter.
- **Credits**: noch einmal der Titel, deine eigenen Zeilen (eine pro Zeile: Dank, Links, dein Kanal) und womit es gemacht wurde: das Sprachmodell, die Modelle, die Grafikkarten. Das kommt aus dem, was dieses Projekt wirklich benutzt hat, nichts ist erfunden. Deine eigenen Worte zur Hardware stehen danach.
- Ein Ton unter dem Abspann (ein Pfad), sonst Stille. Bei den Längen bedeutet 0 für den Abspann etwa 1,5 s pro Zeile.

Behältst du deinen Namen und deine Zeilen für jedes Projekt, braucht das nächste Video nur einen Klick. Der Lauf zeigt den Abspann Zeile für Zeile, bevor er ihn zeichnet.

**Im Terminal:** `bun run credits <id> [--artist=…] [--line=…] [--dry-run]`.

## Vor dem Veröffentlichen: ein Intro

**Intro** in der Leiste über den Spuren setzt einen eigenen Clip, etwa ein Logo oder ein Kanal-Intro, vor ein fertiges Video: `<name>-intro.mp4`.

- **From**: welches Video. Bei einem Video mit KI-Kennzeichnung nimmst du das gekennzeichnete: Die Kennzeichnung beginnt dann nach dem Intro.
- **Intro**: der Pfad des Clips. Leer nimmt `input/intro.mp4` des Projekts; das Feld sagt, wenn es eins gibt.
- **Fade**: wie viele Sekunden das Intro in das Video überblendet. 0 ist ein harter Schnitt.

Das Intro wird wie das Video gemacht: dieselbe Größe und Bildrate, schwarze Balken bei einem anderen Seitenverhältnis, Stille, wenn es keinen Ton hat. Behältst du das Intro für jedes Projekt, braucht das nächste Projekt nur einen Klick.

**Im Terminal:** `bun run intro <id> [--file=<path>] [--fade=0.5]`.

## Tasten

![Fenster mit allen Tasten und Begriffen](images/workspace/keys.jpg)

`?` zeigt dieses Fenster auf jeder Timeline.
