# Paywall Layout and Ad-Free Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the existing Colorack RevenueCat paywall so Light and Standard are displayed as two vertical rows and both explicitly advertise ad-free access in Japanese and English.

**Architecture:** Keep the existing `default` Offering, package identifiers, entitlements, prices, and `RevenueCatUI.presentPaywall()` integration unchanged. Apply the visual and copy changes in RevenueCat's remotely served Components-based Paywall, publish that paywall, then verify it through the existing TestFlight build.

**Tech Stack:** RevenueCat Paywall Editor, RevenueCat Components-based Paywall, React Native RevenueCat UI SDK 10.4.2, Apple TestFlight Sandbox.

## Global Constraints

- Light remains `light_monthly`; Standard remains `standard_monthly`.
- Do not change prices, product IDs, Offering identifiers, entitlements, API keys, or subscription code.
- Keep restore purchases, terms, and privacy controls visible and functional.
- Use the existing Japanese and English localizations.
- No TestFlight rebuild is required for a published remote paywall change.
- Currency is validated separately through the Sandbox Apple Account storefront; it is not changed in the paywall editor.

---

### Task 1: Convert the package selector to a vertical layout

**Files:**
- External: RevenueCat Dashboard → Colorack project → Product catalog → Paywalls → existing Components-based Paywall attached to the `default` Offering.
- Reference: `docs/superpowers/specs/2026-08-11-paywall-layout-copy-design.md`

**Interfaces:**
- Consumes: The current paywall's existing Light and Standard package components.
- Produces: The same two package components arranged vertically, with the current selection and purchase action unchanged.

- [ ] **Step 1: Open the existing paywall editor**

  Open the `default` Offering, choose the existing Components-based Paywall editor, and confirm that the package components still reference `light_monthly` and `standard_monthly` before editing.

- [ ] **Step 2: Change the parent layout axis**

  Select the Stack or package-selector parent that contains both package cards and set its layout `Axis` to `Vertical`. Keep the child width at fill/available width and retain the existing spacing, selection styling, and recommended badge.

- [ ] **Step 3: Preview both phone orientations**

  Use the editor's phone preview to confirm that each card occupies its own row, the purchase CTA remains reachable, and the restore, terms, and privacy links are not clipped.

- [ ] **Step 4: Save as a draft**

  Save the layout as a draft only; do not publish until Task 2 copy and localization checks pass.

### Task 2: Add explicit ad-free copy in Japanese and English

**Files:**
- External: The same RevenueCat Paywall Editor text and package-description components.

**Interfaces:**
- Consumes: The vertical package layout from Task 1.
- Produces: Localized copy that clearly distinguishes the ad-free benefit and backup scope for each plan.

- [ ] **Step 1: Add the shared Japanese message**

  Add a Text component above the package selector with exactly: `どちらのプランでも広告が非表示になります。`

- [ ] **Step 2: Add Japanese package descriptions**

  Set the Light package description to `広告非表示＋塗料・キットデータのバックアップ` and the Standard package description to `広告非表示＋塗料・キットデータ＋キット写真のバックアップ`.

- [ ] **Step 3: Add English localization**

  Add the English shared message `Ad-free with both plans.` and set the package descriptions to `Ad-free + paint and kit data backup` and `Ad-free + paint, kit data, and kit photo backup` respectively.

- [ ] **Step 4: Save the localized draft and inspect text wrapping**

  Save the draft and preview Japanese and English on a phone-sized canvas. Confirm that no copy is clipped and that the Standard recommended badge does not obscure the plan name or price.

### Task 3: Publish and verify remote paywall delivery

**Files:**
- External: RevenueCat Paywall Editor and Offering detail page.

**Interfaces:**
- Consumes: The reviewed draft from Tasks 1–2.
- Produces: A published paywall served by the existing `default` Offering.

- [ ] **Step 1: Publish the paywall**

  Publish the reviewed draft. Confirm the paywall is Published/Active and remains attached to the `default` Offering.

- [ ] **Step 2: Reopen the Offering detail**

  Confirm the two package cards still map to `standard_monthly` and `light_monthly`; do not create a second Offering or change package IDs.

- [ ] **Step 3: Verify no product metadata regressions**

  Reopen RevenueCat Products and confirm both App Store products remain available with no `Missing Metadata` error. If either product is missing or the Offering is inactive, stop before TestFlight validation.

### Task 4: Test in TestFlight and verify currency separately

**Files:**
- External: Existing TestFlight build 19 and iPhone Sandbox settings.

**Interfaces:**
- Consumes: Published remote paywall from Task 3.
- Produces: A manual verification record for layout, copy, package selection, purchase, restore, and storefront currency.

- [ ] **Step 1: Refresh the paywall in TestFlight**

  Force-close and relaunch Colorack, open `プランを見る`, and confirm the vertical layout and Japanese ad-free copy. Switch the device/app language to English and repeat the copy check.

- [ ] **Step 2: Verify package selection**

  Tap Light and Standard in turn. Confirm only the selected package is highlighted and the CTA uses that package.

- [ ] **Step 3: Verify purchase and restore entry points**

  Use a Sandbox Apple Account to launch the purchase sheet, then verify the purchased entitlement, backup availability, and `購入を復元`. Do not use a production purchase for this test.

- [ ] **Step 4: Verify Japanese storefront currency**

  In App Store Connect, set the Sandbox tester's App Store Country or Region to Japan. On iPhone, sign out and back in under `設定 → デベロッパ → Sandboxアカウント`, relaunch TestFlight, and check whether prices appear in JPY. Apple notes that product metadata changes can take up to one hour to appear in Sandbox.

- [ ] **Step 5: Record remaining issues**

  Capture only UI/result screenshots and any purchase error text. Never share RevenueCat or App Store Connect keys.
