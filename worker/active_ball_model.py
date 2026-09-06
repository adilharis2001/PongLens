"""Original small temporal model, initialized randomly; no external weights.

Input: three RGB frames, a table-surface context channel, elapsed-time channel.
The polygon is context, never an output gate: airborne balls can be outside it.
Outputs: center heatmap logits at half input resolution and visible-ball logit.
This first model does not estimate blur masks, contacts or point endings.
"""
import torch
from torch import nn
from torch.nn import functional as F


def block(a,b,stride=1):
    return nn.Sequential(nn.Conv2d(a,b,3,stride=stride,padding=1),nn.GroupNorm(4,b),nn.SiLU(),
                         nn.Conv2d(b,b,3,padding=1),nn.GroupNorm(4,b),nn.SiLU())


class ActiveBallNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.first=block(11,24,2)
        self.second=block(24,48,2)
        self.third=block(48,96,2)
        self.fuse=block(120,32)
        self.heat=nn.Conv2d(32,1,1)
        self.visible=nn.Linear(96,1)

    def forward(self,x):
        a=self.first(x);b=self.second(a);c=self.third(b)
        features=self.fuse(torch.cat([a,F.interpolate(c,size=a.shape[-2:],mode='bilinear',align_corners=False)],dim=1))
        return self.heat(features), self.visible(c.mean(dim=(-2,-1))).squeeze(1)


def ball_target(label,source_width,source_height,width,height):
    target=torch.zeros(height,width)
    if label['state'] != 'visible':return target
    y,x=torch.meshgrid(torch.arange(height),torch.arange(width),indexing='ij')
    cx=label['x']/source_width*width;cy=label['y']/source_height*height
    return torch.exp(-((x-cx)**2+(y-cy)**2)/(2*1.5**2))
