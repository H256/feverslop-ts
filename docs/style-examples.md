# Style examples for `input/style.txt`

Generated from [lib/styles.ts](../lib/styles.ts) by `bun run styles:doc` - edit the styles there.

`input/style.txt` is optional. Without it, the first run has the LLM shortlist 5 styles from this list that fit the
story, draws one at random and writes it to `input/style.txt` - edit or replace the file to use a different one (the
look brief is then redone). `bun run init` can also choose one from this list. With the file, the look brief keeps your medium, style and named references exactly and only extends them (world,
palette, lighting, camera language, texture). Copy one of the examples below, or mix its building blocks into your own.

What works well with Krea 2 (stills) and MiniMax H3 (clips):

- **Name the medium first**, then say how it is shot, drawn or built (stock, lens, line work, shading, materials).
- **Describe the look, not the content.** Medium, stock or rendering, lens, light, palette, grain, camera behavior - and
  say it with visible things ("hard low-key light, crushed blacks, fine silver grain" beats "dark and moody"). Leave out
  places, props, costumes, weather and people: a style applies to every scene of the film, and whatever it names
  ("cigarette smoke", "rain-slick streets", "castle sets") shows up in all of them. The story brings the content.
- **Commit to one style.** Mixing ("photorealistic anime") confuses both models.
- **Anime and stylized looks:** name the rendering ("flat cel shading, two-tone shadows, clean dark linework"), not just
  the genre.
- Two to four sentences are plenty. The look brief adds the rest.

## Live action - eras

**1. Silent-era expressionism** (`silent-expressionism`)
Black-and-white silent film in the manner of German expressionism (Nosferatu, Caligari): hard high-contrast light with long distorted shadows, exaggerated canted angles, iris-in and iris-out transitions, flickering orthochromatic contrast, visible film scratches.

**2. Silent slapstick** (`silent-slapstick`)
Black-and-white 1920s silent comedy film: hand-cranked slightly fast motion, flat even daylight, wide static framing, sepia-toned scratched film stock.

**3. Hollywood Technicolor** (`golden-age-technicolor`)
1940s-50s three-strip Technicolor look: soft-focus key light, saturated reds and teals, formal three-point studio lighting, slow tracking camera moves, glossy polished finish.

**4. Film noir** (`film-noir`)
Black-and-white 35mm film in the manner of 1940s film noir: hard low-key lighting, deep focus, tilted frames, hard contrast with crushed blacks, fine silver grain.

**5. Hammer-style gothic horror** (`hammer-horror`)
1960s British gothic horror on saturated Eastmancolor: theatrical studio lighting, bright blood-red against deep green and blue shadows, strong saturated color contrast, slow theatrical dolly-ins.

**6. French New Wave** (`french-new-wave`)
Black-and-white 35mm art-house film in the manner of the French New Wave: handheld camerawork in natural light, jump cuts, long walking takes, grainy high-contrast stock.

**7. Spaghetti western** (`italo-western`)
Italian spaghetti-western look on widescreen 35mm: extreme close-ups, sun-bleached dust-yellow palette, hard high-noon light with long shadows, slow zooms, wide anamorphic compositions.

**8. Giallo thriller** (`giallo`)
1970s Italian giallo thriller look: saturated primary-color gels (red, blue, green) on stark white light, subjective stalking camera, sudden zooms, extreme close-ups, glossy 1970s finish.

**9. 1970s New Hollywood** (`new-hollywood-70s`)
Gritty 1970s American drama shot on 35mm: warm brown-and-amber palette, underexposed available light, slow creeping zooms, grainy stock, soft low-contrast image.

**10. 70s grindhouse** (`grindhouse-70s`)
1970s grindhouse exploitation print look: scratched and faded film with splices and reel-change marks, oversaturated red and orange, crash zooms, handheld camera, rough low-budget image quality.

**11. 1980s blockbuster** (`blockbuster-80s`)
1980s adventure blockbuster look on 35mm anamorphic: backlit haze with shafts of light, saturated primary colors, practical-effects feel, sweeping crane shots, lens flares.

