# Design system of the workspace

The workspace's tokens live in `:root` of `client/src/styles/workspace.css`. A stylesheet or a component's `<style>` uses them and no literal values: `client/tests/unit/design-tokens.test.ts` fails on a literal gap, radius or font size. Padding and margin are not checked yet. For them, prefer a step of the space scale too.

## Scales

| Token | Value | For |
| --- | --- | --- |
| `--space-half` | 2 px | between parts of one thing: a crumb and its arrow |
| `--space-1` | 4 px | inside a control, between tags |
| `--space-2` | 8 px | between buttons in a row, between the fields of a group |
| `--space-3` | 12 px | between the parts of a card |
| `--space-4` | 16 px | between cards |
| `--space-5` | 20 px | between the sections of a page |
| `--space-6` | 24 px | around a page |
| `--radius-s` | 4 px | tags, small marks, timeline bars |
| `--radius-m` | 8 px | buttons, fields, cards, dialogs |
| `--radius-pill` | 99 px | chips and pills |
| `--radius-round` | 50 % | dots and round badges |
| `--text-xxs` | 9 px | a letter in a 14 px badge, nowhere else |
| `--text-xs` | 11 px | labels on the timeline, captions |
| `--text-s` | 12 px | notes, secondary text, small buttons |
| `--text-m` | 13 px | body text, the page's default |
| `--text-l` | 15 px | headings of a page or a dialog |

## What a colour means

| Token | Means | Not for |
| --- | --- | --- |
| `--accent` (blue) | the main action of a page (`.btn.primary`), the current tab, focus, a selected item | links, warnings |
| `--plan` (violet) | a button that asks the language model | |
| `--finish` (teal) | a button that finishes the video for publishing | |
| `--danger` (red) | something that removes or stops (`.btn.danger`: Remove, Stop), a failure | a main action |
| `--stale` (amber) | made from an older state, needs doing again | |
| `--ok` (green) | done, reachable | |
| `--text`, underlined | a link (`.link`, a `RouterLink` in text) | |

A disabled button is grey in every variant: `--raised` background, `--muted` text. A faded primary or danger button is never shown.

## Buttons

| Class | Use |
| --- | --- |
| `.btn` | any action |
| `.btn.primary` | the one main action of a page or a dialog |
| `.btn.danger` | removes or stops something |
| `.btn.mini` | small actions inside a row or a note: Use the default, Undo |
| `.link` | a button that reads as a link: an id that jumps somewhere |

Shared components (`Card`, `Tabs`, `Tag`, `Callout`, `FormRow`, `SplitLayout`) and one stylesheet per component follow page by page (#838).
