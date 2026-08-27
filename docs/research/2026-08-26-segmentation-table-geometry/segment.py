"""Text prompt -> table mask, per frame.

Backend `gdino_sam21` (default, fully open weights, no account):
  Grounding DINO base (Apache 2.0) turns "a table tennis table." into
  boxes; SAM 2.1 base-plus (Apache 2.0) turns the chosen box into a mask.

Backend `sam3` (wired, weights gated): Segment Anything 3 accepts the text
prompt directly. `facebook/sam3` on Hugging Face is behind a Meta access
request, so this path only works once that approval exists on this machine
(`hf auth login`). The class names are guarded so the file imports without
it.

Both run on CPU on purpose. The production keypoint detector documented
MPS SIGABRTs on this machine, and the research round put SAM-family MPS
at parity-or-slower with CPU here; CPU is also what the worker would use.

Box choice among candidates: the camera was set up to film one table, so
that table is the nearest and therefore the largest — the same rule the
production keypoint fitter uses between well-supported tables. Score
gates first (>= 0.30), then largest area wins. Every candidate is kept in
the record so the choice can be audited later.
"""

from __future__ import annotations

import os

import numpy as np

PROMPT = "a table tennis table."
GDINO_ID = "IDEA-Research/grounding-dino-base"
SAM2_ID = "facebook/sam2.1-hiera-base-plus"
SAM3_ID = "facebook/sam3"           # gated: Meta approval required
SAM3_LITE_ID = "yonigozlan/sam3-litetext-s0"   # ungated community conversion
BOX_SCORE_MIN = 0.30


