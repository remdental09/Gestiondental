import sys, os, glob
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
# uso: v3.py <carpeta con PNG> <clave pieza ej. upper-molar-1> <carpeta salida>
src, key, out = sys.argv[1:4]
for d in ['base','inc','cav','forma','sell','mat']: os.makedirs(f'{out}/{d}', exist_ok=True)
L = lambda n: Image.open(f'{src}/{key}-{n}.png').convert('RGB')
A = lambda im: np.asarray(im, int)
base, pal = L('base'), L('palatina-sano')
base.save(f'{out}/base/{key}.webp','WEBP',quality=92,method=6)
pal.save(f'{out}/base/{key}-palatina.webp','WEBP',quality=92,method=6)
if os.path.exists(f'{src}/{key}-pulpitis.png'): L('pulpitis').save(f'{out}/base/{key}-pulpitis.webp','WEBP',quality=92,method=6)
def extract(im, ref, thr, mask_only):
    d = np.abs(A(im)-A(ref)).max(2)
    m = ndi.binary_opening(d>thr, iterations=1)
    lab, k = ndi.label(ndi.binary_dilation(m, iterations=3))
    if k:
        sizes = ndi.sum(m, lab, range(1,k+1))
        keep = np.isin(lab, [j+1 for j,s in enumerate(sizes) if s >= 0.3*max(sizes)]) & ndi.binary_dilation(m, iterations=3)
    else: keep = m
    keep = ndi.binary_dilation(keep, iterations=2) & (d>thr*0.4) | keep
    keep = ndi.binary_fill_holes(keep) if mask_only else keep
    al = Image.fromarray((keep*255).astype('uint8')).filter(ImageFilter.GaussianBlur(1))
    if mask_only: rgba = Image.merge('RGBA',[Image.new('L',al.size,255)]*3+[al])
    else: rgba = im.convert('RGBA'); rgba.putalpha(al)
    return rgba, keep.mean()*100
for kind, suf, thr, mo in [('inc','caries-incipiente',22,False),('cav','caries-cavitada',35,False),('forma','forma-obturacion',35,True)]:
    for s in 'OVMDP':
        rgba, area = extract(L(f'{s}-{suf}'), pal if s=='P' else base, thr, mo)
        rgba.save(f'{out}/{kind}/{key}-{s}.webp','WEBP',quality=90,method=6); print(kind,s,round(area,2),'%')
if os.path.exists(f'{src}/{key}-O-sellante.png'):
    rgba, area = extract(L('O-sellante'), base, 20, False); rgba.save(f'{out}/sell/{key}-O.webp','WEBP',quality=90,method=6); print('sell',round(area,2),'%')
