"""Table-conditioned image preparation for the preliminary YOLO detector."""
import cv2
import numpy as np


def focus_selected_table(image,corners):
    """Keep the selected table and nearby players bright; dim distant decoys."""
    polygon=np.asarray(corners,np.float32)
    table_width=max(1.,(np.linalg.norm(polygon[0]-polygon[1])+np.linalg.norm(polygon[2]-polygon[3]))/2)
    x0=max(0,round(float(polygon[:,0].min()-1.05*table_width)))
    x1=min(image.shape[1],round(float(polygon[:,0].max()+1.05*table_width)))
    y0=max(0,round(float(polygon[:,1].min()-1.35*table_width)))
    y1=min(image.shape[0],round(float(polygon[:,1].max()+.85*table_width)))
    focused=(image.astype(np.float32)*.28).astype(np.uint8)
    focused[y0:y1,x0:x1]=image[y0:y1,x0:x1]
    cv2.polylines(focused,[polygon.astype(np.int32)],True,(255,210,35),2,cv2.LINE_AA)
    return focused


def yolo_label(label,width,height,box_px=32):
    if not label or label['state']!='visible':return ''
    x=min(max(float(label['x']),0),width-1);y=min(max(float(label['y']),0),height-1)
    w=min(float(box_px),2*min(x,width-1-x) if 0<x<width-1 else 1)
    h=min(float(box_px),2*min(y,height-1-y) if 0<y<height-1 else 1)
    return f"0 {x/width:.8f} {y/height:.8f} {max(1,w)/width:.8f} {max(1,h)/height:.8f}"
