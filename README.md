# go.omada.ai VSL funnel

A two-page static funnel served from GitHub Pages at `go.omada.ai`, built so Meta can see every step on one domain.

| Page | Path | What's on it | Meta events | GA4 events |
|---|---|---|---|---|
| Landing | `/` | VSL video, HubSpot application form, testimonials | `PageView`, `ViewContent` (watched 50% with sound), `SubmitApplication` (form sent) | `page_view`, `vsl_sound_on`, `vsl_50_percent`, `application_submitted` |
| Booking | `/book/` | Google Calendar booking widget (qualified applicants only) | `PageView`, **`Lead`** (once per session, value $100) | `page_view`, `generate_lead` |

`Lead` is the conversion to optimise the ad set for. `SubmitApplication` fires for every application, qualified or not, and is there as a higher-volume fallback signal if `Lead` volume is too low for Meta to exit learning.

Pixel: Omada Pixel `1616636385675883`. Analytics: GA4 `G-FYKCBREVF8`, the same property as omada.ai (filter by hostname `go.omada.ai`). HubSpot portal `49721108`, form `2097a9d1-3d8d-4486-ba3b-6f992c213fc7`.

## Preview locally

```bash
python3 -m http.server 8765 --directory go-funnel
```

Visits from `localhost` send real `PageView`s to the pixel. Opening `/book/` sends a real `Lead`, so avoid that or set `sessionStorage.omada_lead = '1'` first.

## Go-live checklist

1. **GitHub Pages.** Hosted for now from the public repo `Adam-Henshall/go-funnel` (deploys from `main`, root folder) with the custom domain `go.omada.ai` already set (the `CNAME` file). To be transferred to the `omada-ai` org later. Tick *Enforce HTTPS* once GitHub has issued the certificate, which happens after the DNS change.
2. **DNS (GoDaddy).** `go.omada.ai` currently points to GoHighLevel (`sites.ludicrous.cloud`). Change the `go` CNAME record to `<repo-owner>.github.io` (`adam-henshall.github.io` now, `omada-ai.github.io` after the transfer). The old GoHighLevel page goes offline as soon as this propagates. With the ads paused during cutover, this and the HubSpot step can happen in either order.
3. **HubSpot form redirect.** In the form's settings, change the qualified redirect from `https://omada.ai/bookvsl` to `https://go.omada.ai/book/`. If other pages embed this same form, clone it for the funnel and swap the new form ID into `index.html`.
4. **Meta Events Manager.**
   - Settings → Traffic permissions: make sure `go.omada.ai` (or `omada.ai`) is on the allow list.
   - Remove the old `Lead` trigger made with the event setup tool ("URL equals https://omada.ai/bookvsl") so `Lead` only comes from this funnel.
   - Test events: go through the funnel once and confirm `PageView` → `SubmitApplication` → `Lead`.
5. **Ads Manager.** Ad destination URL → `https://go.omada.ai/`. Ad set conversion event → Website, Omada Pixel, `Lead`.

## Still depends on outside services

- The VSL streams from Mux (environment "Omada VSL", asset "Omada VSL (Borderless Edit)", playback ID `B6wCWdU52bf9PobJmOP1Jv55nSXGcK5u5FBnGuwg9jM`), capped at 1080p to keep delivery costs down. The poster is Mux's frame at 10s. To swap the video, upload a new asset with a public playback policy and replace the ID in `index.html` (both `data-src` and `poster`).
- The calendar header says "15-minute slot", but the Google appointment schedule is set to 30-minute appointments. One of them needs updating.
