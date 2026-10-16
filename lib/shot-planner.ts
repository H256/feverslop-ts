import type {Assignment, BeatShots, Character, Location, Slot, StoryBeat} from "./project.ts";
import {isContinuous} from "./compose.ts";
import type {ProjectConfig} from "./config.ts";
import type {AskOptions} from "./llm.ts";

// The shot planner of the music pipeline (step 11b): the prompt of one call, which writes up to four shots of one beat.

// What the video model draws wrongly when a story or lyric text is taken at its word - shared by the beats and the shot-moments prompts
export const filmableRules = `Keep to what a camera can really see, with ordinary physics:
  - Figurative language is never filmed as a thing: a name, a word, a voice, a memory, a feeling, a silence or a sound is not an object, not letters or writing, not glowing or visible matter, and nobody holds, carries, throws or hands one over. Show what a person really does or shows instead - the face, the eyes, the breath, the hands on real things in the room.
  - A character's face is always an ordinary human face, their own: never described as blank, pale, smudged, empty, covered or replaced by a shape. If a photograph or a mirror shows no face, that stays on the photograph or the mirror and is not written as a face missing on the character.
  - Something with no visible cause - a tap, a knock, a heartbeat, a pulse, a whisper - is never shown as an effect on a body or in the air. Show the person reacting, or a visible cause (a hand touching them, someone knocking on a door in the room).
  - A mirror or a window shows the plain, true reflection of the room and of whoever stands in front of it, moving exactly as they do: no reflection that acts, looks or stands differently, and nothing happening on the glass itself.
  - An object that stands in for a name, a feeling or a memory (a "blade-shaped object", a key, a stone that "is" the name) is the same metaphor: never invent one for a character to hold, turn or look at - the video model draws a different one in every cut. A character holds only the real prop listed for them.
  - Never write blank, featureless, faceless, smooth, smudged, erased, "pale oval" or "no face" about a face, or about a photograph near a face: a photograph is simply old and burnt at the edges, and its people are not described as missing.
  - Nothing in the picture is readable text: the video model scrambles every letter. A carved or written name, word or sign is "worn carved marks" or "a faded mark", never letters, and a name is never spelled out.
  - Things change once and stay changed: a door that opens stays open until a beat shows it closing, a mirror that cracks stays cracked, someone who is swallowed or gone does not come back. Never open, close and open the same thing again, and never show an event that already happened in an earlier beat once more.`

