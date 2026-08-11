# Putting registration on the Sandbox WordPress site

## Recommended: a normal WordPress button

Use a standard WordPress **Buttons** block with the label **Create your Sandbox account** and link it to the public `/join` URL. Set the link to open in a new tab.

This is the most reliable option under IT controls, works well on phones, and gives the form the full screen it needs. The button can sit beneath a short first-visit explanation or beside a QR code.

The current owner-only staging destination is:

`https://scripps-sandbox-check-in.rjatplay.chatgpt.site/join`

Replace that address with the approved public hostname before the page is promoted to visitors.

## If the classic 4:3 iframe is allowed

Embed the purpose-built `/join/embed` route rather than the full form. It is a concise 4:3 entry card; its button opens the complete registration form in a new tab.

```html
<iframe
  src="https://YOUR-PUBLIC-JOIN-HOST/join/embed"
  title="Create a Scripps Sandbox Makerspace account"
  width="600"
  height="450"
  loading="lazy"
  style="border:0; width:100%; aspect-ratio:4/3;"
></iframe>
```

The current staging route is:

`https://scripps-sandbox-check-in.rjatplay.chatgpt.site/join/embed`

Because staging is owner-only, it is for private review rather than a public WordPress page. The final host must also permit framing; confirm this on the real WordPress page before launch.

## If IT allows responsive Custom HTML

The same iframe can use a wrapper that preserves 4:3 without a fixed pixel size:

```html
<div style="width:100%; max-width:960px; margin:0 auto; aspect-ratio:4/3;">
  <iframe
    src="https://YOUR-PUBLIC-JOIN-HOST/join/embed"
    title="Create a Scripps Sandbox Makerspace account"
    loading="lazy"
    style="display:block; width:100%; height:100%; border:0;"
  ></iframe>
</div>
```

WordPress can strip iframe markup from Custom HTML when the editor account lacks the `unfiltered_html` capability. If that happens, use the ordinary Button block instead of seeking a plugin or IT exception solely for this form.

## Suggested page copy

**First visit?** Create your Sandbox account and complete the liability waiver before you arrive. When you get here, connect your UC San Diego ID with one tap.

Button label: **Create your Sandbox account**