class GroundedSam21:
    """Grounding DINO box -> SAM 2.1 mask. Loads once, runs many."""

    def __init__(self, device="cpu"):
        import torch
        from transformers import (AutoProcessor,
                                  GroundingDinoForObjectDetection,
                                  Sam2Model, Sam2Processor)
        self.torch = torch
        self.device = device
        self.gdino_proc = AutoProcessor.from_pretrained(GDINO_ID)
        self.gdino = GroundingDinoForObjectDetection.from_pretrained(
            GDINO_ID).eval().to(device)
        self.sam_proc = Sam2Processor.from_pretrained(SAM2_ID)
        self.sam = Sam2Model.from_pretrained(SAM2_ID).eval().to(device)

    def boxes(self, pil_image):
        inputs = self.gdino_proc(
            images=pil_image, text=PROMPT, return_tensors="pt").to(self.device)
        with self.torch.no_grad():
            out = self.gdino(**inputs)
        res = self.gdino_proc.post_process_grounded_object_detection(
            out, inputs.input_ids, threshold=BOX_SCORE_MIN,
            text_threshold=0.25, target_sizes=[pil_image.size[::-1]])[0]
        return [
            {"box": [float(v) for v in box.tolist()], "score": float(score)}
            for score, box in zip(res["scores"], res["boxes"])
        ]

    def _masks(self, inputs):
        """All three granularity masks for one prompt, with their scores."""
        with self.torch.no_grad():
            out = self.sam(**inputs, multimask_output=True)
        masks = self.sam_proc.post_process_masks(
            out.pred_masks.cpu(), inputs.original_sizes)[0][0]
        scores = out.iou_scores.flatten().tolist()
        return [((masks[i].numpy() > 0).astype(np.uint8) * 255,
                 float(scores[i])) for i in range(masks.shape[0])]

    def masks_from_box(self, pil_image, box):
        return self._masks(self.sam_proc(
            images=pil_image, input_boxes=[[box]],
            return_tensors="pt").to(self.device))

    def masks_from_points(self, pil_image, points):
        return self._masks(self.sam_proc(
            images=pil_image,
            input_points=[[[list(p) for p in points]]],
            input_labels=[[[1] * len(points)]],
            return_tensors="pt").to(self.device))

    @staticmethod
    def surface_points(whole_mask):
        """Two pixels confidently ON the playing surface, one per half.

        A table's halves are genuine parts (they fold at the net), so a
        single point prompt often returns HALF the tabletop — a clean quad
        of the wrong thing. Prompting with a point on each half forces the
        smallest region containing both: the full surface.

        The surface is the top of the table silhouette: its far edge IS
        the silhouette's top boundary, and it reaches down no further than
        roughly half of it. So by area counted from the top, ~3-10% is on
        the far half and ~20-35% on the near half, for any camera above
        the table — exactly the cameras calibration accepts. The far point
        is nudged toward the near one to step off the net tape when the
        net, not the far edge, is the top of the silhouette.
        """
        ys, xs = np.nonzero(whole_mask)
        order = np.argsort(ys)
        ys, xs = ys[order], xs[order]

        def band(lo_frac, hi_frac):
            lo, hi = int(lo_frac * len(ys)), int(hi_frac * len(ys))
            return (float(np.median(xs[lo:hi])),
                    float(np.median(ys[lo:hi])))

        near = band(0.20, 0.35)
        far = band(0.03, 0.10)
        far = (far[0] + 0.2 * (near[0] - far[0]),
               far[1] + 0.2 * (near[1] - far[1]))
        return near, far

    def segment(self, pil_image):
        """One frame -> (candidate masks, whole-table mask, record).

        SAM's three granularities for a table are roughly whole-furniture,
        table-top, and one-half-of-the-top. Which one is the playing
        surface is decided later by GEOMETRY (corners.select_surface), not
        here — the surface is the candidate whose boundary is actually a
        projective rectangle. This stage only produces the candidates.
        """
        boxes = self.boxes(pil_image)
        record = {"backend": "gdino_sam21", "boxes": boxes}
        if not boxes:
            record["reason"] = "no box for the prompt"
            return [], None, record
        areas = [(b["box"][2] - b["box"][0]) * (b["box"][3] - b["box"][1])
                 for b in boxes]
        pick = int(np.argmax(areas))
        record["picked_box"] = pick
        record["box_score"] = boxes[pick]["score"]

        box_masks = self.masks_from_box(pil_image, boxes[pick]["box"])
        whole = max(box_masks, key=lambda m: int((m[0] > 0).sum()))[0]
        candidates = [
            {"mask": m, "sam_iou": s, "prompt": f"box{i}"}
            for i, (m, s) in enumerate(box_masks)
        ]
        try:
            near, _ = self.surface_points(whole)
            record["near_point"] = [round(v, 1) for v in near]
            near_masks = self.masks_from_points(pil_image, [near])
            for i, (m, s) in enumerate(near_masks):
                candidates.append(
                    {"mask": m, "sam_iou": s, "prompt": f"near{i}"})

            # A single surface point usually returns HALF the tabletop —
            # the halves are genuine parts, folding at the net. The half's
            # own top edge says where the net is, so a point extended past
            # it lands on the far half; prompting there and taking the
            # union of the two halves rebuilds the full surface.
            far = far_point_from_half(near_masks, whole)
            if far is not None:
                record["far_point"] = [round(v, 1) for v in far]
                far_masks = self.masks_from_points(pil_image, [far])
                for i, (m, s) in enumerate(far_masks):
                    candidates.append(
                        {"mask": m, "sam_iou": s, "prompt": f"far{i}"})
                union = union_of_halves(near_masks, far_masks, whole)
                if union is not None:
                    candidates.append(
                        {"mask": union, "sam_iou": 0.0, "prompt": "union"})
                for i, (m, s) in enumerate(
                        self.masks_from_points(pil_image, [near, far])):
                    candidates.append(
                        {"mask": m, "sam_iou": s, "prompt": f"2pt{i}"})
        except Exception as err:                          # noqa: BLE001
            record["surface_point_error"] = str(err)
        return candidates, whole, record