**12. 80s neon thriller** (`neon-thriller-80s`)
1980s neon-lit thriller look: pastel pink and teal palette, glossy high-contrast night photography, soft diffusion filters, chrome-and-glass sheen, smooth gliding camera.

**13. 1990s indie** (`indie-90s`)
1990s low-budget indie look: Super 16 grain, slightly blown-out highlights, flat available light, muted green-grey palette, handheld framing.

**14. Hong Kong action** (`hong-kong-action`)
1990s Hong Kong action film look: step-printed slow motion and smeared motion blur, saturated neon green and red, mirrored slow-motion close-ups, slightly soft anamorphic image.

**15. Dogme 95 handheld** (`dogme-handheld`)
Raw handheld digital-video drama look: no added light, shaky natural-light photography, jump cuts, washed-out color, visible lens smudges, abrupt focus hunting.

**16. Y2K music video** (`y2k-music-video`)
Late-1990s/2000 music-video look: fisheye-lens close-ups, glossy blue-white and chrome palette, fast whip pans, overexposed flash highlights, digital glitter.

**17. 2000s digital blockbuster** (`digital-blockbuster-2000s`)
2000s digital-intermediate blockbuster look: heavy teal-and-orange grade, desaturated mids, shaky-cam, gritty bleached highlights, smooth CG-polished image.

**18. Modern prestige drama** (`prestige-drama`)
Contemporary prestige streaming drama look on digital cinema cameras: shallow depth of field, naturalistic motivated light, desaturated teal-and-amber grade, slow push-ins, restrained handheld, clean sharp image.

**19. Slow art-house** (`slow-arthouse`)
Contemplative contemporary art-house cinema look: long static takes, wide locked-off frames, natural overcast light, muted earth colors, no camera movement.

**20. Pastel dollhouse symmetry** (`pastel-dollhouse`)
Live action in a strictly symmetrical dollhouse style: centered compositions, flat frontal framing, pastel pink, mint and mustard palette, flat even light, deadpan staging, lateral tracking shots.

## Live action - genres and looks

**21. Nordic noir** (`nordic-noir`)
Cold, bleached Scandinavian crime-thriller look: overcast flat light, pale blue-grey palette, muted desaturated color, long static wide shots, slow still camera.

**22. Handheld documentary** (`documentary-handheld`)
Handheld documentary look on a consumer camcorder: auto-exposure pumping, digital noise, blown-out on-camera light, off-center framing, snap zooms, harsh flash in the dark.

**23. Found footage horror** (`found-footage`)
Found-footage look on a shaky night-vision handheld camera: green-tinted infrared image, digital compression artifacts, crushed darkness, panicked shaky framing.

**24. CCTV surveillance** (`cctv-surveillance`)
Security-camera footage look: fixed high wide-angle corner viewpoint, grainy desaturated image, fisheye distortion, low frame rate with jerky motion, high camera angles looking down.

**25. Mockumentary** (`mockumentary`)
Mockumentary sitcom look: single handheld camera with awkward zooms, flat fluorescent light, glances to the lens, slightly washed-out digital video.

**26. Folk horror** (`folk-horror`)
Pastoral folk-horror look: bright overcast daylight, 16mm grain, muted earth colors, dread in broad daylight, slow handheld camera creeping in.

**27. Gothic horror** (`gothic-horror`)
Gothic horror look on 35mm: warm candle-like light against cold moonlight blue, crushed black shadows, slow dolly-ins, deep crimson accents against desaturated greys.

**28. Neon cyberpunk** (`cyberpunk-neon`)
Cyberpunk look shot on anamorphic digital: magenta and cyan neon light against black, wet reflective surfaces, hazy backlight, long-lens compression.

**29. Cold hard sci-fi** (`cold-scifi`)
Cold hard science-fiction look: sterile flat even fluorescent light, clean hard-edged compositions, sharp highlights against deep black, slow push-ins, restrained handheld, muted blue-grey palette.

