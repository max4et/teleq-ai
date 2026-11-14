---
name: teleq-tv
description: Use when the user wants something shown on their TV or big screen (TeleQ) - presentations, recipes, quizzes, scoreboards, dashboards, photos, video - or asks to present, put up, or check what the TV shows. How to pick TeleQ tools, design for a 10-foot screen, present with slides and verify with screen_snapshot.
---

<!-- Generated from tools/ai/skill.md by tools/ai/generate.mjs. Edit that file instead. -->
# Putting things on the TV with TeleQ

TeleQ turns the user's Android TV (or a browser tab at relay.teleq.online/screen) into a screen you can
use. The `teleq` MCP server gives you the tools; this guide is how to use them well.

## When to use the TV

- The user asks for it: "on the TV", "on the big screen", "show it to everyone", "present", "put up".
- Something is better seen from the couch by several people: a recipe while cooking, a presentation,
  a quiz, a scoreboard, a timer, photos, a video.
- Don't put things on the TV the user didn't ask for, and don't replace what is on screen without a
  reason. Call `tv_status` first when unsure: a video someone is watching (`state: playing`, shown by
  `phone`) is not yours to interrupt. Use `notify` for a heads-up instead.

## Pick the right tool

| Goal | Tool |
|---|---|
| Short readable text, a list, an answer | `show_text` (Markdown subset: `#` headings, `-` bullets, `1.` numbers, `**bold**`) |
| Presentation, recipe steps, quiz | `show_slides` (one idea per slide; speaker notes in `notes`), then `slides_control` |
| Dashboard, chart, scoreboard, timer, anything visual | `show_html` (self-contained, no network), then `update_html` with `data` |
| A picture or several | `show_image` / `show_queue` (public `https://` links only) |
| An episode, cartoon, film, music video or channel on YouTube, Rutube, VK Video, Kinopoisk, Netflix… | web search for the official link, then `open_in_app` |
| A direct video file or stream (`.mp4`, `.m3u8`, `.mpd`) | `play_video`, then `playback` |
| A heads-up over whatever is on | `notify` (≤200 characters, at most one every 10 s) |
| Check what is really on screen | `screen_snapshot` |
| Several TVs | `list_tvs`, then pass `tv` (name or id) to any tool |

Every `show_*` returns an `id`; `update_text`, `update_html` and `slides_control` use it.

## Find and play

When the user asks to "find and play" something (a cartoon episode, a film, a song, a channel):

1. `tv_status` → `language`, `country`, `services_installed`.
2. Search the web **in that language** (unless the user named another): the series name in that language,
   season and episode, plus the service, e.g. `Дикие Скричеры 1 сезон 1 серия смотреть официально` or
   `site:rutube.ru`, `site:youtube.com`, `site:vkvideo.ru`.
3. Pick an **official** source: the rights holder's channel on YouTube / Rutube / VK Video, or a streaming
   service available in that country. Prefer services in `services_installed`. Check the episode number
   and the language/dub in the title before opening it.
4. `open_in_app` with that link. The service's app takes over the screen; tell the user what you opened.
5. Free official upload not found? Open the series page on a service that has it (Kinopoisk, ivi, Okko,
   Netflix…) and say a subscription may be needed. Nothing official at all? Say so; suggest the official
   channel or a similar title.

Never use pirate sites or unofficial re-uploads, even if the user asks: TeleQ only opens the services it
knows, and this guide is about getting the right thing on screen legally. A direct `.mp4`/`.m3u8` link the
user gives you goes to `play_video`.

## Design for a 10-foot screen

- 16:9, design at 1920×1080. Dark background, light text, high contrast.
- Body text at least 28 px, headings 48 px or more. At most about 6 lines or 5 bullets per screen.
- Keep everything inside 5% margins (TV overscan; `tv_status` gives `safe_area`). Leave the top-right
  corner free: TeleQ shows a badge there with your name.
- No scrolling, no hover, no input fields, no tiny legends. Nobody has a mouse.
- HTML pages run in a sandbox without network: inline CSS, scripts, SVG and images (`data:` URIs), or
  use public `https://` images. Fonts: system fonts or inline `@font-face` with `data:`.
- For live values write the page once, keep the numbers in elements with ids, and listen:
  `window.addEventListener('message', e => { if (e.data?.type === 'teleq:update') render(e.data.data) })`.
  Then send `update_html` with `data`; the page does not reload or flicker.

## Check your work

After putting up something important (a slide deck, a dashboard), call `screen_snapshot` and look at
it: text cut off, overlapping, too small, empty areas? Fix it with `update_html`, `update_text` or by
showing it again, then check once more. Video frames come out black in snapshots; that is expected.
If the snapshot tool is refused, the owner switched "Sees the screen" off for you: don't ask again.

## Presenting

1. `show_slides` with a title slide first; keep what you would say in `notes`.
2. Check slide 1 with `screen_snapshot`.
3. Move with `slides_control` (`next`, `prev`, `goto`); the result gives you that slide's notes.
   The viewer can also use ←/→ on the remote; `tv_status` tells you which slide is on screen.

## Be a good guest

- The owner can press Back on the remote at any time; then the content is gone and updates fail with
  "no longer on the TV screen". Don't put it back unasked.
- If a tool says the TV runs an older TeleQ, tell the user to update TeleQ on the TV.
- If the TV is offline, say so: TeleQ has to be open on the TV.
