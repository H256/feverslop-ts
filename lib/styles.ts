// Ready-made film styles - the text of each one is what goes into input/style.txt. Used to pick a style when a
// project has none (see pickStyle), and the source of docs/style-examples.md (bun run styles:doc).
// Each text names the medium first and describes how it is shot, drawn or built - see lookRules in prompts.ts.
// A style is the LOOK only: medium, stock or rendering, lens, light, palette, grain, camera behavior. No places, props,
// costumes, weather or people - the style is applied to every scene of a film, so whatever it names (cigarette smoke,
// castle sets, wigs) would show up in all of them. The story brings the content; no readable text (title cards, stamps).

export type FilmStyle = {id: string; group: string; name: string; text: string}

const live = 'Live action - eras'
const liveLook = 'Live action - genres and looks'
const anime = '2D animation - anime'
const cartoon = '2D animation - western and graphic'
const craft = '3D animation and craft'
const painted = 'Painted, drawn and printed'
const medium = 'Found media and experiments'

export const STYLES: FilmStyle[] = [
    // ---- live action, by era
    {
        id: 'silent-expressionism',
        group: live,
        name: 'Silent-era expressionism',
        text: 'Black-and-white silent film in the manner of German expressionism (Nosferatu, Caligari): hard high-contrast light with long distorted shadows, exaggerated canted angles, iris-in and iris-out transitions, flickering orthochromatic contrast, visible film scratches.',
    },
    {
        id: 'silent-slapstick',
        group: live,
        name: 'Silent slapstick',
        text: 'Black-and-white 1920s silent comedy film: hand-cranked slightly fast motion, flat even daylight, wide static framing, sepia-toned scratched film stock.',
    },
    {
        id: 'golden-age-technicolor',
        group: live,
        name: 'Hollywood Technicolor',
        text: '1940s-50s three-strip Technicolor look: soft-focus key light, saturated reds and teals, formal three-point studio lighting, slow tracking camera moves, glossy polished finish.',
    },
    {
        id: 'film-noir',
        group: live,
        name: 'Film noir',
        text: 'Black-and-white 35mm film in the manner of 1940s film noir: hard low-key lighting, deep focus, tilted frames, hard contrast with crushed blacks, fine silver grain.',
    },
    {
        id: 'hammer-horror',
        group: live,
        name: 'Hammer-style gothic horror',
        text: '1960s British gothic horror on saturated Eastmancolor: theatrical studio lighting, bright blood-red against deep green and blue shadows, strong saturated color contrast, slow theatrical dolly-ins.',
    },
    {
        id: 'french-new-wave',
        group: live,
        name: 'French New Wave',
        text: 'Black-and-white 35mm art-house film in the manner of the French New Wave: handheld camerawork in natural light, jump cuts, long walking takes, grainy high-contrast stock.',
    },
    {
        id: 'italo-western',
        group: live,
        name: 'Spaghetti western',
        text: 'Italian spaghetti-western look on widescreen 35mm: extreme close-ups, sun-bleached dust-yellow palette, hard high-noon light with long shadows, slow zooms, wide anamorphic compositions.',
    },
    {
        id: 'giallo',
        group: live,
        name: 'Giallo thriller',
        text: '1970s Italian giallo thriller look: saturated primary-color gels (red, blue, green) on stark white light, subjective stalking camera, sudden zooms, extreme close-ups, glossy 1970s finish.',
    },
    {
        id: 'new-hollywood-70s',
        group: live,
        name: '1970s New Hollywood',
        text: 'Gritty 1970s American drama shot on 35mm: warm brown-and-amber palette, underexposed available light, slow creeping zooms, grainy stock, soft low-contrast image.',
    },
    {
        id: 'grindhouse-70s',
        group: live,
        name: '70s grindhouse',
        text: '1970s grindhouse exploitation print look: scratched and faded film with splices and reel-change marks, oversaturated red and orange, crash zooms, handheld camera, rough low-budget image quality.',
    },
    {
        id: 'blockbuster-80s',
        group: live,
        name: '1980s blockbuster',
        text: '1980s adventure blockbuster look on 35mm anamorphic: backlit haze with shafts of light, saturated primary colors, practical-effects feel, sweeping crane shots, lens flares.',
    },
    {
        id: 'neon-thriller-80s',
        group: live,
        name: '80s neon thriller',
        text: '1980s neon-lit thriller look: pastel pink and teal palette, glossy high-contrast night photography, soft diffusion filters, chrome-and-glass sheen, smooth gliding camera.',
    },
    {
        id: 'indie-90s',
        group: live,
        name: '1990s indie',
        text: '1990s low-budget indie look: Super 16 grain, slightly blown-out highlights, flat available light, muted green-grey palette, handheld framing.',
    },
    {
        id: 'hong-kong-action',
        group: live,
        name: 'Hong Kong action',
        text: '1990s Hong Kong action film look: step-printed slow motion and smeared motion blur, saturated neon green and red, mirrored slow-motion close-ups, slightly soft anamorphic image.',
    },
    {
        id: 'dogme-handheld',
        group: live,
        name: 'Dogme 95 handheld',
        text: 'Raw handheld digital-video drama look: no added light, shaky natural-light photography, jump cuts, washed-out color, visible lens smudges, abrupt focus hunting.',
    },
    {
        id: 'y2k-music-video',
        group: live,
        name: 'Y2K music video',
        text: 'Late-1990s/2000 music-video look: fisheye-lens close-ups, glossy blue-white and chrome palette, fast whip pans, overexposed flash highlights, digital glitter.',
    },
    {
        id: 'digital-blockbuster-2000s',
        group: live,
        name: '2000s digital blockbuster',
        text: '2000s digital-intermediate blockbuster look: heavy teal-and-orange grade, desaturated mids, shaky-cam, gritty bleached highlights, smooth CG-polished image.',
    },
    {
        id: 'prestige-drama',
        group: live,
        name: 'Modern prestige drama',
        text: 'Contemporary prestige streaming drama look on digital cinema cameras: shallow depth of field, naturalistic motivated light, desaturated teal-and-amber grade, slow push-ins, restrained handheld, clean sharp image.',
    },
    {
        id: 'slow-arthouse',
        group: live,
        name: 'Slow art-house',
        text: 'Contemplative contemporary art-house cinema look: long static takes, wide locked-off frames, natural overcast light, muted earth colors, no camera movement.',
    },
    {
        id: 'pastel-dollhouse',
        group: live,
        name: 'Pastel dollhouse symmetry',
        text: 'Live action in a strictly symmetrical dollhouse style: centered compositions, flat frontal framing, pastel pink, mint and mustard palette, flat even light, deadpan staging, lateral tracking shots.',
    },

    // ---- live action, genres and looks
    {
        id: 'nordic-noir',
        group: liveLook,
        name: 'Nordic noir',
        text: 'Cold, bleached Scandinavian crime-thriller look: overcast flat light, pale blue-grey palette, muted desaturated color, long static wide shots, slow still camera.',
    },
    {
        id: 'documentary-handheld',
        group: liveLook,
        name: 'Handheld documentary',
        text: 'Handheld documentary look on a consumer camcorder: auto-exposure pumping, digital noise, blown-out on-camera light, off-center framing, snap zooms, harsh flash in the dark.',
    },
    {
        id: 'found-footage',
        group: liveLook,
        name: 'Found footage horror',
        text: 'Found-footage look on a shaky night-vision handheld camera: green-tinted infrared image, digital compression artifacts, crushed darkness, panicked shaky framing.',
    },
    {
        id: 'cctv-surveillance',
        group: liveLook,
        name: 'CCTV surveillance',
        text: 'Security-camera footage look: fixed high wide-angle corner viewpoint, grainy desaturated image, fisheye distortion, low frame rate with jerky motion, high camera angles looking down.',
    },
    {
        id: 'mockumentary',
        group: liveLook,
        name: 'Mockumentary',
        text: 'Mockumentary sitcom look: single handheld camera with awkward zooms, flat fluorescent light, glances to the lens, slightly washed-out digital video.',
    },
    {
        id: 'folk-horror',
        group: liveLook,
        name: 'Folk horror',
        text: 'Pastoral folk-horror look: bright overcast daylight, 16mm grain, muted earth colors, dread in broad daylight, slow handheld camera creeping in.',
    },
    {
        id: 'gothic-horror',
        group: liveLook,
        name: 'Gothic horror',
        text: 'Gothic horror look on 35mm: warm candle-like light against cold moonlight blue, crushed black shadows, slow dolly-ins, deep crimson accents against desaturated greys.',
    },
    {
        id: 'cyberpunk-neon',
        group: liveLook,
        name: 'Neon cyberpunk',
        text: 'Cyberpunk look shot on anamorphic digital: magenta and cyan neon light against black, wet reflective surfaces, hazy backlight, long-lens compression.',
    },
    {
        id: 'cold-scifi',
        group: liveLook,
        name: 'Cold hard sci-fi',
        text: 'Cold hard science-fiction look: sterile flat even fluorescent light, clean hard-edged compositions, sharp highlights against deep black, slow push-ins, restrained handheld, muted blue-grey palette.',
    },
    {
        id: 'retro-scifi-70s',
        group: liveLook,
        name: '70s retro sci-fi',
        text: '1970s science-fiction look on grainy 35mm: orange-and-brown palette, matte-painting and practical-model feel, soft lens flares, slow zooms, gritty lived-in texture.',
    },
    {
        id: 'post-apocalyptic',
        group: liveLook,
        name: 'Post-apocalyptic wasteland',
        text: 'Post-apocalyptic look: bleached dust-brown and rust palette, harsh hard sun, low-angle shots, gritty handheld, orange-and-teal grade.',
    },
    {
        id: 'road-movie',
        group: liveLook,
        name: 'Sun-bleached road movie',
        text: 'Sun-bleached road-movie look on 16mm: overexposed highlights, warm dust-orange and faded denim-blue palette, heat-haze distortion, lens flares, low-angle shots.',
    },
    {
        id: 'epic-fantasy-live-action',
        group: liveLook,
        name: 'Epic fantasy',
        text: 'Live-action epic fantasy look on large-format digital: sweeping drone-like camera moves, golden-hour light through haze, emerald and silver palette, dynamic camera choreography, matte-painted depth.',
    },
    {
        id: 'candlelit-period-drama',
        group: liveLook,
        name: 'Candlelit period drama',
        text: 'Period-drama look lit only by candle and window light: warm amber glow with deep soft shadows, slow zooms out like moving paintings, symmetrical stately compositions.',
    },
    {
        id: 'desaturated-war-film',
        group: liveLook,
        name: 'Desaturated war film',
        text: 'Desaturated war-film look: muddy grey-green and brown palette, handheld camera, shutter-angle staccato motion, shaky close-ups, grit and smears on the lens.',
    },
    {
        id: 'glossy-romcom',
        group: liveLook,
        name: 'Glossy romantic comedy',
        text: 'Glossy romantic-comedy look: bright high-key light, warm pastel palette, soft diffused skin tones, golden-hour warmth, soft bokeh highlights, smooth steadicam moves.',
    },

    // ---- anime
    {
        id: 'cel-anime-90s',
        group: anime,
        name: '90s cel anime',
        text: '2D anime in the style of 1990s cel animation: hand-painted backgrounds, flat cel shading with two-tone shadows, clean dark linework, limited animation timing, speed lines on action, slightly faded film color.',
    },
    {
        id: 'ghibli-pastoral',
        group: anime,
        name: 'Ghibli-style pastoral',
        text: 'Hand-painted Ghibli-style anime look: lush watercolor backgrounds, soft pastel shading, thin colored outlines, warm daylight, gentle painterly detail.',
    },
    {
        id: 'dark-modern-anime',
        group: anime,
        name: 'Dark modern anime',
        text: 'Modern dark-fantasy anime: crisp digital linework, high-contrast cel shading with hard black shadows, saturated accent colors against a muted palette, cinematic wide compositions, dramatic low angles, glowing particle effects.',
    },
    {
        id: 'ova-80s',
        group: anime,
        name: '80s OVA / city pop',
        text: 'Retro 1980s anime in the style of OVA cel animation: soft airbrushed backgrounds, purple-and-pink dusk palette, glossy highlights, slightly grainy VHS-transfer look, melancholic lighting.',
    },
    {
        id: 'shonen-action',
        group: anime,
        name: 'Shonen action',
        text: 'Shonen action anime look: bold thick outlines, saturated primary colors, extreme foreshortened perspective, impact frames with white flashes, speed lines, glowing energy auras, dynamic hand-drawn smear frames.',
    },
    {
        id: 'shojo-romance',
        group: anime,
        name: 'Shojo romance',
        text: 'Shojo romance anime look: soft pastel palette, sparkling highlights in large expressive eyes, thin delicate linework, overexposed bloom around the characters, warm soft afternoon light.',
    },
    {
        id: 'seinen-thriller',
        group: anime,
        name: 'Seinen thriller',
        text: 'Adult seinen thriller anime look: realistic proportions, muted grey-green palette, fine hatching shadows, restrained limited motion, cold fluorescent light, long still holds.',
    },
    {
        id: 'mecha-anime',
        group: anime,
        name: 'Mecha anime',
        text: '1990s mecha anime look: glossy hard-surface shading with panel lines and highlights, cel-shaded effects, moody sunset color, tilted dramatic camera angles, hand-painted backgrounds.',
    },
    {
        id: 'lofi-anime',
        group: anime,
        name: 'Lo-fi anime',
        text: 'Cozy lo-fi anime look: soft muted pastel palette, warm window-like light, tiny looping gentle motion, flat shading with a faint film grain, calm quiet pacing.',
    },
    {
        id: 'rotoscope',
        group: anime,
        name: 'Rotoscoped look',
        text: 'Rotoscoped animation: live-action movement traced into wobbly hand-drawn outlines, flat watercolor fills that drift slightly out of the lines, shimmering line boil, loose naturalistic motion, dreamy muted colors.',
    },
    {
        id: 'chibi-comedy',
        group: anime,
        name: 'Chibi comedy',
        text: 'Chibi comedy anime: tiny big-headed characters, exaggerated squash-and-stretch reactions, sweat drops and anger veins, bright flat candy colors, simple clean backgrounds, quick snappy timing.',
    },

    // ---- western 2D and graphic
    {
        id: 'comic-graphic-novel',
        group: cartoon,
        name: 'Comic / graphic novel',
        text: 'Inked graphic-novel look: heavy black ink outlines, flat cel-colored shapes with halftone dot shading, bold saturated spot colors, panel-like compositions, dynamic foreshortening, stylized motion lines.',
    },
    {
        id: 'midcentury-cartoon',
        group: cartoon,
        name: 'Mid-century cartoon',
        text: 'Flat 1950s mid-century cartoon style: simple geometric shapes, limited color palette, textured paper backgrounds, minimal shading, retro lounge colors (mustard, teal, walnut), snappy stylized motion.',
    },
    {
        id: 'disney-renaissance',
        group: cartoon,
        name: 'Classic Disney musical',
        text: 'Hand-drawn 1990s Disney-style animation look: fluid expressive animation, soft painted backgrounds with rich color, glowing magical light effects, big sweeping camera moves, warm rounded design.',
    },
    {
        id: 'rubber-hose-1930s',
        group: cartoon,
        name: '1930s rubber-hose cartoon',
        text: 'Black-and-white 1930s rubber-hose cartoon: noodle limbs and pie-cut eyes, everything bouncing to a beat, scratchy film grain, flickering exposure, simple painted backdrops.',
    },
    {
        id: 'saturday-morning',
        group: cartoon,
        name: 'Saturday-morning cartoon',
        text: '1980s Saturday-morning cartoon look: flat bright cel colors, thick simple outlines, limited animation with held poses, repeated action loops, painted gradient backgrounds, slightly grainy broadcast look.',
    },
    {
        id: 'flat-vector-comedy',
        group: cartoon,
        name: 'Flat vector comedy',
        text: 'Modern flat-vector adult cartoon look: clean uniform outlines, simple geometric shapes, solid color fills with no shading, deadpan staging, static wide shots with minimal motion, bright flat palette.',
    },
    {
        id: 'ligne-claire',
        group: cartoon,
        name: 'Ligne claire comic',
        text: 'European ligne-claire comic look: clean even-weight outlines, flat bright colors without hatching, meticulously detailed backgrounds, simple expressive faces, no texture or grain.',
    },
    {
        id: 'sumi-e-ink',
        group: cartoon,
        name: 'Black ink wash',
        text: 'Black ink wash drawing in the manner of East Asian sumi-e: brush strokes on rough paper, grey gradients, negative space as fog, a single red seal-colored accent, minimal detail, slow drifting motion.',
    },

    // ---- 3D and craft
    {
        id: 'pixar-3d',
        group: craft,
        name: 'Pixar-style 3D',
        text: 'Polished 3D animation in the style of modern Pixar films: soft global illumination, rounded expressive characters, subsurface skin and fabric detail, saturated warm color, shallow depth of field, clean cinematic camera moves.',
    },
    {
        id: 'stylized-cgi',
        group: craft,
        name: 'Stylized glossy CGI',
        text: 'Glossy stylized CGI render: smooth plastic-like surfaces, slightly exaggerated proportions, saturated colors with strong rim light, soft studio-style shadows, simplified shapes and textures, floaty animation, clean video-game-trailer look.',
    },
    {
        id: 'low-poly',
        group: craft,
        name: 'Low-poly 3D',
        text: 'Stylized low-poly 3D look: flat-shaded faceted geometry, bold unlit color planes, simple gradient backgrounds, minimal textures, soft ambient occlusion, toy-like diorama compositions.',
    },
    {
        id: 'ps1-retro-3d',
        group: craft,
        name: 'PS1 retro 3D',
        text: 'Early-PlayStation 3D look: chunky low-polygon models, wobbling vertices, affine-warped low-resolution textures, dithered shading, fog-limited draw distance, limited color palette, stiff jointed animation.',
    },
    {
        id: 'cel-shaded-3d',
        group: craft,
        name: 'Cel-shaded 3D',
        text: 'Cel-shaded 3D animation look: hard two-tone shadow edges, bold ink outlines around 3D models, flat color textures, hand-painted-looking backgrounds, anime-style poses rendered on a moving 3D camera.',
    },
    {
        id: 'spiderverse-comic-3d',
        group: craft,
        name: 'Comic-book 3D',
        text: 'Comic-book-style 3D animation look: halftone dot shading and ink hatching on 3D models, offset color-print misregistration, animated on twos, bold graffiti-like color fields, dynamic comic camera angles.',
    },
    {
        id: 'game-cinematic',
        group: craft,
        name: 'AAA game cinematic',
        text: 'High-end video-game cinematic look: photoreal CG with dramatic volumetric lighting, detailed skin and material rendering, slow motion, anamorphic lens flares, particle-filled air, heavily graded teal and orange.',
    },
    {
        id: 'voxel-blocks',
        group: craft,
        name: 'Voxel block world',
        text: 'Voxel block look: everything built from cubic blocks, bright flat-lit colors, soft pixel-like textures, simple blocky animation, isometric-ish camera angles, sunny cheerful light.',
    },
    {
        id: 'stop-motion-puppets',
        group: craft,
        name: 'Stop-motion puppets',
        text: 'Stop-motion animation with handmade puppets: visible fabric weave and thumbprints in clay, slightly jittery 12 fps movement, miniature-scale sets with practical lights, shallow macro depth of field, muted handmade colors.',
    },
    {
        id: 'claymation',
        group: craft,
        name: 'Claymation',
        text: 'Plasticine claymation look: soft rounded forms with fingerprint marks, exaggerated squash and stretch, saturated candy colors, miniature-scale sets, slightly uneven studio lighting.',
    },
    {
        id: 'papercut-theatre',
        group: craft,
        name: 'Papercut theatre',
        text: 'Layered paper-cutout animation: flat cut shapes with visible paper fibers and torn edges, parallax layers lit from behind, soft cast shadows between layers, limited earthy palette, puppet-theatre staging.',
    },
    {
        id: 'felt-puppets',
        group: craft,
        name: 'Felt hand puppets',
        text: 'Felt hand-puppet show: fuzzy fabric characters with big button eyes, visible stitching, simple handmade cardboard sets, bright primary colors, slightly bouncy puppeteer movement, soft even studio light.',
    },
    {
        id: 'tilt-shift-miniature',
        group: craft,
        name: 'Tilt-shift miniature',
        text: 'Tilt-shift miniature look: scenes shot to look like tiny scale models, extreme shallow focus band, oversaturated toy-like color, high overhead angles, speeded-up time-lapse motion.',
    },

    // ---- painted, drawn, printed
    {
        id: 'gothic-oil',
        group: painted,
        name: 'Dark gothic oil painting',
        text: 'Dark gothic oil painting in the manner of Caravaggio: heavy chiaroscuro, candlelight only, visible brush strokes and craquelure, deep oxblood and umber tones, pale highlights against black.',
    },
    {
        id: 'medieval-woodcut',
        group: painted,
        name: 'Medieval woodcut',
        text: 'Melancholic medieval woodcut look: bold carved black lines, hatched shading, desaturated grey-brown paper with a single blood-red accent, flat stacked perspective, ornamental borders.',
    },
    {
        id: 'watercolor-storybook',
        group: painted,
        name: 'Watercolor storybook',
        text: 'Soft watercolor storybook illustration: wet-on-wet washes bleeding into paper texture, loose ink outlines, pastel palette with warm highlights, gentle vignette edges.',
    },
    {
        id: 'art-deco-poster',
        group: painted,
        name: 'Art deco poster',
        text: 'Art deco travel-poster style: flat gouache color fields, sharp geometric shapes, gold and deep-teal palette, strong symmetrical compositions, elegant poster composition.',
    },
    {
        id: 'synthwave',
        group: painted,
        name: 'Retro synthwave',
        text: 'Retro synthwave illustration: neon pink and cyan gradients, wireframe grid lines, chrome reflections, scanlines and chromatic glow, dark purple tones, airbrushed 1980s sci-fi look.',
    },
    {
        id: 'impressionist',
        group: painted,
        name: 'Impressionist painting',
        text: 'Impressionist oil painting: short visible dabs of broken color, shimmering light, soft undefined edges, pastel haze, blurred motion.',
    },
    {
        id: 'ukiyo-e',
        group: painted,
        name: 'Ukiyo-e woodblock',
        text: 'Japanese ukiyo-e woodblock print: flat color areas with bold black outlines, visible wood grain, indigo and vermilion palette, flattened perspective, cream paper.',
    },
    {
        id: 'pop-art',
        group: painted,
        name: 'Pop art',
        text: 'Pop-art silkscreen look: flat bold primary colors, thick black outlines, Ben-Day dot halftones, high-contrast repeated panels, glossy magazine-cutout energy, loud yellows, reds and blues.',
    },
    {
        id: 'constructivist-poster',
        group: painted,
        name: 'Constructivist propaganda poster',
        text: 'Constructivist propaganda poster look: bold diagonal compositions, flat red, black and cream shapes, heavy angular blocks, heroic low-angle framing, rough printed paper texture, strict geometric graphic design.',
    },
    {
        id: 'linocut-print',
        group: painted,
        name: 'Linocut print',
        text: 'Two- and three-color linocut print: chunky carved black shapes, rough ink coverage with gaps, flat color overlays slightly off-register, simplified forms, bold graphic shapes on cream paper.',
    },
    {
        id: 'risograph',
        group: painted,
        name: 'Risograph print',
        text: 'Risograph print look: limited overprinting inks (fluorescent pink, teal, yellow), grainy halftone texture, slight misregistration, flat shapes, soft paper tooth, indie zine illustration energy.',
    },
    {
        id: 'charcoal-sketch',
        group: painted,
        name: 'Charcoal and pencil sketch',
        text: 'Charcoal and graphite sketch: smudged soft blacks, visible hatching strokes and eraser highlights, loose construction lines left in, white paper tone, rough unfinished edges, slightly trembling line-boil animation.',
    },
    {
        id: 'art-nouveau',
        group: painted,
        name: 'Art nouveau',
        text: 'Art nouveau illustration in the manner of Mucha: flowing whiplash lines, ornamental floral borders, pale muted gold, sage and rose palette, flat decorative areas with fine outlines, halo-like circular framing.',
    },
    {
        id: 'nordic-folk-art',
        group: painted,
        name: 'Scandinavian folk-tale painting',
        text: 'Scandinavian folk-tale gouache painting: muted earth and mossy greens, soft diffused light, flat storybook shapes, textured paper, visible brush strokes.',
    },
    {
        id: 'baroque-opulence',
        group: painted,
        name: 'Baroque opulence',
        text: 'Baroque look: strong chiaroscuro contrast, rich velvet reds and gilded gold, dramatic theatrical lighting, sweeping asymmetric compositions.',
    },
    {
        id: 'stained-glass',
        group: painted,
        name: 'Stained glass',
        text: 'Stained-glass window look: flat jewel-toned color panes divided by thick black lead lines, light glowing through from behind, rigid flattened poses, ornate gothic tracery.',
    },
    {
        id: 'tarot-card',
        group: painted,
        name: 'Vintage tarot card',
        text: 'Vintage tarot-card illustration look: ornate decorative border, flat fills and fine ink lines, faded cream paper, muted red, gold and teal, slightly worn print.',
    },
    {
        id: 'pulp-paperback',
        group: painted,
        name: 'Pulp paperback cover',
        text: '1950s pulp paperback cover painting look: saturated gouache with dramatic hard lighting, lurid reds and yellows, strong menacing shadows, rough print texture, slightly faded cover wear.',
    },

    // ---- found media and experiments
    {
        id: 'super8-home-movie',
        group: medium,
        name: 'Super 8 home movie',
        text: 'Super 8 home-movie footage look: warm faded color with light leaks and burnt-edge flashes, soft focus and heavy grain, shaky amateur framing, gate weave and dust, golden light.',
    },
    {
        id: 'vhs-camcorder',
        group: medium,
        name: 'VHS camcorder',
        text: '1990s VHS camcorder footage look: smeared colors, tracking glitches and horizontal noise bands, low resolution, overexposed highlights, cheap handheld pans, bleeding red channels.',
    },
    {
        id: 'double-exposure-dream',
        group: medium,
        name: 'Double-exposure dream',
        text: 'Dreamlike double-exposure imagery: subjects dissolving into each other, translucent overlays, soft glowing edges, desaturated blues and golds, slow fades.',
    },
    {
        id: 'monochrome-red-accent',
        group: medium,
        name: 'Monochrome with one red accent',
        text: 'High-contrast black-and-white cinematography with a single saturated red accent, everything else in grey tones, deep blacks, grainy film stock, graphic composition.',
    },
    {
        id: 'shadow-puppet-theatre',
        group: medium,
        name: 'Shadow-puppet theatre',
        text: 'Shadow-puppet theatre look: flat black cut-out silhouettes with jointed limbs against a glowing translucent screen, warm amber backlight, hand-cut ornate detail, stage-curtain framing.',
    },
    {
        id: 'cyanotype-blueprint',
        group: medium,
        name: 'Cyanotype blueprint',
        text: 'Cyanotype print look: everything in deep Prussian blue and white, soft chalky tones, visible brush edges on the paper, delicate fine detail, slow dreamy movement.',
    },
    {
        id: 'psychedelic-60s',
        group: medium,
        name: '60s psychedelia',
        text: '1960s psychedelic visuals: kaleidoscopic mirrored patterns, melting liquid-light projection, saturated orange, magenta and electric blue, flowing paisley textures, trippy slow zooms.',
    },
    {
        id: 'unplugged-stage',
        group: medium,
        name: 'Intimate unplugged stage',
        text: 'Intimate unplugged stage film look: warm stage lighting, soft bokeh from small lights, close handheld framing, shallow depth of field, warm amber and deep blue.',
    },

    // ---- Additional look-only presets (250). References are comments, never prompt text.
    // Film examples indicate visual affinity unless an actual technique is explicitly identified.
    {
        id: 'early-actuality-film',
        group: live,
        name: 'Early actuality film',
        // Reference only (not part of text): Film: Workers Leaving the Lumiere Factory (1895).
        text: 'Live-action early cinema: orthochromatic monochrome, deep fixed focus, locked frontal framing, uneven hand-cranked cadence and bright halation.',
    },
    {
        id: 'silent-french-impressionism',
        group: live,
        name: 'Silent French impressionism',
        // Reference only (not part of text): Film: Coeur fidele (1923).
        text: 'Live-action silent French impressionism: gauze diffusion, rhythmic optical dissolves, subjective soft focus and luminous grey highlights.',
    },
    {
        id: 'soviet-montage-cinema',
        group: live,
        name: 'Soviet montage cinema',
        // Reference only (not part of text): Film: Battleship Potemkin (1925).
        text: 'Live-action monochrome montage cinema: graphic diagonals, hard directional light, abrupt shot-scale changes and dense silver contrast.',
    },
    {
        id: 'weimar-new-objectivity',
        group: live,
        name: 'Weimar New Objectivity',
        // Reference only (not part of text): Film: People on Sunday (1930).
        text: 'Live-action Weimar realism: crisp monochrome detail, restrained perspective, precise geometric framing and cool unsentimental tonal separation.',
    },
    {
        id: 'early-sound-chiaroscuro',
        group: live,
        name: 'Early sound chiaroscuro',
        // Reference only (not part of text): Film: M - Eine Stadt sucht einen Morder (1931); early sound cinema, not silent film.
        text: 'Live-action early sound-era monochrome: isolated pools of light, severe negative space, layered deep framing and measured tracking.',
    },
    {
        id: 'poetic-realism',
        group: live,
        name: 'Poetic realism',
        // Reference only (not part of text): Film: Le Quai des brumes (1938).
        text: 'Live-action 1930s poetic realism: luminous silver greys, diffused backlight, soft optical falloff and gently floating camera movement.',
    },
    {
        id: 'pre-code-soft-glamour',
        group: live,
        name: 'Pre-Code soft glamour',
        // Reference only (not part of text): Film: Shanghai Express (1932).
        text: 'Live-action early-1930s glamour: pearlescent monochrome, gauze-soft highlights, sculpted key light and elegant close framing.',
    },
    {
        id: 'screwball-studio-clarity',
        group: live,
        name: 'Screwball studio clarity',
        // Reference only (not part of text): Film: Bringing Up Baby (1938).
        text: 'Live-action 1930s studio comedy photography: balanced monochrome midtones, readable deep staging, brisk lateral reframing and polished exposure.',
    },
    {
        id: 'italian-neorealism',
        group: live,
        name: 'Italian neorealism',
        // Reference only (not part of text): Film: Bicycle Thieves (1948).
        text: 'Live-action postwar neorealism: unpolished 35mm monochrome, broad available light, medium-deep focus and observational eye-level framing.',
    },
    {
        id: 'postwar-japanese-domestic-cinema',
        group: live,
        name: 'Postwar Japanese domestic cinema',
        // Reference only (not part of text): Film: Tokyo Story (1953).
        text: 'Live-action restrained postwar Japanese photography: low fixed camera height, rectilinear composition, subtle grey gradation and deliberate static holds.',
    },
    {
        id: 'early-two-color-cinema',
        group: live,
        name: 'Early two-color cinema',
        // Reference only (not part of text): Film: The Toll of the Sea (1922).
        text: 'Live-action early two-color process look: restricted coral-red and green-cyan gamut, weak blues, soft registration and creamy detail.',
    },
    {
        id: 'widescreen-studio-melodrama',
        group: live,
        name: 'Widescreen studio melodrama',
        // Reference only (not part of text): Film: All That Heaven Allows (1955).
        text: 'Live-action 1950s widescreen melodrama: saturated complementary colors, luminous diffusion, layered depth and smooth emphatic dolly movements.',
    },
    {
        id: 'vistavision-clarity',
        group: live,
        name: 'VistaVision clarity',
        // Reference only (not part of text): Film: North by Northwest (1959).
        text: 'Live-action horizontal-format 35mm look: exceptionally fine grain, deep sharpness, rich restrained color and stable expansive compositions.',
    },
    {
        id: 'soviet-thaw-lyricism',
        group: live,
        name: 'Soviet Thaw lyricism',
        // Reference only (not part of text): Film: The Cranes Are Flying (1957).
        text: 'Live-action lyrical monochrome: fluid wide-angle tracking, expressive tilted framing, radiant backlight and silvery highlight bloom.',
    },
    {
        id: 'british-free-cinema',
        group: live,
        name: 'British Free Cinema',
        // Reference only (not part of text): Film: Every Day Except Christmas (1957).
        text: 'Live-action 1950s observational 16mm: coarse monochrome grain, available light, intimate handheld distance and loosely responsive framing.',
    },
    {
        id: 'kitchen-sink-realism',
        group: live,
        name: 'Kitchen-sink realism',
        // Reference only (not part of text): Film: Saturday Night and Sunday Morning (1960).
        text: 'Live-action British 1960s social realism: soot-grey monochrome, blunt daylight contrast, unadorned medium shots and restrained handheld movement.',
    },
    {
        id: 'cinema-novo',
        group: live,
        name: 'Cinema Novo',
        // Reference only (not part of text): Film: Black God, White Devil (1964).
        text: 'Live-action Cinema Novo: abrasive monochrome contrast, overbright exposure, coarse grain and restless angular handheld framing.',
    },
    {
        id: 'czech-new-wave-naturalism',
        group: live,
        name: 'Czech New Wave naturalism',
        // Reference only (not part of text): Film: Loves of a Blonde (1965).
        text: 'Live-action 1960s Czech naturalism: soft monochrome midtones, modest available-light exposure, offbeat framing and observational camera work.',
    },
    {
        id: 'polish-school-monochrome',
        group: live,
        name: 'Polish School monochrome',
        // Reference only (not part of text): Film: Ashes and Diamonds (1958).
        text: 'Live-action postwar Polish monochrome: dramatic hard light, deep blacks, expressive foreground depth and etched silver highlights.',
    },
    {
        id: 'japanese-new-wave-color',
        group: live,
        name: 'Japanese New Wave color',
        // Reference only (not part of text): Film: Tokyo Drifter (1966).
        text: 'Live-action Japanese New Wave color: bold red-blue blocking, abrupt compositional shifts, wide framing and hard graphic lighting.',
    },
    {
        id: 'new-german-cinema-restraint',
        group: live,
        name: 'New German Cinema restraint',
        // Reference only (not part of text): Film: Ali: Fear Eats the Soul (1974).
        text: 'Live-action 1970s German art cinema: restrained color density, formal locked framing, uneasy empty margins and deliberate zooms.',
    },
    {
        id: 'taiwanese-new-cinema',
        group: live,
        name: 'Taiwanese New Cinema',
        // Reference only (not part of text): Film: A City of Sadness (1989).
        text: 'Live-action Taiwanese New Cinema: distant locked compositions, layered depth, subdued available light and patient extended shot duration.',
    },
    {
        id: 'iranian-poetic-realism',
        group: live,
        name: 'Iranian poetic realism',
        // Reference only (not part of text): Film: Where Is the Friends House? (1987).
        text: 'Live-action Iranian poetic realism: unembellished natural light, earth-toned color, modest lens perspective and patient observational framing.',
    },
    {
        id: 'fifth-generation-color-formalism',
        group: live,
        name: 'Fifth Generation color formalism',
        // Reference only (not part of text): Film: Raise the Red Lantern (1991).
        text: 'Live-action Chinese color formalism: broad sculpted color fields, dense reds and ochres, symmetrical framing and layered deep space.',
    },
    {
        id: 'romanian-new-wave-austerity',
        group: live,
        name: 'Romanian New Wave austerity',
        // Reference only (not part of text): Film: 4 Months, 3 Weeks and 2 Days (2007).
        text: 'Live-action Romanian realism: long handheld takes, cool mixed practical light, neutral color and unpolished mid-distance framing.',
    },
    {
        id: 'new-argentine-cinema',
        group: live,
        name: 'New Argentine Cinema',
        // Reference only (not part of text): Film: La Cienaga (2001).
        text: 'Live-action understated Argentine realism: humid low-contrast color, off-center close framing, shallow selective focus and lingering observational duration.',
    },
    {
        id: 'la-rebellion-tactile-realism',
        group: live,
        name: 'LA Rebellion tactile realism',
        // Reference only (not part of text): Film: Killer of Sheep (1977).
        text: 'Live-action independent 16mm monochrome: tactile grain, luminous available light, intimate compositions and expressive tonal softness.',
    },
    {
        id: 'indian-parallel-cinema',
        group: live,
        name: 'Indian Parallel Cinema',
        // Reference only (not part of text): Film: Pather Panchali (1955).
        text: 'Live-action Indian parallel-cinema photography: subtle tonal realism, measured eye-level framing, delicate available light and unshowy camera movement.',
    },
    {
        id: 'soviet-color-tableaux',
        group: live,
        name: 'Soviet color tableaux',
        // Reference only (not part of text): Film: The Color of Pomegranates (1969).
        text: 'Live-action color tableau cinema: flattened frontal depth, jewel-like color blocks, tactile optical softness and ceremonial locked camera positions.',
    },
    {
        id: 'early-hd-cinema',
        group: live,
        name: 'Early HD cinema',
        // Reference only (not part of text): Film: Russian Ark (2002).
        text: 'Live-action early high-definition digital: crisp electronic contours, deep focus, limited highlight latitude and smooth long-take camera motion.',
    },
    {
        id: 'silver-retention-bleach-bypass',
        group: liveLook,
        name: 'Silver-retention bleach bypass',
        // Reference only (not part of text): Film: Nineteen Eighty-Four (1984).
        text: 'Live-action silver-retention print look: muted saturation, dense silver blacks, coarse contrast and cold steely highlights.',
    },
    {
        id: 'cross-processed-reversal',
        group: liveLook,
        name: 'Cross-processed reversal',
        // Reference only (not part of text): Film: Domino (2005), mixed-process reference.
        text: 'Live-action cross-processed reversal look: displaced cyan shadows, yellow-green highlights, steep contrast and unstable saturated midtones.',
    },
    {
        id: 'flashed-lifted-blacks',
        group: liveLook,
        name: 'Flashed lifted blacks',
        // Reference only (not part of text): Film: McCabe & Mrs. Miller (1971).
        text: 'Live-action pre-flashed film look: milky shadow floor, lowered contrast, pastel color separation and gently veiled highlights.',
    },
    {
        id: 'push-processed-night-film',
        group: liveLook,
        name: 'Push-processed night film',
        // Reference only (not part of text): Visual reference: The French Connection (1971); not a specific stock attribution.
        text: 'Live-action pushed high-speed 35mm: pronounced grain clusters, dense shadows, intense practical-light halos and uneven chromatic noise.',
    },
    {
        id: 'pull-processed-pastels',
        group: liveLook,
        name: 'Pull-processed pastels',
        // Reference only (not part of text): Visual analogy: Picnic at Hanging Rock (1975); not a laboratory-process attribution.
        text: 'Live-action pull-processed negative look: reduced contrast, delicate pastel saturation, broad highlight latitude and soft tonal transitions.',
    },
    {
        id: 'day-for-night-blue',
        group: liveLook,
        name: 'Day-for-night blue',
        // Reference only (not part of text): Film: Mad Max: Fury Road (2015), selected sequences.
        text: 'Live-action day-for-night photography: underexposed cool-blue midtones, suppressed highlights, deep controlled shadows and sharply legible silhouettes.',
    },
    {
        id: 'false-color-infrared',
        group: liveLook,
        name: 'False-color infrared',
        // Reference only (not part of text): Related film: Dune: Part Two (2024) uses monochrome infrared, not this palette.
        text: 'Live-action false-color infrared photography: displaced red-magenta mapping, pale highlights, dense cyan shadows and fine photographic grain.',
    },
    {
        id: 'panchromatic-silver-portraiture',
        group: liveLook,
        name: 'Panchromatic silver portraiture',
        // Reference only (not part of text): Visual reference: Ida (2013).
        text: 'Live-action panchromatic monochrome: balanced spectral greys, nuanced midtones, velvety blacks and gentle sculptural key-light falloff.',
    },
    {
        id: 'orthochromatic-modern-monochrome',
        group: liveLook,
        name: 'Orthochromatic modern monochrome',
        // Reference only (not part of text): Film: The Lighthouse (2019), filtered monochrome reference.
        text: 'Live-action orthochromatic-style monochrome: darkened reds, luminous blue response, rough silver texture and severe hard-light modeling.',
    },
    {
        id: 'high-key-monochrome',
        group: liveLook,
        name: 'High-key monochrome',
        // Reference only (not part of text): Visual reference: Frances Ha (2012).
        text: 'Live-action high-key black-and-white: luminous near-white midtones, delicate edge separation, sparse soft shadows and fine unobtrusive grain.',
    },
    {
        id: 'split-diopter-deep-focus',
        group: liveLook,
        name: 'Split-diopter deep focus',
        // Reference only (not part of text): Film: Blow Out (1981).
        text: 'Live-action split-diopter optics: simultaneously sharp near and far planes, a narrow soft transition seam and assertive layered composition.',
    },
    {
        id: 'deep-focus-wide-angle-realism',
        group: liveLook,
        name: 'Deep-focus wide-angle realism',
        // Reference only (not part of text): Film: Citizen Kane (1941).
        text: 'Live-action deep-focus wide-angle photography: near-to-far clarity, strong perspective recession, controlled highlights and layered static compositions.',
    },
    {
        id: 'telephoto-observational-compression',
        group: liveLook,
        name: 'Telephoto observational compression',
        // Reference only (not part of text): Film: Tinker Tailor Soldier Spy (2011).
        text: 'Live-action telephoto photography: flattened spatial layers, narrow focal depth, compressed backgrounds and distant patient framing.',
    },
    {
        id: 'extreme-wide-angle-distortion',
        group: liveLook,
        name: 'Extreme wide-angle distortion',
        // Reference only (not part of text): Film: The Favourite (2018).
        text: 'Live-action extreme wide-angle optics: bowed edges, enlarged near-plane perspective, deep focus and unsettling low-height movement.',
    },
    {
        id: 'vintage-swirling-lens',
        group: liveLook,
        name: 'Vintage swirling lens',
        // Reference only (not part of text): Visual analogy: The Assassination of Jesse James by the Coward Robert Ford (2007); no Petzval attribution.
        text: 'Live-action vintage portrait-lens look: sharp central focus, swirling peripheral blur, curved-field falloff and creamy warm highlights.',
    },
    {
        id: 'prism-refraction',
        group: liveLook,
        name: 'Prism refraction',
        // Reference only (not part of text): Optical technique; no canonical film example claimed.
        text: 'Live-action prism-filter look: fragmented edge reflections, displaced spectral fringes, doubled contours and luminous refracted highlights.',
    },
    {
        id: 'streak-filter-highlights',
        group: liveLook,
        name: 'Streak-filter highlights',
        // Reference only (not part of text): Visual analogy: Star Trek (2009), flare appearance; no filter attribution.
        text: 'Live-action spherical photography with streak-filter look: linear light smears, crisp central detail, restrained halation and controlled focus pulls.',
    },
    {
        id: 'net-diffusion-optics',
        group: liveLook,
        name: 'Net-diffusion optics',
        // Reference only (not part of text): Visual reference: Atonement (2007); diffusion appearance, not a specific net attribution.
        text: 'Live-action net-diffused photography: softened detail, fine highlight texture, lifted halation and rounded tonal contrast.',
    },
    {
        id: 'macro-abstract-cinema',
        group: liveLook,
        name: 'Macro abstract cinema',
        // Reference only (not part of text): Film: Microcosmos (1996).
        text: 'Live-action extreme macro: wafer-thin focal depth, enlarged surface grain, luminous specular detail and slow microscopic reframing.',
    },
    {
        id: 'probe-lens-perspective',
        group: liveLook,
        name: 'Probe-lens perspective',
        // Reference only (not part of text): Optical technique; no canonical film example claimed.
        text: 'Live-action probe-lens-style photography: very close wide perspective, extended apparent depth, pronounced parallax and smooth low tracking.',
    },
    {
        id: 'underwater-optical-drift',
        group: liveLook,
        name: 'Underwater optical drift',
        // Reference only (not part of text): Film: The Big Blue (1988), underwater sequences.
        text: 'Live-action submerged-camera optics: cyan absorption, depth-softened contrast, wavering caustic highlights and buoyant slow camera drift.',
    },
    {
        id: 'shallow-focus-digital-monochrome',
        group: liveLook,
        name: 'Shallow-focus digital monochrome',
        // Reference only (not part of text): Visual reference: A Girl Walks Home Alone at Night (2014).
        text: 'Live-action digital black-and-white: smooth tonal gradients, selective shallow focus, luminous highlights and restrained contemporary framing.',
    },
    {
        id: 'high-frame-rate-hyperclarity',
        group: liveLook,
        name: 'High-frame-rate hyperclarity',
        // Reference only (not part of text): Film: Billy Lynns Long Halftime Walk (2016).
        text: 'Live-action high-frame-rate digital: unusually continuous motion, short temporal steps, crisp surface detail and transparent naturalistic color.',
    },
    {
        id: 'dragged-shutter-motion-trails',
        group: liveLook,
        name: 'Dragged-shutter motion trails',
        // Reference only (not part of text): Film: Chungking Express (1994), selected step-printed imagery.
        text: 'Live-action dragged-shutter photography: streaked contours against stable detail, smeared highlights and pulsing temporal overlaps.',
    },
    {
        id: 'short-shutter-digital-motion',
        group: liveLook,
        name: 'Short-shutter digital motion',
        // Reference only (not part of text): Visual reference: Public Enemies (2009).
        text: 'Live-action short-shutter digital look: sharply segmented motion, dry hard edges, minimal motion blur and neutral clinical contrast.',
    },
    {
        id: 'continuous-take-choreography',
        group: liveLook,
        name: 'Continuous-take choreography',
        // Reference only (not part of text): Film: Victoria (2015).
        text: 'Live-action continuous-take cinematography: uninterrupted spatial progression, fluid reframing, evolving focus and seamless exposure transitions.',
    },
    {
        id: 'floating-steadicam-precision',
        group: liveLook,
        name: 'Floating Steadicam precision',
        // Reference only (not part of text): Film: The Shining (1980).
        text: 'Live-action stabilized wide-lens photography: level floating motion, smooth cornering, consistent camera height and deep spatial perspective.',
    },
    {
        id: 'whip-pan-kinetic-editing',
        group: liveLook,
        name: 'Whip-pan kinetic editing',
        // Reference only (not part of text): Film: Hot Fuzz (2007).
        text: 'Live-action kinetic visual grammar: whip-pan transitions, directional smears, abrupt scale changes and sharply resolved resting frames.',
    },
    {
        id: 'crash-zoom-punctuation',
        group: liveLook,
        name: 'Crash-zoom punctuation',
        // Reference only (not part of text): Film: The Quick and the Dead (1995).
        text: 'Live-action zoom-driven photography: abrupt optical magnification, compressed perspective, punchy contrast and short static holds between zooms.',
    },
    {
        id: 'split-screen-cinema',
        group: liveLook,
        name: 'Split-screen cinema',
        // Reference only (not part of text): Film: Timecode (2000).
        text: 'Live-action multi-panel composition: synchronized adjacent framings, precise geometric divisions, contrasting shot scales and clean alignment; no captions.',
    },
    {
        id: 'dolly-zoom-optics',
        group: liveLook,
        name: 'Dolly-zoom optics',
        // Reference only (not part of text): Film: Vertigo (1958).
        text: 'Live-action dolly zoom: stable central image scale with changing background perspective, smooth focal compensation and controlled selective focus.',
    },
    {
        id: 'infrared-monochrome',
        group: liveLook,
        name: 'Infrared monochrome',
        // Reference only (not part of text): Film: Dune: Part Two (2024), selected sequences.
        text: 'Live-action infrared monochrome: chalk-bright high values, dense dark low values, unusual material contrast and crisp silvery detail.',
    },
    {
        id: 'color-separation-fringes',
        group: liveLook,
        name: 'Color-separation fringes',
        // Reference only (not part of text): Visual reference: The Red Shoes (1948), dye color; misregistration is an added treatment.
        text: 'Live-action color-separation misregistration: red-green-blue contour offsets, dense dye-like saturation and gentle archival optical softness.',
    },
    {
        id: 'sepia-photochemistry',
        group: liveLook,
        name: 'Sepia photochemistry',
        // Reference only (not part of text): Film: The Wizard of Oz (1939), framing sequences.
        text: 'Live-action sepia-toned monochrome: warm brown silver gradients, ivory highlights, soft optical detail and restrained archival grain.',
    },
    {
        id: 'selective-cyan-grade',
        group: liveLook,
        name: 'Selective cyan grade',
        // Reference only (not part of text): Film: Underworld (2003).
        text: 'Live-action near-monochrome cyan: steel-blue tonal compression, pale neutral highlights, minimal warm color and dense shadow separation.',
    },
    {
        id: 'amber-monochromatic-grade',
        group: liveLook,
        name: 'Amber monochromatic grade',
        // Reference only (not part of text): Film: Enemy (2013).
        text: 'Live-action amber-filtered color: ochre midtones, compressed cool channels, dense warm shadows and high atmospheric contrast.',
    },
    {
        id: 'green-digital-unease',
        group: liveLook,
        name: 'Green digital unease',
        // Reference only (not part of text): Film: The Matrix (1999), selected sequences.
        text: 'Live-action green-biased color timing: green midtones, restrained warm highlights, dense black levels and polished hard edges.',
    },
    {
        id: 'candy-colored-hard-light',
        group: liveLook,
        name: 'Candy-colored hard light',
        // Reference only (not part of text): Film: The Umbrellas of Cherbourg (1964).
        text: 'Live-action saturated studio photography: clean magenta-yellow-blue separation, hard graphic shadows, glossy highlights and precise frontal framing.',
    },
    {
        id: 'natural-light-large-format',
        group: liveLook,
        name: 'Natural-light large format',
        // Reference only (not part of text): Film: The Revenant (2015).
        text: 'Live-action large-format natural-light photography: fine low-noise detail, broad tonal latitude, close wide perspective and soft ambient modeling.',
    },
    {
        id: 'digital-low-light-chroma',
        group: liveLook,
        name: 'Digital low-light chroma',
        // Reference only (not part of text): Film: Collateral (2004).
        text: 'Live-action available-light digital night: chromatic noise, luminous practical highlights, deep electric blues and long-lens compression.',
    },
    {
        id: '1960s-television-anime-economy',
        group: anime,
        name: '1960s television anime economy',
        // Reference only (not part of text): Series: Astro Boy (1963).
        text: '2D early television anime: spare monochrome linework, held drawings, economical cycles, hard graphic shadows and minimal in-between motion.',
    },
    {
        id: 'gekiga-animation-grit',
        group: anime,
        name: 'Gekiga animation grit',
        // Reference only (not part of text): Film: Golgo 13: The Professional (1983).
        text: '2D gekiga-influenced animation: angular contours, dense crosshatching, muted cel colors, severe shadow masses and emphatic held drawings.',
    },
    {
        id: 'theatrical-shojo-abstraction',
        group: anime,
        name: 'Theatrical shojo abstraction',
        // Reference only (not part of text): Series: Revolutionary Girl Utena (1997).
        text: '2D theatrical shojo animation: elongated contours, decorative color fields, delicate linework and abrupt abstract compositional transformations.',
    },
    {
        id: 'painted-postcard-freeze-frames',
        group: anime,
        name: 'Painted postcard freeze frames',
        // Reference only (not part of text): Film: Space Adventure Cobra (1982).
        text: '2D cel animation with painted freeze frames: dense hatching, oblique light, textured still holds and richly modulated color.',
    },
    {
        id: 'psychedelic-watercolor-anime',
        group: anime,
        name: 'Psychedelic watercolor anime',
        // Reference only (not part of text): Film: Belladonna of Sadness (1973).
        text: '2D experimental anime: translucent watercolor blooms, fine ink contours, morphing color fields and slow dissolving motion.',
    },
    {
        id: 'brush-line-historical-anime',
        group: anime,
        name: 'Brush-line historical anime',
        // Reference only (not part of text): Film: The Tale of the Princess Kaguya (2013).
        text: '2D brush-drawn anime: variable dry-brush contours, rough paper grain, economical wash shading and loose gestural timing.',
    },
    {
        id: 'minimalist-graphic-anime',
        group: anime,
        name: 'Minimalist graphic anime',
        // Reference only (not part of text): Film: My Neighbors the Yamadas (1999).
        text: '2D minimalist anime: simplified contours, broad white negative space, sparse flat color and elastic perspective changes.',
    },
    {
        id: 'hyper-detailed-cel-realism',
        group: anime,
        name: 'Hyper-detailed cel realism',
        // Reference only (not part of text): Film: Akira (1988).
        text: '2D theatrical cel animation: precise multi-level shading, intricate painted detail, consistent line weight and unusually fluid full animation.',
    },
    {
        id: 'digital-luminous-anime',
        group: anime,
        name: 'Digital luminous anime',
        // Reference only (not part of text): Film: Your Name (2016).
        text: '2D digitally composited anime: fine outlines, luminous gradient lighting, layered bloom and smooth high-detail atmospheric depth.',
    },
    {
        id: 'flattened-geometric-anime',
        group: anime,
        name: 'Flattened geometric anime',
        // Reference only (not part of text): Film: The Night Is Short, Walk on Girl (2017).
        text: '2D graphic anime: asymmetric color blocks, thin contours, skewed perspective and fast economical shape changes.',
    },
    {
        id: 'monochrome-scratch-line-anime',
        group: anime,
        name: 'Monochrome scratch-line anime',
        // Reference only (not part of text): Related film: Redline (2009), line energy only; its palette is colorful.
        text: '2D monochrome animation: abrasive scratchy contours, aggressive black fills, unstable line boil and compressed explosive timing.',
    },
    {
        id: 'anime-pastel-collage',
        group: anime,
        name: 'Anime pastel collage',
        // Reference only (not part of text): Series: Puella Magi Madoka Magica (2011), collage sequences.
        text: '2D anime collage: mismatched paper textures, pastel fills, abrupt scale jumps and visibly discontinuous compositing layers.',
    },
    {
        id: 'anime-pencil-test-finish',
        group: anime,
        name: 'Anime pencil-test finish',
        // Reference only (not part of text): Related film: The Tale of the Princess Kaguya (2013), gestural drawing rather than an unfinished pencil test.
        text: '2D pencil-test animation: exposed graphite construction lines, unfilled forms, paper grain and fluid rough keyframe motion.',
    },
    {
        id: 'anime-charcoal-noir',
        group: anime,
        name: 'Anime charcoal noir',
        // Reference only (not part of text): Visual analogy: Jin-Roh (1999), tonal reference; not charcoal production.
        text: '2D charcoal-textured anime: smudged greys, etched contours, granular shadow gradients and restrained realistic motion.',
    },
    {
        id: 'anime-fluorescent-pop',
        group: anime,
        name: 'Anime fluorescent pop',
        // Reference only (not part of text): Film: Promare (2019).
        text: '2D digitally colored anime: fluorescent flat fills, complementary shadows, snappy smears and energetic graphic perspective.',
    },
    {
        id: 'anime-painterly-organic-motion',
        group: anime,
        name: 'Anime painterly organic motion',
        // Reference only (not part of text): Film: Children of the Sea (2019).
        text: '2D painterly anime: fluid contour simplification, brushed color modeling, wide negative space and organic morphing transitions.',
    },
    {
        id: 'anime-woodblock-texture',
        group: anime,
        name: 'Anime woodblock texture',
        // Reference only (not part of text): Art-derived variation; no direct film-production attribution claimed.
        text: '2D woodblock-inspired anime: flattened color planes, textured ink edges, decorative contour rhythm and restrained parallax.',
    },
    {
        id: 'anime-expressionist-distortion',
        group: anime,
        name: 'Anime expressionist distortion',
        // Reference only (not part of text): Film: Mind Game (2004).
        text: '2D expressionist anime: distorted perspective, shifting line density, violent color contrast and elastic shape transformations.',
    },
    {
        id: 'anime-technical-precision',
        group: anime,
        name: 'Anime technical precision',
        // Reference only (not part of text): Film: Patlabor 2: The Movie (1993).
        text: '2D anime: measured linear perspective, detailed hard-edge shading, subdued blue-grey colors and mechanically precise camera movement.',
    },
    {
        id: 'anime-airbrush-nocturne',
        group: anime,
        name: 'Anime airbrush nocturne',
        // Reference only (not part of text): Film: Wicked City (1987).
        text: '2D cel animation: airbrushed tonal transitions, velvety dark gradients, fine outlines and subdued deep-blue separation.',
    },
    {
        id: 'anime-paper-grain-finish',
        group: anime,
        name: 'Anime paper-grain finish',
        // Reference only (not part of text): Film: The Girl from the Other Side (2022).
        text: '2D anime with embedded paper grain: colored pencil edges, restrained wash fills, flickering surface texture and gentle stepped motion.',
    },
    {
        id: 'chinese-folded-paper-animation',
        group: anime,
        name: 'Chinese folded-paper animation',
        // Reference only (not part of text): Regional craft-animation tradition; no specific film-production attribution claimed.
        text: 'Chinese folded-paper animation: dimensional folded planes, crisp paper creases, flat colored surfaces, articulated joints and rhythmically stepped graphic motion.',
    },
    {
        id: 'chinese-decorative-cel-animation',
        group: anime,
        name: 'Chinese decorative cel animation',
        // Reference only (not part of text): Film: Havoc in Heaven (1961/1964).
        text: '2D Chinese decorative animation: calligraphic contours, lacquer-bright flat colors, patterned fills and rhythmic graphic staging.',
    },
    {
        id: 'korean-painterly-animation',
        group: anime,
        name: 'Korean painterly animation',
        // Reference only (not part of text): Film: My Beautiful Girl, Mari (2002).
        text: '2D painterly animation: delicate colored contours, hazy pastel washes, softly modeled light and sparse drifting motion.',
    },
    {
        id: 'taiwanese-sketchbook-animation',
        group: anime,
        name: 'Taiwanese sketchbook animation',
        // Reference only (not part of text): Visual reference: On Happiness Road (2017).
        text: '2D sketchbook animation: loose pen contours, uneven wash fills, generous paper-white space and brisk exploratory line motion.',
    },
    {
        id: 'stereoptical-cel-depth',
        group: cartoon,
        name: 'Stereoptical cel depth',
        // Reference only (not part of text): Short: Somewhere in Dreamland (1936).
        text: '2D cel animation over dimensional miniature depth: rounded contours, rotating layered perspective, soft studio shading and fluid vintage timing.',
    },
    {
        id: 'theatrical-smear-animation',
        group: cartoon,
        name: 'Theatrical smear animation',
        // Reference only (not part of text): Short: The Dover Boys (1942).
        text: '2D theatrical animation: broad smear drawings, elastic volume-preserving deformation, painted depth and precisely snappy timing.',
    },
    {
        id: 'charcoal-erasure-animation',
        group: cartoon,
        name: 'Charcoal erasure animation',
        // Reference only (not part of text): Short: Felix in Exile (1994), William Kentridge.
        text: '2D charcoal erasure animation: persistent rubbed-out ghost contours, accumulated drawing residue, deep dusty blacks and repeatedly redrawn spatial transformations.',
    },
    {
        id: 'xerographic-cel-lines',
        group: cartoon,
        name: 'Xerographic cel lines',
        // Reference only (not part of text): Film: One Hundred and One Dalmatians (1961).
        text: '2D xerographic cel animation: rough dark pencil contours, loose sketch overlaps, flat fills and warmly painted depth.',
    },
    {
        id: 'limited-television-ink-wash',
        group: cartoon,
        name: 'Limited television ink wash',
        // Reference only (not part of text): Special: A Charlie Brown Christmas (1965).
        text: '2D limited animation: expressive uneven outlines, sparse wash backgrounds, muted flats and carefully timed held poses.',
    },
    {
        id: 'angular-art-deco-cartoon',
        group: cartoon,
        name: 'Angular Art Deco cartoon',
        // Reference only (not part of text): Film: Batman: Mask of the Phantasm (1993).
        text: '2D graphic animation: angular silhouettes, streamlined geometric shading, dark navy-black masses and restrained warm accents.',
    },
    {
        id: 'irish-illuminated-animation',
        group: cartoon,
        name: 'Irish illuminated animation',
        // Reference only (not part of text): Film: The Secret of Kells (2009).
        text: '2D decorative animation: interlaced graphic rhythms, flattened perspective, jewel-colored planes and precise patterned contours.',
    },
    {
        id: 'franco-belgian-caricature',
        group: cartoon,
        name: 'Franco-Belgian caricature',
        // Reference only (not part of text): Film: The Triplets of Belleville (2003).
        text: '2D hand-drawn animation: elongated irregular contours, warm ochre washes, tactile pencil texture and eccentric full motion.',
    },
    {
        id: 'french-watercolor-naturalism',
        group: cartoon,
        name: 'French watercolor naturalism',
        // Reference only (not part of text): Film: Ernest & Celestine (2012).
        text: '2D drawn animation: loose ink contours, transparent watercolor fills, white paper margins and understated elastic motion.',
    },
    {
        id: 'spanish-expressive-drawing',
        group: cartoon,
        name: 'Spanish expressive drawing',
        // Reference only (not part of text): Film: Wrinkles (2011).
        text: '2D hand-drawn animation: restless fine contours, chalky pastel shading, spare compositions and restrained realistic timing.',
    },
    {
        id: 'soviet-textured-cutout',
        group: cartoon,
        name: 'Soviet textured cutout',
        // Reference only (not part of text): Short: Hedgehog in the Fog (1975).
        text: '2D textured cutout animation: soft torn contours, translucent paper, subdued brown-grey colors and drifting multiplane depth.',
    },
    {
        id: 'croatian-modernist-line',
        group: cartoon,
        name: 'Croatian modernist line',
        // Reference only (not part of text): Short: Ersatz (1961).
        text: '2D modernist animation: wiry economical contours, simplified forms, limited flat colors and dry abrupt timing.',
    },
    {
        id: 'polish-surreal-cutout',
        group: cartoon,
        name: 'Polish surreal cutout',
        // Reference only (not part of text): Short: Once Upon a Time (1957).
        text: '2D surreal cutout collage: photographic edges, antique monochrome tones, discontinuous scale and mechanical jointed motion.',
    },
    {
        id: 'hungarian-ornamental-animation',
        group: cartoon,
        name: 'Hungarian ornamental animation',
        // Reference only (not part of text): Film: Son of the White Mare (1981).
        text: '2D ornamental animation: vivid flat colors, flowing interlocking contours, rhythmic decorative transformation and seamless graphic morphs.',
    },
    {
        id: 'british-graphic-satire',
        group: cartoon,
        name: 'British graphic satire',
        // Reference only (not part of text): Film: When the Wind Blows (1986).
        text: '2D adult graphic animation: scratchy pen lines, dirty wash colors, irregular shading and deliberately awkward limited timing.',
    },
    {
        id: 'psychedelic-pop-cel-animation',
        group: cartoon,
        name: 'Psychedelic pop cel animation',
        // Reference only (not part of text): Film: Yellow Submarine (1968).
        text: '2D pop cel animation: high-chroma flat fills, sinuous contours, shifting graphic patterns and playful color-field transformations.',
    },
    {
        id: 'volumetrically-lit-hand-drawing',
        group: cartoon,
        name: 'Volumetrically lit hand drawing',
        // Reference only (not part of text): Film: Klaus (2019).
        text: '2D animation with volumetric painted light: delicate contours, rich soft shading, luminous edge bounce and fluid full animation.',
    },
    {
        id: 'lineless-digital-storybook',
        group: cartoon,
        name: 'Lineless digital storybook',
        // Reference only (not part of text): Visual reference: The Snowman (1982), soft-edged drawing; not digital production.
        text: '2D lineless animation: textured color shapes, painted edge variation, broad simple shading and fluid shape-based motion.',
    },
    {
        id: 'pastel-pencil-animation',
        group: cartoon,
        name: 'Pastel pencil animation',
        // Reference only (not part of text): Film: The Snowman (1982).
        text: '2D colored-pencil animation: visible paper tooth, waxy strokes, softly layered colors and gently boiling drawn edges.',
    },
    {
        id: 'autobiographic-black-and-white-drawing',
        group: cartoon,
        name: 'Autobiographic black-and-white drawing',
        // Reference only (not part of text): Film: Persepolis (2007).
        text: '2D graphic memoir animation: stark black shapes, white negative space, simple contours and restrained flat staging.',
    },
    {
        id: 'documentary-ink-animation',
        group: cartoon,
        name: 'Documentary ink animation',
        // Reference only (not part of text): Film: Waltz with Bashir (2008); not conventional rotoscoping.
        text: '2D documentary animation: graphic traced-looking contours, hard flat shadows, subdued color blocks and restrained floating perspective.',
    },
    {
        id: 'underground-cartoon-ink',
        group: cartoon,
        name: 'Underground cartoon ink',
        // Reference only (not part of text): Film: Fritz the Cat (1972).
        text: '2D underground cartoon: ragged pen contours, uneven hatching, deliberately coarse flat colors and unruly elastic movement.',
    },
    {
        id: 'liquid-shape-animation',
        group: cartoon,
        name: 'Liquid shape animation',
        // Reference only (not part of text): Short: Hunger (1974), computer-assisted metamorphic line animation.
        text: '2D abstract drawn animation: liquid contours, clean flat color, seamless shape substitution and supple frame-to-frame morphing.',
    },
    {
        id: 'white-line-black-ground-animation',
        group: cartoon,
        name: 'White-line black-ground animation',
        // Reference only (not part of text): Series: La Linea (1971), related line-based vocabulary.
        text: '2D drawn animation: luminous white contours over black, minimal shading and continuously redrawn linear motion.',
    },
    {
        id: 'animated-etching',
        group: cartoon,
        name: 'Animated etching',
        // Reference only (not part of text): Print-derived variant; no canonical film example claimed.
        text: '2D etched animation: incised crosshatching, dense black ink, ivory highlights and flickering hand-worked surface texture.',
    },
    {
        id: 'motion-comic-animation',
        group: cartoon,
        name: 'Motion-comic animation',
        // Reference only (not part of text): Series: The Marvel Super Heroes (1966).
        text: '2D motion-comic look: held inked shapes, selective hinged motion, slow parallax and strongly graphic compositions; no lettering.',
    },
    {
        id: 'minimalist-geometric-illustration',
        group: cartoon,
        name: 'Minimalist geometric illustration',
        // Reference only (not part of text): Art reference: Charley Harper; no film attribution claimed.
        text: '2D minimal geometric illustration: angular simplification, balanced flat color, sparse negative space and precisely timed transforms.',
    },
    {
        id: 'midcentury-title-design-abstraction',
        group: cartoon,
        name: 'Midcentury title-design abstraction',
        // Reference only (not part of text): Film: The Man with the Golden Arm (1955), title graphics only.
        text: '2D graphic animation: rough geometric blocks, strong asymmetry, restricted black-red colors and clipped rhythmic transitions; no lettering.',
    },
    {
        id: 'bauhaus-motion-studies',
        group: cartoon,
        name: 'Bauhaus motion studies',
        // Reference only (not part of text): Related film: Rhythmus 21 (1921), monochrome abstraction rather than primary color.
        text: '2D geometric animation: circles, bars and planes in formal relationships, primary contrasts and rigorously rhythmic spatial movement.',
    },
    {
        id: 'op-art-animation',
        group: cartoon,
        name: 'Op-art animation',
        // Reference only (not part of text): Art reference: Bridget Riley; related abstract film: An Optical Poem (1938).
        text: '2D optical pattern animation: repeated high-contrast lines, vibrating figure-ground reversals, clean edges and precisely phased pattern motion.',
    },
    {
        id: 'needle-felted-wool-stop-motion',
        group: craft,
        name: 'Needle-felted wool stop motion',
        // Reference only (not part of text): Related short: Lost & Found (2018), crochet rather than needle-felt construction.
        text: 'Needle-felted wool stop-motion: dense fuzzy fibers, softly compressed sculpted forms, tiny surface boil and tactile stepped movement.',
    },
    {
        id: 'knitted-yarn-stop-motion',
        group: craft,
        name: 'Knitted yarn stop motion',
        // Reference only (not part of text): Visual analogy: Lost & Found (2018), crocheted yarn rather than a knitting-technique attribution.
        text: 'Knitted yarn stop-motion: visible looped stitches, twisted strands, soft edge fuzz and gently deforming frame-by-frame motion.',
    },
    {
        id: 'crochet-amigurumi-animation',
        group: craft,
        name: 'Crochet amigurumi animation',
        // Reference only (not part of text): Short: Lost & Found (2018), crochet construction.
        text: 'Crocheted textile stop-motion: compact spiral stitches, scalloped contours, matte yarn fibers and small articulated incremental movement.',
    },
    {
        id: 'woven-tapestry-animation',
        group: craft,
        name: 'Woven tapestry animation',
        // Reference only (not part of text): Material variation; no canonical film attribution claimed.
        text: 'Woven textile animation: interlocking warp-weft grain, flat colored threads, fraying edges and stepped changes within the weave.',
    },
    {
        id: 'embroidered-cloth-animation',
        group: craft,
        name: 'Embroidered cloth animation',
        // Reference only (not part of text): Material variation; no canonical film attribution claimed.
        text: 'Embroidered textile animation: raised satin stitches, visible needle paths, thread sheen and frame-by-frame stitched contour changes.',
    },
    {
        id: 'quilted-patchwork-animation',
        group: craft,
        name: 'Quilted patchwork animation',
        // Reference only (not part of text): Material variation; no canonical film attribution claimed.
        text: 'Quilted fabric animation: stitched color patches, padded seams, uneven cotton weave and softly hinged stop-motion changes.',
    },
    {
        id: 'fabric-replacement-animation',
        group: craft,
        name: 'Fabric replacement animation',
        // Reference only (not part of text): Related film: The House (2022), textile-rich stop-motion rather than cloth replacement throughout.
        text: 'Textile replacement animation: successive cloth shapes, shifting weave registration, fuzzy cut edges and flat tactile stepped transformations.',
    },
    {
        id: 'exposed-wire-animation',
        group: craft,
        name: 'Exposed wire animation',
        // Reference only (not part of text): Material variation; no canonical film attribution claimed.
        text: 'Wire-based stop-motion: bent metallic contours, visible articulated joints, sharp specular glints and angular incremental motion.',
    },
    {
        id: 'wooden-puppet-animation',
        group: craft,
        name: 'Wooden puppet animation',
        // Reference only (not part of text): Film: The Emperors Nightingale (1949).
        text: 'Carved-wood puppet animation: visible grain, matte painted surfaces, jointed rigid motion and warm miniature studio light.',
    },
    {
        id: 'porcelain-puppet-animation',
        group: craft,
        name: 'Porcelain puppet animation',
        // Reference only (not part of text): Visual analogy: Alice (1988), mixed antique surfaces; not an all-porcelain film.
        text: 'Porcelain-like stop-motion: glazed surfaces, subtle crazing, delicate reflected highlights and rigid precise incremental motion.',
    },
    {
        id: 'silicone-puppet-realism',
        group: craft,
        name: 'Silicone puppet realism',
        // Reference only (not part of text): Visual reference: Anomalisa (2015); material appearance rather than a full material inventory.
        text: 'Silicone puppet stop-motion: softly translucent surfaces, sculptural microtexture, controlled expression changes and tactile cinematic lighting.',
    },
    {
        id: 'replacement-face-stop-motion',
        group: craft,
        name: 'Replacement-face stop motion',
        // Reference only (not part of text): Film: ParaNorman (2012).
        text: 'Replacement-animation look: crisp sculpted surface changes, subtle seam continuity, stepped expressions and carefully repeatable miniature lighting.',
    },
    {
        id: 'go-motion-blur',
        group: craft,
        name: 'Go-motion blur',
        // Reference only (not part of text): Film: Dragonslayer (1981), creature effects.
        text: 'Go-motion miniature animation: articulated physical surfaces, exposure-integrated blur, directional streaks and heavy dimensional lighting.',
    },
    {
        id: 'pixilation-motion',
        group: craft,
        name: 'Pixilation motion',
        // Reference only (not part of text): Short: Neighbours (1952).
        text: 'Live-action pixilation: photographed physical textures, discontinuous pose changes, impossible incremental movement and crisp frame-by-frame spatial jumps.',
    },
    {
        id: 'object-replacement-metamorphosis',
        group: craft,
        name: 'Object replacement metamorphosis',
        // Reference only (not part of text): Short: Dimensions of Dialogue (1982).
        text: 'Object stop-motion: abrupt material substitutions, stable lighting, precise silhouette matching and tactile frame-by-frame transformations.',
    },
    {
        id: 'metal-assemblage-animation',
        group: craft,
        name: 'Metal assemblage animation',
        // Reference only (not part of text): Material variation; no canonical film attribution claimed.
        text: 'Metal assemblage stop-motion: scratched patina, riveted relief, hard specular light and rigid incremental articulation.',
    },
    {
        id: 'paper-sculpture-animation',
        group: craft,
        name: 'Paper sculpture animation',
        // Reference only (not part of text): Visual analogy: The Eagleman Stag (2011), sculptural geometry; actual material is different.
        text: 'Sculpted-paper stop-motion: dimensional folded forms, visible creases, matte paper grain, crisp shadows and stepped volumetric motion.',
    },
    {
        id: 'corrugated-cardboard-animation',
        group: craft,
        name: 'Corrugated cardboard animation',
        // Reference only (not part of text): Material variation; no canonical film attribution claimed.
        text: 'Cardboard stop-motion: exposed corrugated edges, fibrous surfaces, irregular seams and coarse articulated frame changes.',
    },
    {
        id: 'origami-fold-animation',
        group: craft,
        name: 'Origami fold animation',
        // Reference only (not part of text): Film: Kubo and the Two Strings (2016), mixed-technique origami sequences.
        text: 'Folded-paper animation: clean crease networks, angular planar volumes, fine fibers and progressive folding transformations.',
    },
    {
        id: 'torn-paper-relief-animation',
        group: craft,
        name: 'Torn-paper relief animation',
        // Reference only (not part of text): Material variation; dimensional relief rather than existing flat papercut theatre.
        text: 'Dimensional torn-paper animation: feathered edges, stacked fibrous layers, strong oblique relief shadows and irregular stepped parallax.',
    },
    {
        id: 'sand-on-glass-animation',
        group: craft,
        name: 'Sand-on-glass animation',
        // Reference only (not part of text): Short: The Metamorphosis of Mr. Samsa (1977).
        text: 'Sand-on-glass animation: granular dark deposits over transmitted light, finger-drawn gradients and continuously transforming flat silhouettes.',
    },
    {
        id: 'sand-sculpture-stop-motion',
        group: craft,
        name: 'Sand sculpture stop motion',
        // Reference only (not part of text): Short: The Sand Castle (1977); contrasts with flat sand-on-glass.
        text: 'Sculpted-sand stop-motion: porous granular volumes, crumbly edges, raking miniature light and incremental physical deformation.',
    },
    {
        id: 'paint-on-glass-animation',
        group: craft,
        name: 'Paint-on-glass animation',
        // Reference only (not part of text): Film: The Old Man and the Sea (1999).
        text: 'Oil-paint-on-glass animation: translucent wet strokes, luminous blended color, finger-soft edges and continuously repainted flowing motion.',
    },
    {
        id: 'clay-painting-animation',
        group: craft,
        name: 'Clay painting animation',
        // Reference only (not part of text): Short: Mona Lisa Descending a Staircase (1992).
        text: 'Flat clay-painting animation: thin colored plasticine smears, palette-knife ridges, layered soft edges and painterly frame-by-frame metamorphosis.',
    },
    {
        id: 'strata-cut-clay-animation',
        group: craft,
        name: 'Strata-cut clay animation',
        // Reference only (not part of text): Short: Buzz Box (1985).
        text: 'Strata-cut clay animation: changing marbled cross-sections, concentric colored bands, slicing irregularity and continuous abstract internal transformation.',
    },
    {
        id: 'clay-relief-animation',
        group: craft,
        name: 'Clay relief animation',
        // Reference only (not part of text): Material variation; related clay transformations in Dimensions of Dialogue (1982).
        text: 'Clay relief animation: shallow sculpted depth, raking side light, pressed ridges and tactile transforming bas-relief shadows.',
    },
    {
        id: 'monochrome-claymation-noir',
        group: craft,
        name: 'Monochrome claymation noir',
        // Reference only (not part of text): Film: Mary and Max (2009), predominantly monochrome clay look.
        text: 'Monochrome clay stop-motion: matte sculpted greys, rough fingerprints, low-key miniature light and heavy restrained incremental movement.',
    },
    {
        id: 'terracotta-animation',
        group: craft,
        name: 'Terracotta animation',
        // Reference only (not part of text): Material variation; no canonical film attribution claimed.
        text: 'Terracotta stop-motion look: porous earthy surfaces, dry tool marks, warm diffuse lighting and brittle-looking incremental deformation.',
    },
    {
        id: 'soft-wax-animation',
        group: craft,
        name: 'Soft wax animation',
        // Reference only (not part of text): Visual analogy: Darkness Light Darkness (1989), malleable motion; actual medium is clay.
        text: 'Wax-sculpture stop-motion look: warm translucency, rounded softened edges, glossy surface pools and slow deforming frame changes.',
    },
    {
        id: 'plasticine-morph-animation',
        group: craft,
        name: 'Plasticine morph animation',
        // Reference only (not part of text): Short: Darkness Light Darkness (1989).
        text: 'Plasticine metamorphic animation: mass-preserving reshaping, visible kneading marks, matte saturated color and fluid stepped transformations.',
    },
    {
        id: 'pinscreen-animation',
        group: craft,
        name: 'Pinscreen animation',
        // Reference only (not part of text): Short: Mindscape (1976).
        text: 'Pinscreen animation: stippled monochrome relief shadows, velvety gradients, engraved-looking edges and continuously shifting chiaroscuro.',
    },
    {
        id: 'glass-sculpture-animation',
        group: craft,
        name: 'Glass sculpture animation',
        // Reference only (not part of text): Material variation; no canonical film attribution claimed.
        text: 'Glass-like animation: thick transparent edges, colored refraction, internal caustics and precise incremental changes under hard light.',
    },
    {
        id: 'ceramic-glaze-animation',
        group: craft,
        name: 'Ceramic glaze animation',
        // Reference only (not part of text): Material variation; no canonical film attribution claimed.
        text: 'Ceramic stop-motion look: opaque glazed volumes, tiny surface crazing, pooled color and rigid articulated frame changes.',
    },
    {
        id: 'sugar-icing-animation',
        group: craft,
        name: 'Sugar icing animation',
        // Reference only (not part of text): Material variation; no canonical film attribution claimed.
        text: 'Icing-sculpture stop-motion look: piped matte ridges, granular highlights, pastel density and compressible frame-by-frame deformation.',
    },
    {
        id: 'brick-stop-motion',
        group: craft,
        name: 'Brick stop motion',
        // Reference only (not part of text): Film: The Lego Movie (2014), CGI imitation of the brick-film look.
        text: 'Interlocking-brick stop-motion look: plastic studs, modular seams, glossy specular edges and stepped limited-joint motion.',
    },
    {
        id: 'photoreal-digital-rendering',
        group: craft,
        name: 'Photoreal digital rendering',
        // Reference only (not part of text): Film: The Jungle Book (2016), digital rendering.
        text: 'Photoreal CGI: physically based material response, microtexture, natural subsurface scattering, calibrated optical blur and live-action-like motion.',
    },
    {
        id: 'painterly-brushstroke-cgi',
        group: craft,
        name: 'Painterly brushstroke CGI',
        // Reference only (not part of text): Film: Puss in Boots: The Last Wish (2022).
        text: 'Painterly 3D animation: textured brush marks on volumes, broken painted highlights, variable edge definition and stepped expressive timing.',
    },
    {
        id: 'clay-render-cgi',
        group: craft,
        name: 'Clay-render CGI',
        // Reference only (not part of text): Digital material study, distinct from physical claymation.
        text: '3D clay-render look: uniform matte sculpting material, broad studio shadows, visible sculptural volume and restrained surface detail.',
    },
    {
        id: 'wireframe-cgi',
        group: craft,
        name: 'Wireframe CGI',
        // Reference only (not part of text): Related film: Tron (1982), early-computer graphic aesthetic.
        text: '3D wireframe rendering: luminous polygon edges, transparent overlapping topology, dark empty fills and smooth geometric camera movement.',
    },
    {
        id: 'chrome-ray-traced-cgi',
        group: craft,
        name: 'Chrome ray-traced CGI',
        // Reference only (not part of text): Compilation film: The Minds Eye (1990), early CGI reference.
        text: 'Ray-traced 3D: mirror-polished surfaces, recursive reflections, sharp studio highlights and clean smooth geometric motion.',
    },
    {
        id: 'translucent-subsurface-cgi',
        group: craft,
        name: 'Translucent subsurface CGI',
        // Reference only (not part of text): Digital material variation; no canonical film attribution claimed.
        text: '3D translucent rendering: internal light diffusion, luminous thick edges, soft colored shadows and smooth volumetric shading.',
    },
    {
        id: 'ps2-survival-horror-rendering',
        group: craft,
        name: 'PS2 survival-horror rendering',
        // Reference only (not part of text): Game: Silent Hill 2 (2001); no film-production claim.
        text: 'Early-2000s real-time 3D: soft low-resolution textures, baked shadows, restrained polygons, light bloom and subtle full-frame noise.',
    },
    {
        id: 'nintendo-64-texture-softness',
        group: craft,
        name: 'Nintendo 64 texture softness',
        // Reference only (not part of text): Game: Super Mario 64 (1996).
        text: 'Late-1990s real-time 3D: blurred tiny textures, smooth vertex colors, chunky geometry, fog falloff and simple rigid animation.',
    },
    {
        id: 'dreamcast-arcade-rendering',
        group: craft,
        name: 'Dreamcast arcade rendering',
        // Reference only (not part of text): Game: Sonic Adventure (1998).
        text: 'Turn-of-millennium arcade 3D: medium-density geometry, bright vertex lighting, shiny simple materials and crisp colorful effects.',
    },
    {
        id: 'early-pre-rendered-cgi',
        group: craft,
        name: 'Early pre-rendered CGI',
        // Reference only (not part of text): Short: Tin Toy (1988); film: Toy Story (1995).
        text: 'Early offline CGI: smooth primitive volumes, simple plastic specular shading, sparse detail and early ray-traced shadows.',
    },
    {
        id: 'pointillist-painting',
        group: painted,
        name: 'Pointillist painting',
        // Reference only (not part of text): Art: Georges Seurat; no canonical film use claimed.
        text: 'Animated pointillist painting: discrete unmixed dots, optical color blending, granular highlights and softly vibrating edges.',
    },
    {
        id: 'divisionist-brushwork',
        group: painted,
        name: 'Divisionist brushwork',
        // Reference only (not part of text): Art: Giovanni Segantini; no canonical film use claimed.
        text: 'Animated divisionist painting: parallel broken strokes, contrasting colors, luminous optical mixing and rhythmic directional texture.',
    },
    {
        id: 'fauvist-color',
        group: painted,
        name: 'Fauvist color',
        // Reference only (not part of text): Art: Henri Matisse; no canonical film use claimed.
        text: 'Animated fauvist painting: non-naturalistic saturated color, loose broad strokes, flat shadows and expressive contour accents.',
    },
    {
        id: 'analytical-cubism',
        group: painted,
        name: 'Analytical cubism',
        // Reference only (not part of text): Art: Georges Braque; no canonical film use claimed.
        text: 'Animated analytical cubist painting: fragmented planes, muted ochre-grey tones, simultaneous viewpoints and faceted shaded contours.',
    },
    {
        id: 'synthetic-cubist-collage',
        group: painted,
        name: 'Synthetic cubist collage',
        // Reference only (not part of text): Art: Juan Gris; no canonical film use claimed.
        text: 'Animated cubist collage: pasted-paper planes, rough print texture, interlocking geometry and flat color overlays; no lettering.',
    },
    {
        id: 'futurist-dynamism',
        group: painted,
        name: 'Futurist dynamism',
        // Reference only (not part of text): Art: Giacomo Balla; no canonical film use claimed.
        text: 'Animated futurist painting: repeated directional contours, angular motion decomposition, fractured luminous color and sweeping diagonals.',
    },
    {
        id: 'suprematist-abstraction',
        group: painted,
        name: 'Suprematist abstraction',
        // Reference only (not part of text): Art: Kazimir Malevich; no canonical film use claimed.
        text: 'Animated suprematist painting: floating geometric planes, stark white space, limited red-black accents and precise flat spatial relations.',
    },
    {
        id: 'de-stijl-geometry',
        group: painted,
        name: 'De Stijl geometry',
        // Reference only (not part of text): Art: Piet Mondrian; no canonical film use claimed.
        text: 'Animated neoplastic painting: orthogonal divisions, primary red-blue-yellow planes, white space and strict black structural lines.',
    },
    {
        id: 'orphist-color-circles',
        group: painted,
        name: 'Orphist color circles',
        // Reference only (not part of text): Art: Sonia Delaunay; no canonical film use claimed.
        text: 'Animated orphist painting: overlapping circular rhythms, transparent prismatic planes, high chroma and flowing rotational abstraction.',
    },
    {
        id: 'vorticist-angularity',
        group: painted,
        name: 'Vorticist angularity',
        // Reference only (not part of text): Art: Wyndham Lewis; no canonical film use claimed.
        text: 'Animated vorticist illustration: fractured diagonals, compressed geometric planes, forceful black contours and restrained hard color.',
    },
    {
        id: 'expressionist-woodgrain-print',
        group: painted,
        name: 'Expressionist woodgrain print',
        // Reference only (not part of text): Art: Ernst Ludwig Kirchner; distinct from live-action expressionism.
        text: 'Animated expressionist print: jagged cuts, exposed grain, compressed depth and black-white clashes with sparse color.',
    },
    {
        id: 'secessionist-mosaic-painting',
        group: painted,
        name: 'Secessionist mosaic painting',
        // Reference only (not part of text): Art: Gustav Klimt; no canonical film use claimed.
        text: 'Animated decorative painting: tessellated gold-like planes, geometric rhythms, luminous flat color and delicate contour boundaries.',
    },
    {
        id: 'symbolist-pastel-haze',
        group: painted,
        name: 'Symbolist pastel haze',
        // Reference only (not part of text): Art: Odilon Redon; no canonical film use claimed.
        text: 'Animated symbolist pastel: glowing powdery color, dissolving edges, indigo-violet shadows and suspended diffuse illumination.',
    },
    {
        id: 'pre-raphaelite-glazing',
        group: painted,
        name: 'Pre-Raphaelite glazing',
        // Reference only (not part of text): Art: John Everett Millais; visual analogy: Ophelia (2018).
        text: 'Animated oil painting: jewel-like translucent glazes, fine luminous detail, separated colors and softly modeled light.',
    },
    {
        id: 'rococo-pastel-painting',
        group: painted,
        name: 'Rococo pastel painting',
        // Reference only (not part of text): Art: Jean-Honore Fragonard; palette analogy: Marie Antoinette (2006).
        text: 'Animated rococo painting: feathery brushwork, pearly highlights, rose-blue-cream colors and flowing asymmetric composition.',
    },
    {
        id: 'dutch-golden-age-light',
        group: painted,
        name: 'Dutch Golden Age light',
        // Reference only (not part of text): Film: Girl with a Pearl Earring (2003), live-action lighting reference.
        text: 'Animated oil painting: soft lateral illumination, warm neutral shadows, restrained brushwork and graduated luminous highlights.',
    },
    {
        id: 'tonalist-painting',
        group: painted,
        name: 'Tonalist painting',
        // Reference only (not part of text): Art: James McNeill Whistler; no canonical film use claimed.
        text: 'Animated tonalist painting: narrow muted color range, soft silhouettes, deep grey-green midtones and gentle luminous transitions.',
    },
    {
        id: 'german-romantic-atmosphere',
        group: painted,
        name: 'German Romantic atmosphere',
        // Reference only (not part of text): Art: Caspar David Friedrich; compositional analogy: Nosferatu (1979).
        text: 'Animated Romantic painting: layered cool glazes, distant tonal recession, subdued earthy color and luminous diffused depth.',
    },
    {
        id: 'atmospheric-color-dissolution',
        group: painted,
        name: 'Atmospheric color dissolution',
        // Reference only (not part of text): Art: J. M. W. Turner; film reference: Mr. Turner (2014).
        text: 'Animated atmospheric oil painting: warm-cool luminous veils, dissolved contours, scumbled pigment and swirling light gradients.',
    },
    {
        id: 'ashcan-brush-realism',
        group: painted,
        name: 'Ashcan brush realism',
        // Reference only (not part of text): Art: George Bellows; no scene content implied.
        text: 'Animated realist oil painting: rough loaded brushwork, sooty warm greys, blunt highlights and lively uneven contours.',
    },
    {
        id: 'precisionist-painting',
        group: painted,
        name: 'Precisionist painting',
        // Reference only (not part of text): Art: Charles Sheeler; no canonical film use claimed.
        text: 'Animated precisionist painting: hard-edged planes, clean perspective, cool smooth gradients and minimal visible brushwork.',
    },
    {
        id: 'magic-realist-tempera',
        group: painted,
        name: 'Magic-realist tempera',
        // Reference only (not part of text): Art: Franz Radziwill; no canonical film use claimed.
        text: 'Animated tempera realism: sharply resolved matte detail, still clear light, precise tonal edges and low-chroma color.',
    },
    {
        id: 'metaphysical-painting',
        group: painted,
        name: 'Metaphysical painting',
        // Reference only (not part of text): Art: Giorgio de Chirico; spatial analogy: Last Year at Marienbad (1961).
        text: 'Animated metaphysical painting: geometric shadow shapes, flattened deep perspective, ochre-green color and unnaturally still clear light.',
    },
    {
        id: 'surrealist-smooth-oil',
        group: painted,
        name: 'Surrealist smooth oil',
        // Reference only (not part of text): Short: Destino (2003).
        text: 'Animated surrealist painting: smoothly blended oil surfaces, hyperclear contours, displaced scale and lucid uncanny illumination.',
    },
    {
        id: 'automatic-surrealist-drawing',
        group: painted,
        name: 'Automatic surrealist drawing',
        // Reference only (not part of text): Art: Andre Masson; no canonical film use claimed.
        text: 'Animated automatic drawing: wandering ink contours, unstable organic shapes, sparse wash color and spontaneous flowing metamorphosis.',
    },
    {
        id: 'abstract-expressionist-gesture',
        group: painted,
        name: 'Abstract expressionist gesture',
        // Reference only (not part of text): Art: Willem de Kooning; paintings reference: Pollock (2000), not an animation technique claim.
        text: 'Animated gestural painting: impulsive broad strokes, layered splashes, raw canvas texture and changing directional rhythms.',
    },
    {
        id: 'color-field-painting',
        group: painted,
        name: 'Color-field painting',
        // Reference only (not part of text): Art: Mark Rothko; no canonical film use claimed.
        text: 'Animated color-field painting: large softly edged chromatic areas, translucent layers, diffuse boundaries and slow tonal shifts.',
    },
    {
        id: 'hard-edge-abstraction',
        group: painted,
        name: 'Hard-edge abstraction',
        // Reference only (not part of text): Art: Ellsworth Kelly; no canonical film use claimed.
        text: 'Animated hard-edge painting: bounded flat color areas, interlocking geometric shapes, no surface grain and measured graphic motion.',
    },
    {
        id: 'impasto-palette-knife',
        group: painted,
        name: 'Impasto palette knife',
        // Reference only (not part of text): Related film: Loving Vincent (2017), oil animation; not exclusively palette knife.
        text: 'Animated impasto oil painting: ridged pigment, palette-knife facets, broken highlights and sculptural shifting paint texture.',
    },
    {
        id: 'encaustic-wax-painting',
        group: painted,
        name: 'Encaustic wax painting',
        // Reference only (not part of text): Art: Jasper Johns; no canonical film use claimed.
        text: 'Animated encaustic painting: translucent wax layers, cloudy pigment, scraped edges and softly reflective surface depth.',
    },
    {
        id: 'egg-tempera-panels',
        group: painted,
        name: 'Egg tempera panels',
        // Reference only (not part of text): Traditional painting technique; no canonical film use claimed.
        text: 'Animated egg-tempera painting: hatched matte pigment, luminous pale grounds, precise contours and shallow transparent color buildup.',
    },
    {
        id: 'gouache-editorial-illustration',
        group: painted,
        name: 'Gouache editorial illustration',
        // Reference only (not part of text): Visual analogy: The Illusionist (2010), painted color and texture.
        text: 'Animated gouache illustration: opaque chalky color, dry-brush edges, bold flat shapes and uneven painted coverage.',
    },
    {
        id: 'soft-chalk-pastel',
        group: painted,
        name: 'Soft chalk pastel',
        // Reference only (not part of text): Short: Crac! (1981).
        text: 'Animated soft-pastel drawing: powdery grain, smudged edges, exposed paper tooth and luminous blended color.',
    },
    {
        id: 'oil-pastel-drawing',
        group: painted,
        name: 'Oil pastel drawing',
        // Reference only (not part of text): Material variation; no canonical film attribution claimed.
        text: 'Animated oil-pastel drawing: waxy dense strokes, heavily layered color, scumbled edges and saturated tactile line texture.',
    },
    {
        id: 'silverpoint-drawing',
        group: painted,
        name: 'Silverpoint drawing',
        // Reference only (not part of text): Traditional metalpoint technique; no canonical film use claimed.
        text: 'Animated silverpoint drawing: pale-grey fine lines, delicate crosshatching, warm prepared ground and restrained low-contrast precision.',
    },
    {
        id: 'red-chalk-drawing',
        group: painted,
        name: 'Red chalk drawing',
        // Reference only (not part of text): Traditional drawing technique; no canonical film use claimed.
        text: 'Animated red-chalk drawing: warm sanguine strokes, grainy hatching, rubbed shadows and cream paper highlights.',
    },
    {
        id: 'scratchboard-engraving',
        group: painted,
        name: 'Scratchboard engraving',
        // Reference only (not part of text): Print-derived technique; no canonical film use claimed.
        text: 'Animated scratchboard illustration: incised white lines through black, tightly hatched highlights and crisp high-contrast surface detail.',
    },
    {
        id: 'copperplate-engraving',
        group: painted,
        name: 'Copperplate engraving',
        // Reference only (not part of text): Print technique; no canonical film use claimed.
        text: 'Animated copperplate engraving: incised parallel hatching, precise curved lines, deep black ink and embossed cream paper.',
    },
    {
        id: 'mezzotint-print',
        group: painted,
        name: 'Mezzotint print',
        // Reference only (not part of text): Visual analogy: Mindscape (1976), pinscreen tonal resemblance; not mezzotint production.
        text: 'Animated mezzotint print: velvety granular blacks, burnished highlights, rich continuous greys and dissolving dark edges.',
    },
    {
        id: 'aquatint-etching',
        group: painted,
        name: 'Aquatint etching',
        // Reference only (not part of text): Art: Francisco Goya; no canonical film use claimed.
        text: 'Animated aquatint print: porous tonal islands, etched contours, uneven ink density and softly bitten grey washes.',
    },
    {
        id: 'drypoint-etching',
        group: painted,
        name: 'Drypoint etching',
        // Reference only (not part of text): Print technique; no canonical film use claimed.
        text: 'Animated drypoint print: burr-like ink fringes, scratched contours, rich black deposits and visible rough paper.',
    },
    {
        id: 'lithographic-crayon',
        group: painted,
        name: 'Lithographic crayon',
        // Reference only (not part of text): Art: Honore Daumier; no canonical film use claimed.
        text: 'Animated lithograph: greasy granular lines, broad textured shading, muted spot colors and uneven printed tonal fields.',
    },
    {
        id: 'mokuhanga-gradient-print',
        group: painted,
        name: 'Mokuhanga gradient print',
        // Reference only (not part of text): Bokashi gradient emphasis; distinct from existing bold ukiyo-e preset.
        text: 'Animated water-based woodblock print: brushed color gradations, absorbent paper, delicate registration and transparent layered ink.',
    },
    {
        id: 'reduction-woodcut-color',
        group: painted,
        name: 'Reduction woodcut color',
        // Reference only (not part of text): Print technique; no canonical film use claimed.
        text: 'Animated reduction woodcut: interlocking carved colors, layered opaque inks, rough edges and slight registration shifts.',
    },
    {
        id: 'stencil-street-art',
        group: painted,
        name: 'Stencil street art',
        // Reference only (not part of text): Film: Exit Through the Gift Shop (2010), artworks reference; not animation production.
        text: 'Animated stencil print: masked silhouettes, aerosol edge mist, flat contrasting colors and irregular sprayed surface grain.',
    },
    {
        id: 'airbrush-hyperrealism',
        group: painted,
        name: 'Airbrush hyperrealism',
        // Reference only (not part of text): Art: Audrey Flack; no canonical film use claimed.
        text: 'Animated airbrush painting: seamless glossy gradients, sharp reflected highlights, smooth color and exaggerated surface sheen.',
    },
    {
        id: 'ballpoint-pen-hatching',
        group: painted,
        name: 'Ballpoint pen hatching',
        // Reference only (not part of text): Drawing technique; no canonical film use claimed.
        text: 'Animated ballpoint drawing: blue crosshatching, pressure-varying lines, tiny ink accumulations and untouched paper highlights.',
    },
    {
        id: 'continuous-contour-drawing',
        group: painted,
        name: 'Continuous contour drawing',
        // Reference only (not part of text): Related series: La Linea (1971), continuous-line logic.
        text: 'Animated contour drawing: one flowing uneven line, minimal internal detail, white negative space and continuously redrawn motion.',
    },
    {
        id: 'pixel-art-animation',
        group: painted,
        name: 'Pixel-art animation',
        // Reference only (not part of text): Game: Another World (1991); no film-production claim.
        text: '2D pixel animation: deliberate low-resolution clusters, indexed palette, stepped contours and crisp frame-based motion without smoothing.',
    },
    {
        id: 'mosaic-tessera-animation',
        group: painted,
        name: 'Mosaic tessera animation',
        // Reference only (not part of text): Art technique; no canonical film use claimed.
        text: 'Animated mosaic: discrete irregular tesserae, visible grout gaps, broken reflective color and stepped tile-by-tile transformation.',
    },
    {
        id: 'weirdcore-image-collage',
        group: medium,
        name: 'Weirdcore image collage',
        // Reference only (not part of text): Visual analogy: Inland Empire (2006), digital unease; not a historical weirdcore classification.
        text: 'Experimental digital collage: uneasy scale discontinuities, harsh flash, low-resolution cutout edges and deliberately mismatched color spaces; no text.',
    },
    {
        id: 'dreamcore-soft-unreality',
        group: medium,
        name: 'Dreamcore soft unreality',
        // Reference only (not part of text): Visual analogy: Skinamarink (2022), perceptual unease; not a canonical dreamcore classification.
        text: 'Experimental digital imagery: blown pastel highlights, vague depth cues, diffuse blur, uncanny negative space and floating motion; no text.',
    },
    {
        id: 'liminal-digital-photography',
        group: medium,
        name: 'Liminal digital photography',
        // Reference only (not part of text): Web short: The Backrooms (Kane Pixels, 2022), visual reference.
        text: 'Digital photographic liminality: overly even exposure, fixed wide perspective, subdued color, vast negative space and subtly incorrect depth.',
    },
    {
        id: 'analog-broadcast-horror',
        group: medium,
        name: 'Analog broadcast horror',
        // Reference only (not part of text): Web series: Local 58 (2015 onward).
        text: 'Analog broadcast degradation: unstable synchronization, black-level pumping, smeared composite color, signal loss and electronic warping; no overlays.',
    },
    {
        id: 'hi8-consumer-video',
        group: medium,
        name: 'Hi8 consumer video',
        // Reference only (not part of text): Related film: The Celebration (1998), consumer-video look; source format differs.
        text: 'Hi8 analog video: soft interlaced detail, chroma crawl, clipped highlights, handheld micro-jitter and subtle tape dropout.',
    },
    {
        id: 'minidv-interlaced-video',
        group: medium,
        name: 'MiniDV interlaced video',
        // Reference only (not part of text): Film: Dancer in the Dark (2000), digital-video reference.
        text: 'MiniDV digital video: clipped highlights, blocky chroma, interlaced motion edges, deep focus and abrupt automatic exposure changes.',
    },
    {
        id: 'betacam-broadcast-video',
        group: medium,
        name: 'Betacam broadcast video',
        // Reference only (not part of text): Related film: No (2012), U-matic rather than Betacam production.
        text: 'Analog component broadcast-video look: crisp luminance edges, restrained chroma resolution, interlaced motion and stable electronic exposure.',
    },
    {
        id: 'u-matic-video-texture',
        group: medium,
        name: 'U-matic video texture',
        // Reference only (not part of text): Film: No (2012).
        text: 'U-matic analog video: soft electronic detail, subdued smeared chroma, scanline structure and unstable shadow noise.',
    },
    {
        id: 'early-webcam-compression',
        group: medium,
        name: 'Early webcam compression',
        // Reference only (not part of text): Visual analogy: Unfriended (2014), screen-video texture; no interface implied.
        text: 'Early webcam video: tiny-sensor noise, low-frame-rate stepping, block compression, smeared low-light color and fixed close perspective.',
    },
    {
        id: 'thermal-false-color',
        group: medium,
        name: 'Thermal false color',
        // Reference only (not part of text): Film: Predator (1987), thermal-vision sequences.
        text: 'Thermal-camera imagery: temperature-mapped color bands, soft emissive contours, low spatial resolution and abrupt tonal thresholds; no labels.',
    },
    {
        id: 'image-intensifier-night-vision',
        group: medium,
        name: 'Image-intensifier night vision',
        // Reference only (not part of text): Film: The Silence of the Lambs (1991), selected imagery.
        text: 'Image-intensifier footage: phosphor-green monochrome, scintillating grain, bright-source bloom, optical vignetting and soft low-light contours.',
    },
    {
        id: 'schlieren-optical-imaging',
        group: medium,
        name: 'Schlieren optical imaging',
        // Reference only (not part of text): Scientific imaging technique; no canonical film use claimed.
        text: 'Schlieren-style imaging: monochrome density gradients, fine refractive distortions, shimmering edge bands and crisp laboratory-like contrast.',
    },
    {
        id: 'electron-microscope-imaging',
        group: medium,
        name: 'Electron-microscope imaging',
        // Reference only (not part of text): Scientific imaging analogy; no canonical film use claimed.
        text: 'Electron-microscope-like imagery: granular monochrome, extreme apparent magnification, deep surface relief and sculpted edge illumination.',
    },
    {
        id: 'x-ray-translucent-imaging',
        group: medium,
        name: 'X-ray translucent imaging',
        // Reference only (not part of text): Film: Total Recall (1990), stylized X-ray sequence.
        text: 'Radiographic imagery: translucent overlapping densities, luminous internal contours, charcoal backgrounds and fine grain; no labels.',
    },
    {
        id: 'solarized-photographic-reversal',
        group: medium,
        name: 'Solarized photographic reversal',
        // Reference only (not part of text): Related film: Orpheus (1950), negative-image effects; not a solarization-process attribution.
        text: 'Solarized imagery: partial tonal reversal, glowing contour boundaries, metallic greys and unstable negative-positive transitions.',
    },
    {
        id: 'negative-color-film',
        group: medium,
        name: 'Negative color film',
        // Reference only (not part of text): Film: 2001: A Space Odyssey (1968), selected optical imagery.
        text: 'Color-negative treatment: inverted luminance, cyan-orange reversals, dark highlights and glowing pale shadow detail.',
    },
    {
        id: 'hand-tinted-monochrome',
        group: medium,
        name: 'Hand-tinted monochrome',
        // Reference only (not part of text): Film: A Trip to the Moon (1902), hand-colored version.
        text: 'Hand-tinted monochrome film: uneven transparent washes over silver greys, imperfect registration and flickering pigment boundaries.',
    },
    {
        id: 'hand-painted-direct-film',
        group: medium,
        name: 'Hand-painted direct film',
        // Reference only (not part of text): Short: Begone Dull Care (1949).
        text: 'Direct-on-film animation: translucent pigment strokes, scratching, uneven dye pools and rapidly changing abstract marks over projected color.',
    },
    {
        id: 'scratched-direct-film',
        group: medium,
        name: 'Scratched direct film',
        // Reference only (not part of text): Short: Blinkity Blank (1955).
        text: 'Scratched-film animation: bright incised lines on black emulsion, uneven contours, flicker and rapid graphic frame changes.',
    },
    {
        id: 'film-emulsion-decay',
        group: medium,
        name: 'Film emulsion decay',
        // Reference only (not part of text): Film: Decasia (2002).
        text: 'Decayed film-print look: bubbling emulsion islands, faded dyes, organic edge erosion, granular silver breakup and unstable exposure.',
    },
    {
        id: 'cameraless-photogram-film',
        group: medium,
        name: 'Cameraless photogram film',
        // Reference only (not part of text): Film: Le Retour a la raison (1923).
        text: 'Photogram animation: contact-exposed silhouettes, sharp-to-soft translucent edges, monochrome grain and rhythmic frame-by-frame density changes.',
    },
    {
        id: 'slit-scan-temporal-streaking',
        group: medium,
        name: 'Slit-scan temporal streaking',
        // Reference only (not part of text): Film: 2001: A Space Odyssey (1968), Stargate effects.
        text: 'Slit-scan optical imagery: elongated color ribbons, continuous perspective stretching, spectral gradients and smooth temporal traces.',
    },
    {
        id: 'datamosh-motion-corruption',
        group: medium,
        name: 'Datamosh motion corruption',
        // Reference only (not part of text): Music video: Chairlift - Evident Utensil (2009).
        text: 'Digital datamosh: displaced motion blocks, smeared interframe persistence, broken contour prediction and cascading compressed color residues.',
    },
    {
        id: 'video-feedback-recursion',
        group: medium,
        name: 'Video feedback recursion',
        // Reference only (not part of text): Experimental video reference: Steina and Woody Vasulka; no feature-film attribution claimed.
        text: 'Analog video feedback: nested frames, luminous edge echoes, oscillating color bands and continuously folding recursive perspective.',
    },
    {
        id: 'analog-video-synthesis',
        group: medium,
        name: 'Analog video synthesis',
        // Reference only (not part of text): Experimental video reference: Nam June Paik; no feature-film attribution claimed.
        text: 'Analog video-synthesizer animation: electronic contour warping, saturated keyed color, soft raster glow and elastic real-time shape oscillation.',
    },
    {
        id: 'crt-vector-display',
        group: medium,
        name: 'CRT vector display',
        // Reference only (not part of text): Related film: Tron (1982), vector-like graphic sequences.
        text: 'Vector-display animation: luminous monochrome strokes, bright intersection bloom, phosphor persistence and geometric line-only depth.',
    },
    {
        id: 'one-bit-ordered-dithering',
        group: medium,
        name: 'One-bit ordered dithering',
        // Reference only (not part of text): Digital technique; no canonical film use claimed.
        text: 'One-bit digital imagery: black-white ordered patterns, fixed pixel grids, hard thresholds and crisp low-resolution temporal changes.',
    },
    {
        id: 'lenticular-parallax-collage',
        group: medium,
        name: 'Lenticular parallax collage',
        // Reference only (not part of text): Optical material technique; no canonical film use claimed.
        text: 'Lenticular-image look: alternating view slices, shallow parallax jumps, ribbed optical texture and shifting color-angle relationships.',
    },
    {
        id: 'chronophotographic-sequence',
        group: medium,
        name: 'Chronophotographic sequence',
        // Reference only (not part of text): Film precursor: Etienne-Jules Marey motion studies.
        text: 'Chronophotographic imagery: successive translucent motion phases, repeated offset contours, fixed analytical framing and monochrome photographic detail.',
    },
    {
        id: 'liquid-light-projection',
        group: medium,
        name: 'Liquid-light projection',
        // Reference only (not part of text): Film analogy: The Trip (1967), psychedelic optical imagery.
        text: 'Liquid-light imagery: translucent fluid color membranes, bubbling boundaries, saturated dye overlaps and evolving organic interference.',
    },

]

/** Realistic looks: filmed live action. Everything else (animation, craft, painted, found media) is artistic. */
export const isRealistic = (style: FilmStyle) => style.group === live || style.group === liveLook

/** How often a live action style is drawn when the candidates have both - the artistic ones are the exception. */
export const REALISTIC_SHARE = 0.85

/**
 * A random style from the list (or from the given candidates): a live action one in most cases, because most of
 * the list is not (58 of 94) and a plain uniform draw gave a painted or drawn look to stories that wanted none.
 */
export function pickStyle(candidates: FilmStyle[] = STYLES, random = Math.random): FilmStyle {
    const realistic = candidates.filter(isRealistic)
    const artistic = candidates.filter(style => !isRealistic(style))
    const pool = realistic.length && artistic.length ? (random() < REALISTIC_SHARE ? realistic : artistic) : candidates
    return pool[Math.floor(random() * pool.length)]!
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