**30. 70s retro sci-fi** (`retro-scifi-70s`)
1970s science-fiction look on grainy 35mm: orange-and-brown palette, matte-painting and practical-model feel, soft lens flares, slow zooms, gritty lived-in texture.

**31. Post-apocalyptic wasteland** (`post-apocalyptic`)
Post-apocalyptic look: bleached dust-brown and rust palette, harsh hard sun, low-angle shots, gritty handheld, orange-and-teal grade.

**32. Sun-bleached road movie** (`road-movie`)
Sun-bleached road-movie look on 16mm: overexposed highlights, warm dust-orange and faded denim-blue palette, heat-haze distortion, lens flares, low-angle shots.

**33. Epic fantasy** (`epic-fantasy-live-action`)
Live-action epic fantasy look on large-format digital: sweeping drone-like camera moves, golden-hour light through haze, emerald and silver palette, dynamic camera choreography, matte-painted depth.

**34. Candlelit period drama** (`candlelit-period-drama`)
Period-drama look lit only by candle and window light: warm amber glow with deep soft shadows, slow zooms out like moving paintings, symmetrical stately compositions.

**35. Desaturated war film** (`desaturated-war-film`)
Desaturated war-film look: muddy grey-green and brown palette, handheld camera, shutter-angle staccato motion, shaky close-ups, grit and smears on the lens.

**36. Glossy romantic comedy** (`glossy-romcom`)
Glossy romantic-comedy look: bright high-key light, warm pastel palette, soft diffused skin tones, golden-hour warmth, soft bokeh highlights, smooth steadicam moves.

## 2D animation - anime

**37. 90s cel anime** (`cel-anime-90s`)
2D anime in the style of 1990s cel animation: hand-painted backgrounds, flat cel shading with two-tone shadows, clean dark linework, limited animation timing, speed lines on action, slightly faded film color.

**38. Ghibli-style pastoral** (`ghibli-pastoral`)
Hand-painted Ghibli-style anime look: lush watercolor backgrounds, soft pastel shading, thin colored outlines, warm daylight, gentle painterly detail.

**39. Dark modern anime** (`dark-modern-anime`)
Modern dark-fantasy anime: crisp digital linework, high-contrast cel shading with hard black shadows, saturated accent colors against a muted palette, cinematic wide compositions, dramatic low angles, glowing particle effects.

**40. 80s OVA / city pop** (`ova-80s`)
Retro 1980s anime in the style of OVA cel animation: soft airbrushed backgrounds, purple-and-pink dusk palette, glossy highlights, slightly grainy VHS-transfer look, melancholic lighting.

**41. Shonen action** (`shonen-action`)
Shonen action anime look: bold thick outlines, saturated primary colors, extreme foreshortened perspective, impact frames with white flashes, speed lines, glowing energy auras, dynamic hand-drawn smear frames.

**42. Shojo romance** (`shojo-romance`)
Shojo romance anime look: soft pastel palette, sparkling highlights in large expressive eyes, thin delicate linework, overexposed bloom around the characters, warm soft afternoon light.

**43. Seinen thriller** (`seinen-thriller`)
Adult seinen thriller anime look: realistic proportions, muted grey-green palette, fine hatching shadows, restrained limited motion, cold fluorescent light, long still holds.

**44. Mecha anime** (`mecha-anime`)
1990s mecha anime look: glossy hard-surface shading with panel lines and highlights, cel-shaded effects, moody sunset color, tilted dramatic camera angles, hand-painted backgrounds.

**45. Lo-fi anime** (`lofi-anime`)
Cozy lo-fi anime look: soft muted pastel palette, warm window-like light, tiny looping gentle motion, flat shading with a faint film grain, calm quiet pacing.

**46. Rotoscoped look** (`rotoscope`)
Rotoscoped animation: live-action movement traced into wobbly hand-drawn outlines, flat watercolor fills that drift slightly out of the lines, shimmering line boil, loose naturalistic motion, dreamy muted colors.

