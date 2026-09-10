# Design exports

Drop the Figma frame exports here as **PNG @2x**.

## How to export

1. Open the Figma file **Eskista MarketPlace — App Design**.
2. Select the frames (shift-click, or select all 24 at once).
3. In the right-hand **Export** panel: `+` → **2x** → **PNG**.
4. Export and save the files into this folder.

## Naming

Anything readable is fine — Figma's default frame names work well. If a screen's role
isn't obvious from its name, a prefix helps, e.g.:

```
admin-bookings-list.png
vendor-add-equipment.png
customer-booking-detail.png
```

## Why @2x

Two of the four screens pulled over the MCP came back clamped to ~255px wide, which made
fine text (status chips, table headers, form labels) unreadable. The tall admin screens are
the ones most likely to carry the status vocabulary and field names that drive the data
model, so resolution matters more than usual here.

## Coverage

24 frames were shared. Four were captured before the Figma seat quota was hit:

- role chooser (Customer / Vendor)
- renter onboarding / splash
- customer home
- customer explore grid

The remaining 20 are still needed — in particular any **admin** screens, since the booking
status vocabulary and the "Assign equipment" flow are the biggest open modeling questions.
See `../docs/DOMAIN-ANALYSIS.md`.