class Sam3Text:
    """SAM 3 family, text prompt straight to instance masks.

    Default checkpoint is SAM3-LiteText s0 (`yonigozlan/sam3-litetext-s0`)
    because it is UNGATED — no Hugging Face account, no Meta approval.
    The full `facebook/sam3` is gated behind a manual Meta access request;
    pass it as checkpoint once that approval exists on this machine.

    Concept prompts replace the whole box-and-points dance: the model is
    asked for the playing surface BY NAME, and separately for the whole
    table as the silhouette reference.
    """

    SURFACE_PROMPTS = ("ping pong table surface",
                       "table tennis table top")
    WHOLE_PROMPT = "table tennis table"

    def __init__(self, device="cpu", checkpoint=SAM3_LITE_ID):
        import torch
        from transformers import AutoProcessor, Sam3LiteTextModel, Sam3Model
        self.torch = torch
        self.device = device
        self.proc = AutoProcessor.from_pretrained(checkpoint)
        cls = (Sam3LiteTextModel if "litetext" in checkpoint.lower()
               else Sam3Model)
        self.model = cls.from_pretrained(checkpoint).eval().to(device)

    def _instances(self, pil_image, prompt):
        inputs = self.proc(
            images=pil_image, text=prompt,
            return_tensors="pt").to(self.device)
        with self.torch.no_grad():
            out = self.model(**inputs)
        res = self.proc.post_process_instance_segmentation(
            out, threshold=0.4, mask_threshold=0.5,
            target_sizes=inputs.get("original_sizes").tolist())[0]
        return [(m.cpu().numpy().astype(np.uint8) * 255, float(s))
                for m, s in zip(res["masks"], res["scores"])]

    def segment(self, pil_image):
        """Same interface as GroundedSam21.segment: candidates to judge.

        The whole-table prompt picks the camera's own table by the same
        rule as production (largest instance = nearest); surface-prompt
        instances are kept only where they overlap it, so a neighbouring
        table's surface can never enter the candidate list.
        """
        record = {"backend": "sam3text"}
        whole_instances = self._instances(pil_image, self.WHOLE_PROMPT)
        record["whole_scores"] = [round(s, 3) for _, s in whole_instances]
        whole = None
        if whole_instances:
            whole = max(whole_instances,
                        key=lambda t: int((t[0] > 0).sum()))[0]
        candidates = []
        for i, (m, s) in enumerate(whole_instances):
            candidates.append({"mask": m, "sam_iou": s,
                               "prompt": f"whole{i}"})
        for prompt in self.SURFACE_PROMPTS:
            for i, (m, s) in enumerate(self._instances(pil_image, prompt)):
                if whole is not None:
                    inter = int(((m > 0) & (whole > 0)).sum())
                    if inter < 0.5 * int((m > 0).sum()):
                        continue
                candidates.append({"mask": m, "sam_iou": s,
                                   "prompt": f"{prompt.split()[-1]}{i}"})
        if not candidates:
            record["reason"] = "no instance for any prompt"
        return candidates, whole, record


ZOOM_PAD = 0.15


def zoom_pass(backend, pil_image, quad, anchors):
    """Re-segment inside a crop around the found table.

    SAM works at a fixed internal resolution, so a table filling 40% of
    the frame gets ~40% of the boundary detail it could have. Cropping to
    the quad (plus 15% margin) and re-prompting inside the crop roughly
    doubles the pixels the mask boundary is drawn with. The anchors carry
    over; the box prompt is the quad's own bounding box.
    """
    import cv2
    from PIL import Image
    w, h = pil_image.size
    qx0, qy0 = quad.min(axis=0)
    qx1, qy1 = quad.max(axis=0)
    pad_x, pad_y = ZOOM_PAD * (qx1 - qx0), ZOOM_PAD * (qy1 - qy0)
    x0, y0 = max(int(qx0 - pad_x), 0), max(int(qy0 - pad_y), 0)
    x1, y1 = min(int(qx1 + pad_x), w), min(int(qy1 + pad_y), h)
    if x1 - x0 < 64 or y1 - y0 < 64:
        return [], None, {"reason": "crop too small"}
    crop = pil_image.crop((x0, y0, x1, y1))
    off = np.array([x0, y0], dtype=np.float64)
    box = [qx0 - x0, qy0 - y0, qx1 - x0, qy1 - y0]
    shifted = [(a[0] - x0, a[1] - y0) for a in anchors if a is not None]

    def paste(mask_crop):
        full = np.zeros((h, w), dtype=np.uint8)
        full[y0:y1, x0:x1] = mask_crop[:y1 - y0, :x1 - x0]
        return full

    candidates = []
    if hasattr(backend, "masks_from_box"):
        box_masks = backend.masks_from_box(crop, box)
        whole = paste(max(box_masks,
                          key=lambda m: int((m[0] > 0).sum()))[0])
        for i, (m, s) in enumerate(box_masks):
            candidates.append({"mask": paste(m), "sam_iou": s,
                               "prompt": f"zbox{i}"})
        if len(shifted) == 2:
            for i, (m, s) in enumerate(
                    backend.masks_from_points(crop, shifted)):
                candidates.append({"mask": paste(m), "sam_iou": s,
                                   "prompt": f"z2pt{i}"})
    else:
        # text-prompt backends re-run their concept prompts on the crop
        crop_cands, crop_whole, _ = backend.segment(crop)
        whole = paste(crop_whole) if crop_whole is not None else None
        for c in crop_cands:
            candidates.append({"mask": paste(c["mask"]),
                               "sam_iou": c["sam_iou"],
                               "prompt": "z" + c["prompt"]})
    record = {"crop": [x0, y0, x1, y1]}
    return candidates, whole, record


