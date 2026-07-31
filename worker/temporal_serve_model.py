"""Paired-player temporal model for blinded serve-motion detection.

The model emits a near/far serve score for every sampled frame.  Match truth is
used only by :func:`multiple_instance_loss`; it is never part of the feature
record or inference path.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import torch
from torch import Tensor, nn
from torch.nn import functional as F


class PairedServeGRU(nn.Module):
    """Compact bidirectional GRU over synchronized near/far player features."""

    def __init__(
        self,
        feature_width: int,
        *,
        symmetric_pairs: bool | None = None,
    ):
        super().__init__()
        if feature_width <= 0:
            raise ValueError("feature_width must be positive")
        self.feature_width = int(feature_width)
        self.symmetric_pairs = (
            self.feature_width == 125
            if symmetric_pairs is None
            else bool(symmetric_pairs)
        )
        if self.symmetric_pairs and self.feature_width != 125:
            raise ValueError(
                "symmetric paired encoding requires the 125-wide production feature"
            )
        self.side_feature_width = 59 if self.symmetric_pairs else None
        recurrent_width = 66 if self.symmetric_pairs else self.feature_width
        self.gru = nn.GRU(
            recurrent_width,
            64,
            num_layers=2,
            batch_first=True,
            bidirectional=True,
            dropout=0.2,
        )
        self.attention = nn.Linear(128, 1)
        self.serve_head = nn.Linear(128, 1 if self.symmetric_pairs else 2)

    def forward(self, features: Tensor, mask: Tensor) -> dict[str, Tensor]:
        if features.ndim != 3:
            raise ValueError("features must have shape [batch, time, width]")
        if features.shape[-1] != self.feature_width:
            raise ValueError(
                f"expected feature width {self.feature_width}, got {features.shape[-1]}"
            )
        if mask.shape != features.shape[:2]:
            raise ValueError("mask must have shape [batch, time]")

        valid = mask.bool()
        if not torch.all(valid.any(dim=1)):
            raise ValueError("every sequence must contain at least one valid frame")

        if self.symmetric_pairs:
            side_width = int(self.side_feature_width or 0)
            global_features = features[:, :, side_width * 2 :]
            player_features = torch.stack(
                (
                    torch.cat((features[:, :, :side_width], global_features), dim=-1),
                    torch.cat(
                        (
                            features[:, :, side_width : side_width * 2],
                            global_features,
                        ),
                        dim=-1,
                    ),
                ),
                dim=1,
            )
            batch, players, time, width = player_features.shape
            shared_input = player_features.reshape(batch * players, time, width)
            hidden, _ = self.gru(shared_input)
            player_logits = self.serve_head(hidden).squeeze(-1)
            logits = player_logits.reshape(batch, players, time).transpose(1, 2)
            player_attention = self.attention(hidden).squeeze(-1)
            player_attention = player_attention.reshape(batch, players, time)
            attention_logits = torch.logsumexp(player_attention, dim=1)
        else:
            hidden, _ = self.gru(features)
            logits = self.serve_head(hidden)
            attention_logits = self.attention(hidden).squeeze(-1)
        attention_logits = attention_logits.masked_fill(~valid, -torch.inf)
        attention = torch.softmax(attention_logits, dim=1)
        return {
            "logits": logits,
            "attention": attention,
            "mask": valid,
        }


def _validated_output(output: Mapping[str, Tensor]) -> tuple[Tensor, Tensor, Tensor]:
    logits = output["logits"]
    if logits.ndim != 3 or logits.shape[-1] != 2:
        raise ValueError("output logits must have shape [batch, time, 2]")
    mask = output.get("mask")
    if mask is None:
        mask = torch.ones(logits.shape[:2], dtype=torch.bool, device=logits.device)
    else:
        mask = mask.to(device=logits.device, dtype=torch.bool)
    if mask.shape != logits.shape[:2]:
        raise ValueError("output mask must have shape [batch, time]")
    if not torch.all(mask.any(dim=1)):
        raise ValueError("every sequence must contain at least one valid frame")

    attention = output.get("attention")
    if attention is None:
        attention = mask.to(logits.dtype)
        attention = attention / attention.sum(dim=1, keepdim=True)
    else:
        attention = attention.to(device=logits.device, dtype=logits.dtype)
        if attention.shape != logits.shape[:2]:
            raise ValueError("output attention must have shape [batch, time]")
        attention = attention.masked_fill(~mask, 0.0)
        attention = attention / attention.sum(dim=1, keepdim=True).clamp_min(1e-12)
    return logits, mask, attention


def multiple_instance_loss(
    output: Mapping[str, Tensor],
    target_side: Tensor,
    clean_negative_mask: Tensor | None = None,
) -> Tensor:
    """Weakly supervise the strongest plausible serve window and serving side.

    The point-level near/far label does not specify the exact contact frame.  A
    log-sum-exp pool lets any valid frame explain the point, while learned
    attention discourages the network from spreading that explanation across
    the whole clip.  Optional clean-negative frames explicitly suppress motion
    that reviewers identified as unrelated to serving.
    """

    logits, mask, attention = _validated_output(output)
    target = target_side.to(device=logits.device, dtype=torch.long).reshape(-1)
    if target.shape[0] != logits.shape[0]:
        raise ValueError("target_side must have one value per sequence")
    if torch.any((target < 0) | (target > 1)):
        raise ValueError("target_side values must be 0 (near) or 1 (far)")

    log_weights = attention.clamp_min(1e-12).log().unsqueeze(-1)
    weighted_logits = (logits + log_weights).masked_fill(~mask.unsqueeze(-1), -torch.inf)
    point_logits = torch.logsumexp(weighted_logits, dim=1)
    loss = F.cross_entropy(point_logits, target)

    if clean_negative_mask is not None:
        negatives = clean_negative_mask.to(device=logits.device, dtype=torch.bool)
        if negatives.shape != mask.shape:
            raise ValueError("clean_negative_mask must have shape [batch, time]")
        negatives &= mask
        if negatives.any():
            negative_logits = logits[negatives]
            loss = loss + F.softplus(negative_logits).mean()
    return loss


def decode_point_likelihood(
    output: Mapping[str, Tensor],
    times_s: Sequence[float] | Tensor,
) -> dict[str, Any]:
    """Decode one point into side, likelihood traces, and an exact peak time."""

    logits, mask, attention = _validated_output(output)
    if logits.shape[0] != 1:
        raise ValueError("decode_point_likelihood expects exactly one sequence")
    times = torch.as_tensor(times_s, dtype=logits.dtype, device=logits.device).reshape(-1)
    if times.numel() != logits.shape[1]:
        raise ValueError("times_s must contain one timestamp per frame")

    probabilities = torch.sigmoid(logits[0]).masked_fill(~mask[0].unsqueeze(-1), 0.0)
    # Attention selects a coherent temporal event, while the reported confidence
    # remains the calibrated serve probability at that event.
    ranking = logits[0] + attention[0].clamp_min(1e-12).log().unsqueeze(-1)
    ranking = ranking.masked_fill(~mask[0].unsqueeze(-1), -torch.inf)
    flat_index = int(torch.argmax(ranking).item())
    frame_index = flat_index // 2
    side_index = flat_index % 2
    side = "near" if side_index == 0 else "far"

    return {
        "predicted_side": side,
        "confidence": float(probabilities[frame_index, side_index].item()),
        "onset_t": float(times[frame_index].item()),
        "peak_index": frame_index,
        "likelihoods": {
            "near": probabilities[:, 0].detach().cpu().tolist(),
            "far": probabilities[:, 1].detach().cpu().tolist(),
        },
        "attention": attention[0].detach().cpu().tolist(),
    }


__all__ = [
    "PairedServeGRU",
    "decode_point_likelihood",
    "multiple_instance_loss",
]