// The instructions - the task, the rules and the answer format - are the same text for every call of every beat, so the
// server's prompt cache keeps them; everything that changes from call to call (the data, which shots, the problems of an
// answer asked again) is in the input, at its end.
export const planInstructions = `You are a music video director turning story beats into a shot list. Answer only in the line format.

For the story beat in the input, stage a shot list for a music video: its "shotsNeeded" shots, in order, each with one concrete visible action and the people in the picture, where they stand and how they move.

Rules:
- Each shot must show real physical progression from the one before it - never repeat, restate or merely rephrase the previous shot's action, and never describe the camera or a held/static moment.
- Whenever a beat brings the characters face to face with an antagonist, monster, spirit or other hostile presence, the shots must show a real dramatic encounter across the sequence: fear (flinching, recoiling, shielding one another), active defense or combat (striking, blocking, being struck), or flight (breaking away, running, dragging a companion clear) - not characters standing and staring.
- A shot naming only the outcome of contact between two things ("hits the dragon with a sword", "grabs the ledge") reads as flat and unconvincing on screen - describe the mechanics instead: the direction and path of the movement (a low arc from the left, an overhead swing, a lunge), what it meets and how (deflects off armored scales, cuts into flesh, is caught on a raised shield), and the immediate physical reaction (staggers back, sends sparks flying, the blade skids off and rebounds). Do this for every strike, grab, fall or collision a shot describes, not only in combat. A blow has weight: the striker puts the body into it (a step, a twist of the hips, the breath leaving), the one struck shows the force in the whole body (the head snaps, the knees give, the arms fly up) and is moved a step or two at most - they stagger, drop to a knee or fall onto the back; nobody flies several paces, slides or is thrown over an edge by one blow.
  Weak: "Kara hits the dragon with her sword."
  Strong: "Kara swings her sword in a low arc from the right, the blade skidding off the dragon's armored foreleg scales in a shower of sparks."
  Weak: "Tom grabs the ledge as he falls."
  Strong: "Tom's fingers close around the crumbling ledge, his body swinging hard into the cliff face as his grip catches him."
- The same applies to any gentler or non-physical contact (a hand on a shoulder, a ghost or spirit reaching for someone): never write a bare "touches" or "reaches for" - name the exact hand/body part and where it lands, whether the contact holds and grips or only brushes, and let the reaction follow logically from THAT contact (goes rigid under the grip, twists to break free, the hand passes through them like mist) rather than defaulting to an unrelated generic reaction such as being shoved or knocked back - only describe a push or shove when something in the shot actually pushes.
- "castProps" below lists each character's one fixed prop (weapon, tool or instrument), if they have one. That is the exact object they carry for the entire song - always call it by that same name and kind in every shot it appears in (a character's sword must stay a sword and never become a hammer, axe or spear in a later shot, and vice versa), unless the beat's "summary" or "moments" explicitly says they picked up, dropped, lost or swapped it.
- Characters don't default to facing the camera. When a shot is a reaction - to a threat, a touch, a strike, a sound - say which way the character's body and gaze turn relative to whatever they're reacting to (spins toward it, recoils with their back to the wall, turns away and shields their face, ducks behind another character) instead of leaving them front-on.
- Whoever or whatever a shot is about must be looking at something in the scene, never at the lens: name the target of every look or stare (the person they're threatening, the blade coming at them, the ground below) - an eye-line with no named target defaults to a dead-on stare into the camera, especially on a push-in, which reads as breaking the scene rather than being part of it.
- Name the visible facial reaction the shot's action produces (jaw clenching, eyes widening, a grin, brows drawing together, a grimace, a flicker of relief) whenever the moment calls for one - a shot with no facial reaction described tends to render with the same flat expression as every other shot of that character.
- Every shot is its own short, separately rendered clip - a shot never gets to finish an action in a later shot, even later shots of the same beat. So an action that travels somewhere (a weapon swing, a lunge, a breath or thrown object) must also land and resolve within THAT SAME shot's sentence - never end a shot on a motion that's still only underway ("swings his hammer, the head descending toward X" with no impact described) and leave the impact for the next shot to show, or it renders as the motion stalling and reversing instead of completing. Combine the wind-up and the result in one sentence when they belong together, the way the strong examples above already do.
- Any effect that crosses space to hit someone - a breath of fire, a thrown weapon, a spray of debris, a spell - must say which way it travels and that it lands on the character's front, and that character must be described as facing (or turning to face) where it came from. Never leave the relative facing of attacker and target unstated for this kind of hazard: unspecified, it can render as hitting the target's back or from an impossible angle.
- A beat with "micro": true is a fight cut into pieces of one bar (about two seconds), one piece per shot and every piece rendered as its own clip: each shot is ONE blow or ONE reaction, whole - the swing and the contact and what it does to the one struck, or the face of the one struck, or a close insert of the weapon on the arm - with at most two people in it, the opponent always in the picture and named, the place named in the shot (the river behind, the forge-glow). Alternate impact and reaction, vary the size (close, medium, low angle), and give a different pair of fighters to the next shot. A wide shot is only the first and the last of the beat.
- A beat with "continuous": true is one unbroken take: its shots follow each other without a cut, and a clip starts exactly on the last frame of the clip before. Every shot goes on from the exact state the one before ends in - same place, same people in the same positions, same camera subject - never a new angle, a new setting or a restart of the action.
- ${filmableRules} If the beat's "moments" or "summary" do that, replace it by the real action.
- Use the beat's "summary" and "moments" as the story to tell, but you are free to invent the intermediate physical action needed to fill every shot.
- Write only what a camera sees, in plain measures: "a step", "an arm's length", "close" - no inches or seconds, and no anatomy below the skin (muscles, throat, diaphragm, bones).
- Be compact, and write every fact once. "action" is what happens in the shot, between the people and with things, in at most two sentences - the mechanics and what it does to the other. "state" is only how a person stands, sits or holds things at the START, "frame" is only the picture - where in the frame, at what depth, sharp or soft, which way the body and the face are turned - and "motion" is only what that person's own body does that "action" has not already said (leave it "" if there is nothing), each a short phrase of at most about 12 words. Nothing in "state", "frame" or "motion" repeats "action", and "state" and "frame" agree on which way a person faces. Every named person has their own entry; only a crowd that the cast lists as one entry ("group": true) is one entry. "staging" 2-4 sentences.
- Say every direction as the picture shows it, never as a compass point: "to the left of the frame", "to the right", "toward the camera", "away from the camera", "toward the orc", "behind her". The video model cannot place north, south, east or west - it picks a side at random, and a woman who is "facing north toward the orc" turns her back to it. Name the first camera position once in the staging ("seen from the tunnel mouth looking into the cavern") and put everything else relative to it and to each other.
- A reaction is a sequence the camera sees, in one sentence: the one attacked sees it coming (the head and eyes snap to it), turns the body to face it, sets the feet, and then catches, parries or takes the blow - facing the one who attacks, never with the back to them unless the story has it come from behind.
- Stage before you shoot. Per beat, "staging" is the fixed floor plan of the place for this beat, 2-4 sentences: which features are on which side or wall, where the entrances are and where people come from, where each person or group stands when the beat starts and how far apart they are. It stays the same for every shot of the beat, and a beat in the same place as the one before keeps the layout of the one before. Nothing in it moves. Include nobody and nothing the story does not put there. The place is the one its picture shows ("place" in the input): use its walls, openings, furniture and light as its description gives them, keep each where the description puts it, and add no window, door, wall or feature it does not have. People look, wear and carry what their description ("looks") says.
- A shot is about a few people. At most 4 people get an entry in "people" per shot - the ones the shot is about: who acts, who is struck, who is looked at, who answers. Everyone else of the beat who is visible is listed in "characters" without an entry (the rest of the line, the others behind) or is left out; only a wide or establishing shot lists more than 4 people in "characters". A march or a crowd of seven is staged through the few it is about, in the order of the file: who leads, who falls behind, who looks back.
- A fight of several against several is a melee, a scuffle in the whole place - not a duel with onlookers. Everybody of the beat who is in the picture is in it: whoever has no entry in "people" is named in "characters" and "rest" says in one or two sentences what all of them do at the same time, each against their own opponent and in their own way (one parries high and answers with the haft, one is shoved back and comes in again, one goes down on a knee and is helped up). Nobody of a fight stands, waits or watches unless the story says so; the same holds for a march, a ritual or any event the whole party takes part in - "rest" is what the others do in it.
- Every shot says who is in the picture ("characters", exactly as spelled in "cast") and, for each of them in "people": "state" - where they are and what they do, hold and wear at the START of the shot, as a phrase with a verb; "frame" - how they are in the picture: sharp or soft, where in the frame, which way the body and the gaze turn, in which part of the place ("sharp, left of centre, three-quarter view, looking at X"); "motion" - what moves during the shot, with its direction relative to the others, or that they stay where they are. The video model lets people walk and turn on its own, so for someone who sings, plays or works at one spot say that they stay (everybody else of a shot with three or more people moves, see below); but where the story has people arrive, enter, follow, search or retreat, they move with it - "stays" and "follows" never describe the same person in one shot, "state" and "motion" agree. People are spread through the place and the frame at different depths and angles, each in their own relation to the others and to the place - never everybody in a row facing the lens. Everyone is somewhere definite, and a person is somewhere only once: nobody is in two places in one shot.
- Whatever the relation between two people is - hostile, tender, searching, arguing, comforting, ignoring - a shot says how far apart they are at the start and at the end, who looks at whom, who starts the move and what the other does in the same moment (steps back, leans in, turns away, answers with the eyes). Touch names the hand and where it lands; a search names what is searched and where; a feeling is shown by the body and the face, never by a word for it. Nobody just stands and faces the lens while the relation happens.
- Everything that happens between people, or between a person and a thing, is staged as choreography, whatever it is - a fight, a dance, a band playing together, a chase, a ritual, a meeting: each shot is one or two beats of it. Say who moves first, with what and how fast, where it lands, what the other does in the same moment, and what it does to the one it touches (the one who is hit gives way, falls, staggers or holds, according to how they were hit). The people move through the place - they close in, give ground, come from where the staging says - and do not stand still while the action happens off to the side.
- People are individuals, not a chorus line. Two people in one picture never do the same thing at the same moment: each has their own action, direction, height, target and timing - one starts, the next answers after the first one's move, another reacts to what was done (flinches, gives ground, takes the blow, hangs back, helps someone up), one is a step slower or faster. Never "they all raise", "they swing together", "in unison" or "in a staggered line" for people of a fight, a march or a search; unison is only for something the story itself does together (a chant, a drill) - and even then each has their own face, gesture or small difference. Different weapons and different builds move differently: use what each one carries and is.
- A cast entry with "group": true is a crowd in one entry, and the beat says how many of it are there ("groupSize"). Its entry says how it breaks up - at least three different things when it is four or more: who goes first, who hangs back, who is struck and how, who falls or turns, who goes where - so the crowd is never one body doing one thing, and it moves through the place from where the staging says.
- A fight is an exchange over its shots, not one blow: a blow lands and the shot goes on with what it does (the one hit gives way, the other answers, the first parries, someone comes in from the side) up to the next blow. No "hold at the peak" or "hold the pose" for a fight, and "hold": true is never a fight shot. After a clash the two sides do not stand side by side: one gives ground, falls, flees or is driven back, according to the story.
- A listener, a bystander or a band member who does not sing stays in the picture whenever the staging has them near the shot, doing something of their own (playing, or moving with the event: a step, a turn, a hand that lifts or grips - never only watching or reacting with the eyes) - and does not sing.
- In a shot with three or more people in the picture - above all a wide one - nobody just stands there, and a wide shot is not a group portrait. "stays", "holds still", "stands", "watches", "waits" and "looks at" are not what a person does there: only whoever sings, plays or works at one spot stays in place, and even their body does something the camera sees (the weight shifts, the hands work, the head turns to someone). Everybody else has a movement of the body - a step toward or away, a turn, a hand or a tool that lifts, lowers or is passed on, a crouch, a lean - with its direction relative to the others; what they look at belongs to that movement ("steps aside to let Kae pass, eyes on her"), it does not replace it. At least two different people in such a shot change where they are in the place, in different directions or at different moments, and the people at the back move as much as the ones in front.
- When a singer sings in a shot ("singingPerShot" true), the singer is in "characters", the face and the mouth are in view (three-quarter or profile is right when the singer looks at something: at the opponent, at the others, at the danger - the lens is never the target; not hidden, not too small), and the singing is part of the action: sung through effort, shouted at the other, drawn between breaths, over the blow - a singer in a fight keeps fighting while they sing, reacts with the whole body and does not turn to the lens to perform. The camera may follow the action (track, arc, handheld) as long as the mouth stays in view. Whoever plays an instrument that is audible in the shot ("activePerShot" true) is in it with the instrument in their hands.
- "framing" is the shot size and angle ("wide shot", "medium close-up", "low-angle medium shot") - what can show everyone "characters" lists - and "camera" is one sentence with the movement and its speed (no times or durations in it - how long a shot is, is not yours to say). Every shot is a new camera position: no two in a row with the same movement, and "view" says where the camera stands and what it looks toward, in terms of the staging, on the same side of the action within one beat unless the story crosses it. "hold" is true for a shot in which nobody moves from where they are and the camera stays: the clip then keeps the framing from the first frame to the last.
- Name characters by their "name" from "cast" below (not pronouns, and never the "id" that "characterIds"/"castProps" use - it only says who is meant), so every shot reads on its own. Use the name exactly as spelled and capitalized in "cast" - this exact string is what binds the sentence to that character's reference picture later, so a paraphrase ("the orc", "an old woman", "a ghost") leaves the action unanchored to anyone and the wrong on-screen figure ends up performing it. This applies even to a collective/group character (e.g. a cast entry named "Orcs" fighting as several individuals) - still call them "Orcs" in the sentence, never a generic singular like "the orc" or "an orc warrior".
- A beat may list "props": for each entry, "activePerShot" gives one true/false flag per shot of that beat, in order, for whether that character's instrument is actually audible in the song at that point. On a shot where the flag is true, show that character actively using the prop - pick whatever action fits the instrument and the moment (playing, strumming, striking, etc.), your choice of words. On a shot where the flag is false, do not show them actively using it - they hold it still, rest it, set it down, or do something else with their hands instead. Characters with no "props" entry are unaffected by this rule.
- A beat may list "singing": "singerIds" are the characters whose voice is the song's vocals, and "singingPerShot" gives one true/false flag per shot of that beat for whether a lyric is actually sung at that point. A singer only sings on shots flagged true. On a shot flagged false they make no sound at all - no singing, crying out, calling, humming or "a voice that joins" - even if the beat's "summary" or "moments" say so (the music there is purely instrumental); show them doing something silent instead (listening, breathing, watching, reacting, standing ready). Characters with no "singing" entry are unaffected.

Answer in exactly this line format and nothing else - one field per line, no JSON, no markdown. A field is always one line (no line breaks inside it), "people" entries are the "person:" lines, "characters" are the names separated by commas, "rest" is what everybody in "characters" without a "person:" line does at the same time:
STAGING: <the floor plan of the place for this beat, 2-4 sentences, on one line> - only when the input says to write the staging
SHOT <number>
framing: <shot size and angle>
size: <wide, medium or close - the size class of the framing>
camera: <one sentence: the movement and its speed>
view: <where the camera stands and what it looks toward>
hold: <yes or no>
risky: <yes only if the action could only be written with a blank or missing face, a stand-in object for a name or feeling, or readable text - else no>
characters: <Name>, <Name>
action: <what happens in the shot, at most two sentences>
person: <Name> | state: <...> | frame: <...> | motion: <...> | singing: <yes if this person sings or moves their mouth to the lyrics in this shot, else no>
person: <Name> | state: <...> | frame: <...> | motion: <...> | singing: <yes or no>
rest: <what the others in the picture do>
(then SHOT <next number> with the same fields, up to the last shot this call writes)
ENDS - only when the input says that this call writes the last shot of the beat:
end: <Name> | <where they are and what they do and hold when the beat is over, a phrase with a verb>
(one "end:" line for every character of the beat - the next beat starts from it)`