def _best_half(masks, whole_px):
    """The cleanest quad-shaped mask that is plausibly HALF a tabletop."""
    import corners as C
    best = None
    for mask, _ in masks:
        px = int((mask > 0).sum())
        if not 0.15 * whole_px <= px <= 0.60 * whole_px:
            continue
        fit, _ = C.corners_from_mask(mask)
        if fit is None:
            continue
        quality = fit["edge_support"] * np.sqrt(fit["quad_iou"])
        if best is None or quality > best[2]:
            best = (mask, fit, quality)
    return best


def far_point_from_half(near_masks, whole_mask):
    """A point on the FAR half: inside the silhouette, not the near half.

    Subtracting the (dilated) near-half mask from the table silhouette
    leaves the far half, the legs and scraps. The far half is the topmost
    sizeable leftover — legs hang below the surface — and the distance
    transform's argmax is its most interior pixel, comfortably clear of
    the net tape and the mask boundary. No edge-identity reasoning, which
    failed on diagonal views where a sideline midpoint sits higher than
    the net's.
    """
    import cv2
    whole_px = int((whole_mask > 0).sum())
    best = _best_half(near_masks, whole_px)
    if best is None:
        return None
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    near_grown = cv2.dilate(best[0], kernel)
    residual = ((whole_mask > 0) & ~(near_grown > 0)).astype(np.uint8)
    n, labels, stats, cents = cv2.connectedComponentsWithStats(residual, 8)
    pick = None
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < 0.03 * whole_px:
            continue
        if pick is None or cents[i][1] < cents[pick][1]:
            pick = i
    if pick is None:
        return None
    region = (labels == pick).astype(np.uint8)
    dist = cv2.distanceTransform(region, cv2.DIST_L2, 5)
    y, x = np.unravel_index(int(np.argmax(dist)), dist.shape)
    return float(x), float(y)


def union_of_halves(near_masks, far_masks, whole_mask):
    """Best near half + best far mask, closed across the net seam."""
    import cv2
    whole_px = int((whole_mask > 0).sum())
    near = _best_half(near_masks, whole_px)
    if near is None:
        return None
    far = _best_half(far_masks, whole_px)
    if far is None:
        # the far prompt may return the full surface rather than a half;
        # in that case the union is just that mask and it is already a
        # candidate on its own
        return None
    union = np.maximum(near[0], far[0])
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    return cv2.morphologyEx(union, cv2.MORPH_CLOSE, kernel)


def make_backend(name, device="cpu"):
    if name == "gdino_sam21":
        return GroundedSam21(device)
    if name == "sam3lite":
        return Sam3Text(device)
    if name == "sam3":
        return Sam3Text(device, checkpoint=SAM3_ID)
    raise ValueError(f"unknown backend {name}")
