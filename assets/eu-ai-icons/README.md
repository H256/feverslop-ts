# EU icons for labelling AI-generated content

The icons of the European Commission's Code of Practice on marking and labelling AI-generated content (Section 2, the
deployers' labelling of deep fakes under Article 50(4) of the AI Act), as `bun run label` puts them over a finished video.

- Source: https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content
  (the PNG package, https://ec.europa.eu/newsroom/dae/redirection/document/129547, of 12 June 2026)
- Licence, in the Commission's words: "These icons are made publicly available for everyone to use freely, without the need
  for attribution to the Commission or the AI Office."
- Using them is optional. The labelling duty of Article 50 is not. Using them does not mean that the code was signed.

What was changed: each icon is cut to its visible part (the transparent margin of the original is gone, so the size of a
marker is the size of what is seen) and scaled to 200 pixels high. Nothing else.

| File | Icon | Variant |
|---|---|---|
| `generated-*.png` | "AI GENERATED": the content is fully AI-generated | |
| `modified-*.png` | "AI MODIFIED": human-made content, partly changed by AI | |
| `basic-*.png` | "AI": AI was involved, or next to a text label of one's own | |
| `*-white.png` / `*-black.png` | | opaque |
| `*-white50.png` / `*-black50.png` | | 50 % transparent |

The name without `.png` (`generated-white`, `basic-black50`, ...) is what `--marker=` takes; any other PNG is given by its path.