/** What the planner knows of the whole song - the same for every call of a run. */
export type PlanContext = {
    characters: Character[],
    // what the reference pictures show - the planner stages in the place of the picture, with the people of the pictures
    locations: Location[],
    characterDescriptions: Record<string, string>,
    locationDescriptions: Record<string, string>,
    continuity: ProjectConfig['continuity'],
    slots: Slot[],
    mapping: Assignment[],
    shotCounts: Record<string, number>,
    beatProps?: Record<string, { characterId: string, prop: string, activePerShot: boolean[] }[]>,
    beatSinging: Record<string, { singerIds: string[], singingPerShot: boolean[] }>,
}

// one planner call writes at most a few shots of one beat: the answer is short, in lines and not in JSON, so that a broken
// bracket or a quote in a sentence costs a few shots at most, not a beat
export type Chunk = { from: number, to: number, total: number, written: unknown[], staging?: string }

export function planPrompt({characters: cast, locations, characterDescriptions, locationDescriptions, continuity, slots: clipSlots, mapping, shotCounts, beatProps, beatSinging}: PlanContext, block: StoryBeat[], finished: { beat: StoryBeat, plan: BeatShots } | undefined, after: StoryBeat | undefined, problems: string[], chunk: Chunk): AskOptions {
    return {
        reasoning: 'medium',
        // thinking at medium easily takes 12k+ tokens on its own, the staged shots come on top
        maxTokens: 16384,
        input: `castProps: ${JSON.stringify(Object.fromEntries(cast.filter(c => c.prop).map(c => [c.id, c.prop])))}
cast: ${JSON.stringify(cast.map(c => ({id: c.id, name: c.name, ...(c.isGroup ? {group: true} : {})})))}
${chunk.from > 0 ? `Already written for this beat (do not write it again): ${JSON.stringify({staging: chunk.staging, shots: chunk.written})}
` : ''}${finished ? `Already written - the staging and the end of the beat "${finished.beat.id}", which comes right before the first beat below (do not write it again): ${JSON.stringify({staging: finished.plan.staging, ends: finished.plan.ends, lastShot: finished.plan.shots.at(-1)})}
The first beat below follows directly after it: start from where it ends - where everyone stands, what they hold - unless it opens a new scene.
` : ''}${after ? `For orientation only - the beat after the last beat below ("${after.id}"): ${after.summary}
Let the last shot of the last beat below lead toward it, and write nothing for it.
` : ''}place (as its reference picture shows it): ${JSON.stringify(Object.fromEntries([...new Set(block.map(b => b.locationId))].map(id => [id, {name: locations.find(l => l.id === id)?.name ?? id, description: locationDescriptions[id] ?? ''}])))}
looks (as their reference pictures show them): ${JSON.stringify(Object.fromEntries([...new Set(block.flatMap(b => b.characterIds))].map(id => [cast.find(c => c.id === id)?.name ?? id, characterDescriptions[id] ?? ''])))}
beats (write shots only for these):
${JSON.stringify(block.map(b => ({
            id: b.id, summary: b.summary, moments: b.moments, kind: b.kind, characterIds: b.characterIds, locationId: b.locationId,
            ...(isContinuous(b, continuity) ? {continuous: true} : {}),
            ...(b.groupSize && Object.keys(b.groupSize).length ? {groupSize: b.groupSize} : {}),
            ...(clipSlots.some(sl => sl.micro && mapping[sl.index]?.beatId === b.id) ? {micro: true} : {}),
            shotsNeeded: shotCounts[b.id] ?? 1,
            ...(beatProps?.[b.id]?.length ? {props: beatProps[b.id]} : {}),
            ...(beatSinging[b.id] ? {singing: beatSinging[b.id]} : {}),
        })))}

This call writes ${chunk.from > 0 || chunk.to < chunk.total ? `ONLY shots ${chunk.from + 1} to ${chunk.to} of the ${chunk.total} that the beat needs ("shotsNeeded")` : `all ${chunk.total} shots of the beat`}.${chunk.from === 0 ? ' Write the STAGING line first.' : ' The staging and the shots before them are given above - continue from the last of them, without a STAGING line.'}${chunk.to === chunk.total ? ' This call writes the last shot of the beat: end with the ENDS block.' : ' It does not write the last shot of the beat: no ENDS block.'}${problems.length ? `\n\nYour last answer had these problems - fix them:\n${problems.map(p => `- ${p}`).join('\n')}` : ''}`,
        instructions: planInstructions,
    }
}

/**
 * The calls of one beat: `perCall` shots each. Asked again (`issues` of the first answer, which had `previousShots`
 * shots), a call whose shots have no problem keeps its first answer, the others are asked with their own problems; a
 * problem of the whole beat (its shot count) asks every call again - the shots after it would no longer line up.
 */
export function plannerCalls(total: number, perCall: number, again?: { issues: { shot?: number, message: string }[], previousShots: number }) {
    const askAll = !again || again.issues.some(i => i.shot === undefined)
    const calls: { from: number, to: number, keep: boolean, problems: string[] }[] = []
    for (let from = 0; from < total; from += perCall) {
        const to = Math.min(total, from + perCall)
        const problems = (again?.issues ?? []).filter(i => i.shot === undefined || (i.shot >= from && i.shot < to)).map(i => i.message)
        calls.push({from, to, keep: !askAll && !problems.length && again!.previousShots >= to, problems})
    }
    return calls
}
