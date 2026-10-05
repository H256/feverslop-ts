// Ready-made film styles - the text of each one is what goes into input/style.txt. Used to pick a style when a
// project has none (see pickStyle), and the source of docs/style-examples.md (bun run styles:doc).
// Each text names the medium first and describes how it is shot, drawn or built - see lookRules in prompts.ts.
// A style is the LOOK only: medium, stock or rendering, lens, light, palette, grain, camera behavior. No places, props,
// costumes, weather or people - the style is applied to every scene of a film, so whatever it names (cigarette smoke,
// castle sets, wigs) would show up in all of them. The story brings the content; no readable text (title cards, stamps).

export type FilmStyle = {id: string, group: string, name: string, text: string}

const live = 'Live action - eras'
const liveLook = 'Live action - genres and looks'
const anime = '2D animation - anime'
const cartoon = '2D animation - western and graphic'
const craft = '3D animation and craft'
const painted = 'Painted, drawn and printed'
const medium = 'Found media and experiments'

export const STYLES: FilmStyle[] = [
    // ---- live action, by era
    {id: 'silent-expressionism', group: live, name: 'Silent-era expressionism', text: 'Black-and-white silent film in the manner of German expressionism (Nosferatu, Caligari): hard high-contrast light with long distorted shadows, exaggerated canted angles, iris-in and iris-out transitions, flickering orthochromatic contrast, visible film scratches.'},
    {id: 'silent-slapstick', group: live, name: 'Silent slapstick', text: 'Black-and-white 1920s silent comedy film: hand-cranked slightly fast motion, flat even daylight, wide static framing, sepia-toned scratched film stock.'},
    {id: 'golden-age-technicolor', group: live, name: 'Hollywood Technicolor', text: '1940s-50s three-strip Technicolor look: soft-focus key light, saturated reds and teals, formal three-point studio lighting, slow tracking camera moves, glossy polished finish.'},
    {id: 'film-noir', group: live, name: 'Film noir', text: 'Black-and-white 35mm film in the manner of 1940s film noir: hard low-key lighting, deep focus, tilted frames, hard contrast with crushed blacks, fine silver grain.'},
    {id: 'hammer-horror', group: live, name: 'Hammer-style gothic horror', text: '1960s British gothic horror on saturated Eastmancolor: theatrical studio lighting, bright blood-red against deep green and blue shadows, strong saturated color contrast, slow theatrical dolly-ins.'},
    {id: 'french-new-wave', group: live, name: 'French New Wave', text: 'Black-and-white 35mm art-house film in the manner of the French New Wave: handheld camerawork in natural light, jump cuts, long walking takes, grainy high-contrast stock.'},
    {id: 'italo-western', group: live, name: 'Spaghetti western', text: 'Italian spaghetti-western look on widescreen 35mm: extreme close-ups, sun-bleached dust-yellow palette, hard high-noon light with long shadows, slow zooms, wide anamorphic compositions.'},
    {id: 'giallo', group: live, name: 'Giallo thriller', text: '1970s Italian giallo thriller look: saturated primary-color gels (red, blue, green) on stark white light, subjective stalking camera, sudden zooms, extreme close-ups, glossy 1970s finish.'},
    {id: 'new-hollywood-70s', group: live, name: '1970s New Hollywood', text: 'Gritty 1970s American drama shot on 35mm: warm brown-and-amber palette, underexposed available light, slow creeping zooms, grainy stock, soft low-contrast image.'},
    {id: 'grindhouse-70s', group: live, name: '70s grindhouse', text: '1970s grindhouse exploitation print look: scratched and faded film with splices and reel-change marks, oversaturated red and orange, crash zooms, handheld camera, rough low-budget image quality.'},
    {id: 'blockbuster-80s', group: live, name: '1980s blockbuster', text: '1980s adventure blockbuster look on 35mm anamorphic: backlit haze with shafts of light, saturated primary colors, practical-effects feel, sweeping crane shots, lens flares.'},
    {id: 'neon-thriller-80s', group: live, name: '80s neon thriller', text: '1980s neon-lit thriller look: pastel pink and teal palette, glossy high-contrast night photography, soft diffusion filters, chrome-and-glass sheen, smooth gliding camera.'},
    {id: 'indie-90s', group: live, name: '1990s indie', text: '1990s low-budget indie look: Super 16 grain, slightly blown-out highlights, flat available light, muted green-grey palette, handheld framing.'},
    {id: 'hong-kong-action', group: live, name: 'Hong Kong action', text: '1990s Hong Kong action film look: step-printed slow motion and smeared motion blur, saturated neon green and red, mirrored slow-motion close-ups, slightly soft anamorphic image.'},
    {id: 'dogme-handheld', group: live, name: 'Dogme 95 handheld', text: 'Raw handheld digital-video drama look: no added light, shaky natural-light photography, jump cuts, washed-out color, visible lens smudges, abrupt focus hunting.'},
    {id: 'y2k-music-video', group: live, name: 'Y2K music video', text: 'Late-1990s/2000 music-video look: fisheye-lens close-ups, glossy blue-white and chrome palette, fast whip pans, overexposed flash highlights, digital glitter.'},
    {id: 'digital-blockbuster-2000s', group: live, name: '2000s digital blockbuster', text: '2000s digital-intermediate blockbuster look: heavy teal-and-orange grade, desaturated mids, shaky-cam, gritty bleached highlights, smooth CG-polished image.'},
    {id: 'prestige-drama', group: live, name: 'Modern prestige drama', text: 'Contemporary prestige streaming drama look on digital cinema cameras: shallow depth of field, naturalistic motivated light, desaturated teal-and-amber grade, slow push-ins, restrained handheld, clean sharp image.'},
    {id: 'slow-arthouse', group: live, name: 'Slow art-house', text: 'Contemplative contemporary art-house cinema look: long static takes, wide locked-off frames, natural overcast light, muted earth colors, no camera movement.'},
    {id: 'pastel-dollhouse', group: live, name: 'Pastel dollhouse symmetry', text: 'Live action in a strictly symmetrical dollhouse style: centered compositions, flat frontal framing, pastel pink, mint and mustard palette, flat even light, deadpan staging, lateral tracking shots.'},

    // ---- live action, genres and looks
    {id: 'nordic-noir', group: liveLook, name: 'Nordic noir', text: 'Cold, bleached Scandinavian crime-thriller look: overcast flat light, pale blue-grey palette, muted desaturated color, long static wide shots, slow still camera.'},
    {id: 'documentary-handheld', group: liveLook, name: 'Handheld documentary', text: 'Handheld documentary look on a consumer camcorder: auto-exposure pumping, digital noise, blown-out on-camera light, off-center framing, snap zooms, harsh flash in the dark.'},
    {id: 'found-footage', group: liveLook, name: 'Found footage horror', text: 'Found-footage look on a shaky night-vision handheld camera: green-tinted infrared image, digital compression artifacts, crushed darkness, panicked shaky framing.'},
    {id: 'cctv-surveillance', group: liveLook, name: 'CCTV surveillance', text: 'Security-camera footage look: fixed high wide-angle corner viewpoint, grainy desaturated image, fisheye distortion, low frame rate with jerky motion, high camera angles looking down.'},
    {id: 'mockumentary', group: liveLook, name: 'Mockumentary', text: 'Mockumentary sitcom look: single handheld camera with awkward zooms, flat fluorescent light, glances to the lens, slightly washed-out digital video.'},
    {id: 'folk-horror', group: liveLook, name: 'Folk horror', text: 'Pastoral folk-horror look: bright overcast daylight, 16mm grain, muted earth colors, dread in broad daylight, slow handheld camera creeping in.'},
    {id: 'gothic-horror', group: liveLook, name: 'Gothic horror', text: 'Gothic horror look on 35mm: warm candle-like light against cold moonlight blue, crushed black shadows, slow dolly-ins, deep crimson accents against desaturated greys.'},
    {id: 'cyberpunk-neon', group: liveLook, name: 'Neon cyberpunk', text: 'Cyberpunk look shot on anamorphic digital: magenta and cyan neon light against black, wet reflective surfaces, hazy backlight, long-lens compression.'},
    {id: 'cold-scifi', group: liveLook, name: 'Cold hard sci-fi', text: 'Cold hard science-fiction look: sterile flat even fluorescent light, clean hard-edged compositions, sharp highlights against deep black, slow push-ins, restrained handheld, muted blue-grey palette.'},
    {id: 'retro-scifi-70s', group: liveLook, name: '70s retro sci-fi', text: '1970s science-fiction look on grainy 35mm: orange-and-brown palette, matte-painting and practical-model feel, soft lens flares, slow zooms, gritty lived-in texture.'},
    {id: 'post-apocalyptic', group: liveLook, name: 'Post-apocalyptic wasteland', text: 'Post-apocalyptic look: bleached dust-brown and rust palette, harsh hard sun, low-angle shots, gritty handheld, orange-and-teal grade.'},
    {id: 'road-movie', group: liveLook, name: 'Sun-bleached road movie', text: 'Sun-bleached road-movie look on 16mm: overexposed highlights, warm dust-orange and faded denim-blue palette, heat-haze distortion, lens flares, low-angle shots.'},
    {id: 'epic-fantasy-live-action', group: liveLook, name: 'Epic fantasy', text: 'Live-action epic fantasy look on large-format digital: sweeping drone-like camera moves, golden-hour light through haze, emerald and silver palette, dynamic camera choreography, matte-painted depth.'},
    {id: 'candlelit-period-drama', group: liveLook, name: 'Candlelit period drama', text: 'Period-drama look lit only by candle and window light: warm amber glow with deep soft shadows, slow zooms out like moving paintings, symmetrical stately compositions.'},
    {id: 'desaturated-war-film', group: liveLook, name: 'Desaturated war film', text: 'Desaturated war-film look: muddy grey-green and brown palette, handheld camera, shutter-angle staccato motion, shaky close-ups, grit and smears on the lens.'},
    {id: 'glossy-romcom', group: liveLook, name: 'Glossy romantic comedy', text: 'Glossy romantic-comedy look: bright high-key light, warm pastel palette, soft diffused skin tones, golden-hour warmth, soft bokeh highlights, smooth steadicam moves.'},

    // ---- anime
    {id: 'cel-anime-90s', group: anime, name: '90s cel anime', text: '2D anime in the style of 1990s cel animation: hand-painted backgrounds, flat cel shading with two-tone shadows, clean dark linework, limited animation timing, speed lines on action, slightly faded film color.'},
    {id: 'ghibli-pastoral', group: anime, name: 'Ghibli-style pastoral', text: 'Hand-painted Ghibli-style anime look: lush watercolor backgrounds, soft pastel shading, thin colored outlines, warm daylight, gentle painterly detail.'},
    {id: 'dark-modern-anime', group: anime, name: 'Dark modern anime', text: 'Modern dark-fantasy anime: crisp digital linework, high-contrast cel shading with hard black shadows, saturated accent colors against a muted palette, cinematic wide compositions, dramatic low angles, glowing particle effects.'},
    {id: 'ova-80s', group: anime, name: '80s OVA / city pop', text: 'Retro 1980s anime in the style of OVA cel animation: soft airbrushed backgrounds, purple-and-pink dusk palette, glossy highlights, slightly grainy VHS-transfer look, melancholic lighting.'},
    {id: 'shonen-action', group: anime, name: 'Shonen action', text: 'Shonen action anime look: bold thick outlines, saturated primary colors, extreme foreshortened perspective, impact frames with white flashes, speed lines, glowing energy auras, dynamic hand-drawn smear frames.'},
    {id: 'shojo-romance', group: anime, name: 'Shojo romance', text: 'Shojo romance anime look: soft pastel palette, sparkling highlights in large expressive eyes, thin delicate linework, overexposed bloom around the characters, warm soft afternoon light.'},
    {id: 'seinen-thriller', group: anime, name: 'Seinen thriller', text: 'Adult seinen thriller anime look: realistic proportions, muted grey-green palette, fine hatching shadows, restrained limited motion, cold fluorescent light, long still holds.'},
    {id: 'mecha-anime', group: anime, name: 'Mecha anime', text: '1990s mecha anime look: glossy hard-surface shading with panel lines and highlights, cel-shaded effects, moody sunset color, tilted dramatic camera angles, hand-painted backgrounds.'},
    {id: 'lofi-anime', group: anime, name: 'Lo-fi anime', text: 'Cozy lo-fi anime look: soft muted pastel palette, warm window-like light, tiny looping gentle motion, flat shading with a faint film grain, calm quiet pacing.'},
    {id: 'rotoscope', group: anime, name: 'Rotoscoped look', text: 'Rotoscoped animation: live-action movement traced into wobbly hand-drawn outlines, flat watercolor fills that drift slightly out of the lines, shimmering line boil, loose naturalistic motion, dreamy muted colors.'},
    {id: 'chibi-comedy', group: anime, name: 'Chibi comedy', text: 'Chibi comedy anime: tiny big-headed characters, exaggerated squash-and-stretch reactions, sweat drops and anger veins, bright flat candy colors, simple clean backgrounds, quick snappy timing.'},

    // ---- western 2D and graphic
    {id: 'comic-graphic-novel', group: cartoon, name: 'Comic / graphic novel', text: 'Inked graphic-novel look: heavy black ink outlines, flat cel-colored shapes with halftone dot shading, bold saturated spot colors, panel-like compositions, dynamic foreshortening, stylized motion lines.'},
    {id: 'midcentury-cartoon', group: cartoon, name: 'Mid-century cartoon', text: 'Flat 1950s mid-century cartoon style: simple geometric shapes, limited color palette, textured paper backgrounds, minimal shading, retro lounge colors (mustard, teal, walnut), snappy stylized motion.'},
    {id: 'disney-renaissance', group: cartoon, name: 'Classic Disney musical', text: 'Hand-drawn 1990s Disney-style animation look: fluid expressive animation, soft painted backgrounds with rich color, glowing magical light effects, big sweeping camera moves, warm rounded design.'},
    {id: 'rubber-hose-1930s', group: cartoon, name: '1930s rubber-hose cartoon', text: 'Black-and-white 1930s rubber-hose cartoon: noodle limbs and pie-cut eyes, everything bouncing to a beat, scratchy film grain, flickering exposure, simple painted backdrops.'},
    {id: 'saturday-morning', group: cartoon, name: 'Saturday-morning cartoon', text: '1980s Saturday-morning cartoon look: flat bright cel colors, thick simple outlines, limited animation with held poses, repeated action loops, painted gradient backgrounds, slightly grainy broadcast look.'},
    {id: 'flat-vector-comedy', group: cartoon, name: 'Flat vector comedy', text: 'Modern flat-vector adult cartoon look: clean uniform outlines, simple geometric shapes, solid color fills with no shading, deadpan staging, static wide shots with minimal motion, bright flat palette.'},
    {id: 'ligne-claire', group: cartoon, name: 'Ligne claire comic', text: 'European ligne-claire comic look: clean even-weight outlines, flat bright colors without hatching, meticulously detailed backgrounds, simple expressive faces, no texture or grain.'},
    {id: 'sumi-e-ink', group: cartoon, name: 'Black ink wash', text: 'Black ink wash drawing in the manner of East Asian sumi-e: brush strokes on rough paper, grey gradients, negative space as fog, a single red seal-colored accent, minimal detail, slow drifting motion.'},

    // ---- 3D and craft
    {id: 'pixar-3d', group: craft, name: 'Pixar-style 3D', text: 'Polished 3D animation in the style of modern Pixar films: soft global illumination, rounded expressive characters, subsurface skin and fabric detail, saturated warm color, shallow depth of field, clean cinematic camera moves.'},
    {id: 'stylized-cgi', group: craft, name: 'Stylized glossy CGI', text: 'Glossy stylized CGI render: smooth plastic-like surfaces, slightly exaggerated proportions, saturated colors with strong rim light, soft studio-style shadows, simplified shapes and textures, floaty animation, clean video-game-trailer look.'},
    {id: 'low-poly', group: craft, name: 'Low-poly 3D', text: 'Stylized low-poly 3D look: flat-shaded faceted geometry, bold unlit color planes, simple gradient backgrounds, minimal textures, soft ambient occlusion, toy-like diorama compositions.'},
    {id: 'ps1-retro-3d', group: craft, name: 'PS1 retro 3D', text: 'Early-PlayStation 3D look: chunky low-polygon models, wobbling vertices, affine-warped low-resolution textures, dithered shading, fog-limited draw distance, limited color palette, stiff jointed animation.'},
    {id: 'cel-shaded-3d', group: craft, name: 'Cel-shaded 3D', text: 'Cel-shaded 3D animation look: hard two-tone shadow edges, bold ink outlines around 3D models, flat color textures, hand-painted-looking backgrounds, anime-style poses rendered on a moving 3D camera.'},
    {id: 'spiderverse-comic-3d', group: craft, name: 'Comic-book 3D', text: 'Comic-book-style 3D animation look: halftone dot shading and ink hatching on 3D models, offset color-print misregistration, animated on twos, bold graffiti-like color fields, dynamic comic camera angles.'},
    {id: 'game-cinematic', group: craft, name: 'AAA game cinematic', text: 'High-end video-game cinematic look: photoreal CG with dramatic volumetric lighting, detailed skin and material rendering, slow motion, anamorphic lens flares, particle-filled air, heavily graded teal and orange.'},
    {id: 'voxel-blocks', group: craft, name: 'Voxel block world', text: 'Voxel block look: everything built from cubic blocks, bright flat-lit colors, soft pixel-like textures, simple blocky animation, isometric-ish camera angles, sunny cheerful light.'},
    {id: 'stop-motion-puppets', group: craft, name: 'Stop-motion puppets', text: 'Stop-motion animation with handmade puppets: visible fabric weave and thumbprints in clay, slightly jittery 12 fps movement, miniature-scale sets with practical lights, shallow macro depth of field, muted handmade colors.'},
    {id: 'claymation', group: craft, name: 'Claymation', text: 'Plasticine claymation look: soft rounded forms with fingerprint marks, exaggerated squash and stretch, saturated candy colors, miniature-scale sets, slightly uneven studio lighting.'},
    {id: 'papercut-theatre', group: craft, name: 'Papercut theatre', text: 'Layered paper-cutout animation: flat cut shapes with visible paper fibers and torn edges, parallax layers lit from behind, soft cast shadows between layers, limited earthy palette, puppet-theatre staging.'},
    {id: 'felt-puppets', group: craft, name: 'Felt hand puppets', text: 'Felt hand-puppet show: fuzzy fabric characters with big button eyes, visible stitching, simple handmade cardboard sets, bright primary colors, slightly bouncy puppeteer movement, soft even studio light.'},
    {id: 'tilt-shift-miniature', group: craft, name: 'Tilt-shift miniature', text: 'Tilt-shift miniature look: scenes shot to look like tiny scale models, extreme shallow focus band, oversaturated toy-like color, high overhead angles, speeded-up time-lapse motion.'},

    // ---- painted, drawn, printed
    {id: 'gothic-oil', group: painted, name: 'Dark gothic oil painting', text: 'Dark gothic oil painting in the manner of Caravaggio: heavy chiaroscuro, candlelight only, visible brush strokes and craquelure, deep oxblood and umber tones, pale highlights against black.'},
    {id: 'medieval-woodcut', group: painted, name: 'Medieval woodcut', text: 'Melancholic medieval woodcut look: bold carved black lines, hatched shading, desaturated grey-brown paper with a single blood-red accent, flat stacked perspective, ornamental borders.'},
    {id: 'watercolor-storybook', group: painted, name: 'Watercolor storybook', text: 'Soft watercolor storybook illustration: wet-on-wet washes bleeding into paper texture, loose ink outlines, pastel palette with warm highlights, gentle vignette edges.'},
    {id: 'art-deco-poster', group: painted, name: 'Art deco poster', text: 'Art deco travel-poster style: flat gouache color fields, sharp geometric shapes, gold and deep-teal palette, strong symmetrical compositions, elegant poster composition.'},
    {id: 'synthwave', group: painted, name: 'Retro synthwave', text: 'Retro synthwave illustration: neon pink and cyan gradients, wireframe grid lines, chrome reflections, scanlines and chromatic glow, dark purple tones, airbrushed 1980s sci-fi look.'},
    {id: 'impressionist', group: painted, name: 'Impressionist painting', text: 'Impressionist oil painting: short visible dabs of broken color, shimmering light, soft undefined edges, pastel haze, blurred motion.'},
    {id: 'ukiyo-e', group: painted, name: 'Ukiyo-e woodblock', text: 'Japanese ukiyo-e woodblock print: flat color areas with bold black outlines, visible wood grain, indigo and vermilion palette, flattened perspective, cream paper.'},
    {id: 'pop-art', group: painted, name: 'Pop art', text: 'Pop-art silkscreen look: flat bold primary colors, thick black outlines, Ben-Day dot halftones, high-contrast repeated panels, glossy magazine-cutout energy, loud yellows, reds and blues.'},
    {id: 'constructivist-poster', group: painted, name: 'Constructivist propaganda poster', text: 'Constructivist propaganda poster look: bold diagonal compositions, flat red, black and cream shapes, heavy angular blocks, heroic low-angle framing, rough printed paper texture, strict geometric graphic design.'},
    {id: 'linocut-print', group: painted, name: 'Linocut print', text: 'Two- and three-color linocut print: chunky carved black shapes, rough ink coverage with gaps, flat color overlays slightly off-register, simplified forms, bold graphic shapes on cream paper.'},
    {id: 'risograph', group: painted, name: 'Risograph print', text: 'Risograph print look: limited overprinting inks (fluorescent pink, teal, yellow), grainy halftone texture, slight misregistration, flat shapes, soft paper tooth, indie zine illustration energy.'},
    {id: 'charcoal-sketch', group: painted, name: 'Charcoal and pencil sketch', text: 'Charcoal and graphite sketch: smudged soft blacks, visible hatching strokes and eraser highlights, loose construction lines left in, white paper tone, rough unfinished edges, slightly trembling line-boil animation.'},
    {id: 'art-nouveau', group: painted, name: 'Art nouveau', text: 'Art nouveau illustration in the manner of Mucha: flowing whiplash lines, ornamental floral borders, pale muted gold, sage and rose palette, flat decorative areas with fine outlines, halo-like circular framing.'},
    {id: 'nordic-folk-art', group: painted, name: 'Scandinavian folk-tale painting', text: 'Scandinavian folk-tale gouache painting: muted earth and mossy greens, soft diffused light, flat storybook shapes, textured paper, visible brush strokes.'},
    {id: 'baroque-opulence', group: painted, name: 'Baroque opulence', text: 'Baroque look: strong chiaroscuro contrast, rich velvet reds and gilded gold, dramatic theatrical lighting, sweeping asymmetric compositions.'},
    {id: 'stained-glass', group: painted, name: 'Stained glass', text: 'Stained-glass window look: flat jewel-toned color panes divided by thick black lead lines, light glowing through from behind, rigid flattened poses, ornate gothic tracery.'},
    {id: 'tarot-card', group: painted, name: 'Vintage tarot card', text: 'Vintage tarot-card illustration look: ornate decorative border, flat fills and fine ink lines, faded cream paper, muted red, gold and teal, slightly worn print.'},
    {id: 'pulp-paperback', group: painted, name: 'Pulp paperback cover', text: '1950s pulp paperback cover painting look: saturated gouache with dramatic hard lighting, lurid reds and yellows, strong menacing shadows, rough print texture, slightly faded cover wear.'},

    // ---- found media and experiments
    {id: 'super8-home-movie', group: medium, name: 'Super 8 home movie', text: 'Super 8 home-movie footage look: warm faded color with light leaks and burnt-edge flashes, soft focus and heavy grain, shaky amateur framing, gate weave and dust, golden light.'},
    {id: 'vhs-camcorder', group: medium, name: 'VHS camcorder', text: '1990s VHS camcorder footage look: smeared colors, tracking glitches and horizontal noise bands, low resolution, overexposed highlights, cheap handheld pans, bleeding red channels.'},
    {id: 'double-exposure-dream', group: medium, name: 'Double-exposure dream', text: 'Dreamlike double-exposure imagery: subjects dissolving into each other, translucent overlays, soft glowing edges, desaturated blues and golds, slow fades.'},
    {id: 'monochrome-red-accent', group: medium, name: 'Monochrome with one red accent', text: 'High-contrast black-and-white cinematography with a single saturated red accent, everything else in grey tones, deep blacks, grainy film stock, graphic composition.'},
    {id: 'shadow-puppet-theatre', group: medium, name: 'Shadow-puppet theatre', text: 'Shadow-puppet theatre look: flat black cut-out silhouettes with jointed limbs against a glowing translucent screen, warm amber backlight, hand-cut ornate detail, stage-curtain framing.'},
    {id: 'cyanotype-blueprint', group: medium, name: 'Cyanotype blueprint', text: 'Cyanotype print look: everything in deep Prussian blue and white, soft chalky tones, visible brush edges on the paper, delicate fine detail, slow dreamy movement.'},
    {id: 'psychedelic-60s', group: medium, name: '60s psychedelia', text: '1960s psychedelic visuals: kaleidoscopic mirrored patterns, melting liquid-light projection, saturated orange, magenta and electric blue, flowing paisley textures, trippy slow zooms.'},
    {id: 'unplugged-stage', group: medium, name: 'Intimate unplugged stage', text: 'Intimate unplugged stage film look: warm stage lighting, soft bokeh from small lights, close handheld framing, shallow depth of field, warm amber and deep blue.'},
]

/** A random style from the list (or from the given candidates). */
export function pickStyle(candidates: FilmStyle[] = STYLES, random = Math.random): FilmStyle {
    return candidates[Math.floor(random() * candidates.length)]!
}

/** The styles in random order - shown to the LLM that way so it can't favor the first entries. */
export function shuffledStyles(random = Math.random): FilmStyle[] {
    const list = [...STYLES]
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[list[i], list[j]] = [list[j]!, list[i]!]
    }
    return list
}

/** The styles with these ids (unknown and repeated ids dropped) - for checking what the LLM shortlisted. */
export function stylesById(ids: unknown): FilmStyle[] {
    if (!Array.isArray(ids)) return []
    const found = ids.map(id => STYLES.find(s => s.id === id)).filter((s): s is FilmStyle => !!s)
    return [...new Set(found)]
}
