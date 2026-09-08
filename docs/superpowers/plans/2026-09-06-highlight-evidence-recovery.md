# Highlight evidence recovery implementation plan

1. Add failing selector tests for the crossing, alternating-landing, and corroborated-hit paths, the four-exchange rejection, ranking, and version-2 manifest.
2. Add failing evidence-builder tests for alternating table-side landings, optional hit counts, and rally-end derivation on end-on footage.
3. Implement version-2 evidence in `points_v2.py`, `points_pipeline.py`, and `highlights.py`; update worker fallbacks and render manifests.
4. Update web and iOS manifest contracts and add backward-compatible multi-user feature-gate parsing in both web and worker code.
5. Add an evidence-only historical rebuild with diagnostics/raw/cut tiers, dry-run/canary controls, and preservation assertions.
6. Run focused worker/web/iOS tests, the full worker suite appropriate to changed modules, and `npm run build`.
7. Review the diff for contract drift and unsafe data mutation, then commit the verified change on `codex/quality-first-highlights-production`.