**47. Chibi comedy** (`chibi-comedy`)
Chibi comedy anime: tiny big-headed characters, exaggerated squash-and-stretch reactions, sweat drops and anger veins, bright flat candy colors, simple clean backgrounds, quick snappy timing.

## 2D animation - western and graphic

**48. Comic / graphic novel** (`comic-graphic-novel`)
Inked graphic-novel look: heavy black ink outlines, flat cel-colored shapes with halftone dot shading, bold saturated spot colors, panel-like compositions, dynamic foreshortening, stylized motion lines.

**49. Mid-century cartoon** (`midcentury-cartoon`)
Flat 1950s mid-century cartoon style: simple geometric shapes, limited color palette, textured paper backgrounds, minimal shading, retro lounge colors (mustard, teal, walnut), snappy stylized motion.

**50. Classic Disney musical** (`disney-renaissance`)
Hand-drawn 1990s Disney-style animation look: fluid expressive animation, soft painted backgrounds with rich color, glowing magical light effects, big sweeping camera moves, warm rounded design.

**51. 1930s rubber-hose cartoon** (`rubber-hose-1930s`)
Black-and-white 1930s rubber-hose cartoon: noodle limbs and pie-cut eyes, everything bouncing to a beat, scratchy film grain, flickering exposure, simple painted backdrops.

**52. Saturday-morning cartoon** (`saturday-morning`)
1980s Saturday-morning cartoon look: flat bright cel colors, thick simple outlines, limited animation with held poses, repeated action loops, painted gradient backgrounds, slightly grainy broadcast look.

**53. Flat vector comedy** (`flat-vector-comedy`)
Modern flat-vector adult cartoon look: clean uniform outlines, simple geometric shapes, solid color fills with no shading, deadpan staging, static wide shots with minimal motion, bright flat palette.

**54. Ligne claire comic** (`ligne-claire`)
European ligne-claire comic look: clean even-weight outlines, flat bright colors without hatching, meticulously detailed backgrounds, simple expressive faces, no texture or grain.

**55. Black ink wash** (`sumi-e-ink`)
Black ink wash drawing in the manner of East Asian sumi-e: brush strokes on rough paper, grey gradients, negative space as fog, a single red seal-colored accent, minimal detail, slow drifting motion.

## 3D animation and craft

**56. Pixar-style 3D** (`pixar-3d`)
Polished 3D animation in the style of modern Pixar films: soft global illumination, rounded expressive characters, subsurface skin and fabric detail, saturated warm color, shallow depth of field, clean cinematic camera moves.

**57. Stylized glossy CGI** (`stylized-cgi`)
Glossy stylized CGI render: smooth plastic-like surfaces, slightly exaggerated proportions, saturated colors with strong rim light, soft studio-style shadows, simplified shapes and textures, floaty animation, clean video-game-trailer look.

**58. Low-poly 3D** (`low-poly`)
Stylized low-poly 3D look: flat-shaded faceted geometry, bold unlit color planes, simple gradient backgrounds, minimal textures, soft ambient occlusion, toy-like diorama compositions.

**59. PS1 retro 3D** (`ps1-retro-3d`)
Early-PlayStation 3D look: chunky low-polygon models, wobbling vertices, affine-warped low-resolution textures, dithered shading, fog-limited draw distance, limited color palette, stiff jointed animation.

**60. Cel-shaded 3D** (`cel-shaded-3d`)
Cel-shaded 3D animation look: hard two-tone shadow edges, bold ink outlines around 3D models, flat color textures, hand-painted-looking backgrounds, anime-style poses rendered on a moving 3D camera.

**61. Comic-book 3D** (`spiderverse-comic-3d`)
Comic-book-style 3D animation look: halftone dot shading and ink hatching on 3D models, offset color-print misregistration, animated on twos, bold graffiti-like color fields, dynamic comic camera angles.

