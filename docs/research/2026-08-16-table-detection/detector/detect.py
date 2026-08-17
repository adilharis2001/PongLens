"""End to end: a frame in, four table corners out.

Two stages. The network from Uplifting Table Tennis predicts thirteen table
keypoints as heatmaps; the fitter in fit.py reads several peaks per channel and
looks for the set that agrees on one 2.740 x 1.525 m table. Everything the
detector needs to decide is in this file and fit.py; nothing consults the
ground truth.
"""
import argparse
import json
import os
import sys
import time

import cv2
import einops as eo
import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault('TORCH_HOME', os.path.join(HERE, 'torchhub'))
sys.path.insert(0, HERE)

import fit as F  # noqa: E402
import load_model as L  # noqa: E402

CANVAS = (1920, 1080)
MIRROR = [1, 0, 3, 2, 5, 4, 7, 6, 8, 10, 9, 11, 12]


class TableCornerDetector:
    def __init__(self, model_name='segformerpp_b0', device='cpu', tta=False, **fit_kw):
        self.model, self.transform, self.resolution, self.device = \
            L.load_table_model(model_name, device=torch.device(device))
        self.tta = tta
        self.fit_kw = fit_kw

    def _heatmap(self, rgb):
        data = self.transform({'image': rgb})
        el = eo.rearrange(data['image'], 'h w c -> c h w').astype(np.float32)
        x = torch.tensor(el).unsqueeze(0).to(self.device)
        with torch.no_grad():
            pred = self.model(x)
        if self.device.type == 'mps':
            torch.mps.synchronize()
        return pred[0].float().cpu().numpy()

    def __call__(self, bgr):
        """bgr: an OpenCV image. Returns corners in that image's pixels."""
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        hm = self._heatmap(rgb)
        if self.tta:
            hm2 = self._heatmap(rgb[:, ::-1].copy())[:, :, ::-1][MIRROR]
            hm = (hm + hm2) / 2
        r = F.fit_table(hm, canvas=CANVAS, **self.fit_kw)
        if r is None:
            return None
        h, w = bgr.shape[:2]
        sx, sy = w / CANVAS[0], h / CANVAS[1]
        r['corners'] = [[x * sx, y * sy] for x, y in r['quad']]
        return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default='segformerpp_b0')
    ap.add_argument('--device', default='cpu')
    ap.add_argument('--tta', action='store_true')
    ap.add_argument('--repeat', type=int, default=1, help='stability soak')
    ap.add_argument('--out', default=None)
    args = ap.parse_args()

    corpus = os.path.join(os.path.dirname(HERE), 'detector')
    rows = json.load(open(os.path.join(corpus, 'rows.json')))
    det = TableCornerDetector(args.model, args.device, tta=args.tta)

    out, times = [], []
    for rep in range(args.repeat):
        for row in rows:
            p = os.path.join(corpus, 'frames', f"{row['match_id']}.jpg")
            img = cv2.imread(p)
            if img is None:
                continue
            t0 = time.perf_counter()
            r = det(img)
            times.append(time.perf_counter() - t0)
            if rep == 0:
                out.append({'match_id': row['match_id'], 'venue': row.get('venue'),
                            'corners_frame': None if r is None else r['corners'],
                            'corners_source': None if r is None else
                            [[x * row['source_width'] / CANVAS[0],
                              y * row['source_height'] / CANVAS[1]] for x, y in r['quad']],
                            'inliers': None if r is None else r['inliers'],
                            'weight': None if r is None else r['weight'],
                            'n_tables': None if r is None else r['n_tables']})
        print(f'  pass {rep + 1}/{args.repeat} ok', flush=True)

    t = np.array(times)
    print(f'{len(t)} inferences on {det.device}, tta={args.tta}: '
          f'median {t.mean() and np.median(t):.3f}s  mean {t.mean():.3f}s  max {t.max():.3f}s')
    refusals = sum(1 for o in out if o['corners_frame'] is None)
    print(f'refusals: {refusals}/{len(out)}')
    if args.out:
        json.dump({'model': args.model, 'device': str(det.device), 'tta': args.tta,
                   'median_s': float(np.median(t)), 'results': out},
                  open(os.path.join(HERE, args.out), 'w'), indent=1)


if __name__ == '__main__':
    main()
