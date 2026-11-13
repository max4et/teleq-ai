---
description: Show something on the TV with TeleQ (text, a picture, a page or a video)
argument-hint: what to show, e.g. "tonight's shopping list" or a link
---

Show this on the TV with the TeleQ tools: $ARGUMENTS

Follow the teleq-tv skill. Call tv_status first and don't interrupt a video someone is watching (use notify
for a heads-up instead). Pick the simplest fitting tool: show_text for short text, show_image / show_queue
for public https pictures, play_video for a video link, show_html for anything visual. Design for a 10-foot
screen, then check it with screen_snapshot and fix what doesn't fit. Tell me the id you got back.