**62. AAA game cinematic** (`game-cinematic`)
High-end video-game cinematic look: photoreal CG with dramatic volumetric lighting, detailed skin and material rendering, slow motion, anamorphic lens flares, particle-filled air, heavily graded teal and orange.

**63. Voxel block world** (`voxel-blocks`)
Voxel block look: everything built from cubic blocks, bright flat-lit colors, soft pixel-like textures, simple blocky animation, isometric-ish camera angles, sunny cheerful light.

**64. Stop-motion puppets** (`stop-motion-puppets`)
Stop-motion animation with handmade puppets: visible fabric weave and thumbprints in clay, slightly jittery 12 fps movement, miniature-scale sets with practical lights, shallow macro depth of field, muted handmade colors.

**65. Claymation** (`claymation`)
Plasticine claymation look: soft rounded forms with fingerprint marks, exaggerated squash and stretch, saturated candy colors, miniature-scale sets, slightly uneven studio lighting.

**66. Papercut theatre** (`papercut-theatre`)
Layered paper-cutout animation: flat cut shapes with visible paper fibers and torn edges, parallax layers lit from behind, soft cast shadows between layers, limited earthy palette, puppet-theatre staging.

**67. Felt hand puppets** (`felt-puppets`)
Felt hand-puppet show: fuzzy fabric characters with big button eyes, visible stitching, simple handmade cardboard sets, bright primary colors, slightly bouncy puppeteer movement, soft even studio light.

**68. Tilt-shift miniature** (`tilt-shift-miniature`)
Tilt-shift miniature look: scenes shot to look like tiny scale models, extreme shallow focus band, oversaturated toy-like color, high overhead angles, speeded-up time-lapse motion.

## Painted, drawn and printed

**69. Dark gothic oil painting** (`gothic-oil`)
Dark gothic oil painting in the manner of Caravaggio: heavy chiaroscuro, candlelight only, visible brush strokes and craquelure, deep oxblood and umber tones, pale highlights against black.

**70. Medieval woodcut** (`medieval-woodcut`)
Melancholic medieval woodcut look: bold carved black lines, hatched shading, desaturated grey-brown paper with a single blood-red accent, flat stacked perspective, ornamental borders.

**71. Watercolor storybook** (`watercolor-storybook`)
Soft watercolor storybook illustration: wet-on-wet washes bleeding into paper texture, loose ink outlines, pastel palette with warm highlights, gentle vignette edges.

**72. Art deco poster** (`art-deco-poster`)
Art deco travel-poster style: flat gouache color fields, sharp geometric shapes, gold and deep-teal palette, strong symmetrical compositions, elegant poster composition.

**73. Retro synthwave** (`synthwave`)
Retro synthwave illustration: neon pink and cyan gradients, wireframe grid lines, chrome reflections, scanlines and chromatic glow, dark purple tones, airbrushed 1980s sci-fi look.

**74. Impressionist painting** (`impressionist`)
Impressionist oil painting: short visible dabs of broken color, shimmering light, soft undefined edges, pastel haze, blurred motion.

**75. Ukiyo-e woodblock** (`ukiyo-e`)
Japanese ukiyo-e woodblock print: flat color areas with bold black outlines, visible wood grain, indigo and vermilion palette, flattened perspective, cream paper.

**76. Pop art** (`pop-art`)
Pop-art silkscreen look: flat bold primary colors, thick black outlines, Ben-Day dot halftones, high-contrast repeated panels, glossy magazine-cutout energy, loud yellows, reds and blues.

**77. Constructivist propaganda poster** (`constructivist-poster`)
Constructivist propaganda poster look: bold diagonal compositions, flat red, black and cream shapes, heavy angular blocks, heroic low-angle framing, rough printed paper texture, strict geometric graphic design.

**78. Linocut print** (`linocut-print`)
Two- and three-color linocut print: chunky carved black shapes, rough ink coverage with gaps, flat color overlays slightly off-register, simplified forms, bold graphic shapes on cream paper.

