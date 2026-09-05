# Beta Allowances Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Disable storage and minute purchases during beta without disabling usage limits, and let players request increases that either administrator can grant.

**Architecture:** Keep commerce metering enabled. Add a separate purchases_enabled switch, enforced when the shared purchase RPC creates a purchase. Reuse quota_requests with a resource discriminator, an atomic request/grant workflow, admin notifications and retryable email delivery. Web and native Account screens offer the same requests.

**Tech Stack:** Next.js, Supabase/Postgres, SwiftUI, existing transactional email renderer.

**Spec:** Adil's request in this task, 2026-09-05.

## Constraints

- Preserve all payment code and existing balances.
- Existing and new players remain limited by storage and processing allowances.
- Both administrators can review requests and select a player by name.
- Authenticated callers cannot grant themselves allowances or impersonate requesters.
- No production emails or grants during verification.
- Verify desktop, mobile web at 393×660, database behavior, full Next build and iOS simulator build.

## Tasks

- [x] Database: add purchases_enabled=false; leave commerce_enabled=true; extend quota_requests with resource and email delivery state. Add admin-only searchable player lookup and atomic grant/decision RPC. Send in-app notifications to both admin identities and the player. Serialize per-user requests and decisions; enforce one pending request per resource and rate-limit repeat requests.
- [x] Purchase controls: show a separate Purchases switch in Commerce. Use fresh configuration for purchase-facing web and iOS surfaces. Shared purchase creation must reject new minute/storage purchases when disabled, including direct API calls. Preserve fulfillment of already-paid transactions.
- [x] Requests: add a shared web request form to Account, and native request sheet on iOS. Show pending state, optional message and actionable quota copy. Link exhausted upload/processing states to Account.
- [x] Admin: replace email entry with searchable player selection, show allowances, and grant positive increases by user ID. Present requests with their player already selected and an atomic grant or decline action.
- [x] Delivery: notify both admins using the shared email renderer; persist per-recipient delivery outcomes and retry failures in the existing email sweep. Keep in-app requests available regardless of email outcome.
- [x] Verification: run commerce/email tests, isolated SQL integration tests for purchase gating, concurrent-safe decisions, permission boundaries and request deduplication; run npm run build and xcodebuild; visually check responsive web pages.

## Findings

Production currently has commerce_enabled=true and iap_enabled=off. The existing Commerce toggle also disables metering, so it cannot serve as the beta purchase toggle. Default allowances are 250 processing minutes and 10 GB. Storage requests exist in the database and admin portal but Account no longer exposes their submission UI. Minute requests do not exist.
