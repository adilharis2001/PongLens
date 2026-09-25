"""Unchanged image geometry from same-shot v1.1."""
import math

def geometry(corners):
    near=[p for k,p in corners.items() if 'near' in k]
    far=[p for k,p in corners.items() if 'far' in k]
    if len(near)!=2 or len(far)!=2:return None
    origin=[sum(p[i] for p in far)/2 for i in range(2)]
    axis=[sum(p[i] for p in near)/2-origin[i] for i in range(2)]
    den=sum(v*v for v in axis);width=math.dist(*near)
    if den<=1 or width<=1:return None
    def coords(x,y):
        return dict(q=((x-origin[0])*axis[0]+(y-origin[1])*axis[1])/den,
                    lateral=abs((x-origin[0])*axis[1]-(y-origin[1])*axis[0])/math.sqrt(den)/width)
    return coords,width