**79. Risograph print** (`risograph`)
Risograph print look: limited overprinting inks (fluorescent pink, teal, yellow), grainy halftone texture, slight misregistration, flat shapes, soft paper tooth, indie zine illustration energy.

**80. Charcoal and pencil sketch** (`charcoal-sketch`)
Charcoal and graphite sketch: smudged soft blacks, visible hatching strokes and eraser highlights, loose construction lines left in, white paper tone, rough unfinished edges, slightly trembling line-boil animation.

**81. Art nouveau** (`art-nouveau`)
Art nouveau illustration in the manner of Mucha: flowing whiplash lines, ornamental floral borders, pale muted gold, sage and rose palette, flat decorative areas with fine outlines, halo-like circular framing.

**82. Scandinavian folk-tale painting** (`nordic-folk-art`)
Scandinavian folk-tale gouache painting: muted earth and mossy greens, soft diffused light, flat storybook shapes, textured paper, visible brush strokes.

**83. Baroque opulence** (`baroque-opulence`)
Baroque look: strong chiaroscuro contrast, rich velvet reds and gilded gold, dramatic theatrical lighting, sweeping asymmetric compositions.

**84. Stained glass** (`stained-glass`)
Stained-glass window look: flat jewel-toned color panes divided by thick black lead lines, light glowing through from behind, rigid flattened poses, ornate gothic tracery.

**85. Vintage tarot card** (`tarot-card`)
Vintage tarot-card illustration look: ornate decorative border, flat fills and fine ink lines, faded cream paper, muted red, gold and teal, slightly worn print.

**86. Pulp paperback cover** (`pulp-paperback`)
1950s pulp paperback cover painting look: saturated gouache with dramatic hard lighting, lurid reds and yellows, strong menacing shadows, rough print texture, slightly faded cover wear.

## Found media and experiments

**87. Super 8 home movie** (`super8-home-movie`)
Super 8 home-movie footage look: warm faded color with light leaks and burnt-edge flashes, soft focus and heavy grain, shaky amateur framing, gate weave and dust, golden light.

**88. VHS camcorder** (`vhs-camcorder`)
1990s VHS camcorder footage look: smeared colors, tracking glitches and horizontal noise bands, low resolution, overexposed highlights, cheap handheld pans, bleeding red channels.

**89. Double-exposure dream** (`double-exposure-dream`)
Dreamlike double-exposure imagery: subjects dissolving into each other, translucent overlays, soft glowing edges, desaturated blues and golds, slow fades.

**90. Monochrome with one red accent** (`monochrome-red-accent`)
High-contrast black-and-white cinematography with a single saturated red accent, everything else in grey tones, deep blacks, grainy film stock, graphic composition.

**91. Shadow-puppet theatre** (`shadow-puppet-theatre`)
Shadow-puppet theatre look: flat black cut-out silhouettes with jointed limbs against a glowing translucent screen, warm amber backlight, hand-cut ornate detail, stage-curtain framing.

**92. Cyanotype blueprint** (`cyanotype-blueprint`)
Cyanotype print look: everything in deep Prussian blue and white, soft chalky tones, visible brush edges on the paper, delicate fine detail, slow dreamy movement.

**93. 60s psychedelia** (`psychedelic-60s`)
1960s psychedelic visuals: kaleidoscopic mirrored patterns, melting liquid-light projection, saturated orange, magenta and electric blue, flowing paisley textures, trippy slow zooms.

**94. Intimate unplugged stage** (`unplugged-stage`)
Intimate unplugged stage film look: warm stage lighting, soft bokeh from small lights, close handheld framing, shallow depth of field, warm amber and deep blue.

## Adding your own constraints

A style line can also carry story-specific rules, just like the examples in `projects/*/input/style.txt`:

- a recurring visual motif ("a door with chipped paint appears in every location")
- a palette rule ("only color is the red of the poppies")
- a cast rule ("the four band members must stay visually distinct in every scene")
