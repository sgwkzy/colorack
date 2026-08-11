# Paywall layout and ad-free messaging design

## Goal

Make the Colorack subscription choices easier to compare on a phone by placing the two plans in a vertical list and explicitly stating that both plans remove advertisements.

## Scope

- Update the existing RevenueCat Components-based Paywall attached to the default Offering.
- Change the parent package layout from horizontal to vertical so Light and Standard render as two full-width rows.
- Keep the current plan capabilities and product identifiers unchanged:
  - Light: `light_monthly`
  - Standard: `standard_monthly`
- Add localized Japanese and English copy for the shared ad-free benefit and each plan description.
- Do not change prices, product IDs, entitlements, or application code.

## Copy

Japanese:

- Shared message: `どちらのプランでも広告が非表示になります。`
- Light: `広告非表示＋塗料・キットデータのバックアップ`
- Standard: `広告非表示＋塗料・キットデータ＋キット写真のバックアップ`

English:

- Shared message: `Ad-free with both plans.`
- Light: `Ad-free + paint and kit data backup`
- Standard: `Ad-free + paint, kit data, and kit photo backup`

## Behavior and validation

- The selected package remains visually distinct and the purchase button continues to purchase the selected package.
- The existing restore, terms, and privacy controls remain available.
- Publish the paywall after saving; no TestFlight rebuild is required for this remote paywall change.
- Verify both locales, vertical layout, package selection, purchase-sheet launch, and restore-purchases behavior in TestFlight.

## Out of scope

- Changing App Store Connect pricing or product metadata.
- Changing the RevenueCat API key, Offering identifier, entitlement identifiers, or subscription logic.
- Treating the dollar currency as a paywall-copy issue; currency is determined by the Apple/Sandbox storefront and will be checked separately.
